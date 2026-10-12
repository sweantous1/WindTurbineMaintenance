import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WtmDatabase } from '../db'
import { createMissionRepository, MissionLockedError } from '../missions'
import { createDroneProfileRepository } from '../droneProfiles'
import { DEFAULT_DRONE_PROFILE, DEFAULT_FARM_DEFAULTS } from '@/domain/defaults'
import { missionPlanLengthM } from '@/domain/flightPlan'
import type { Farm, RoutePlan, WeatherSnapshot } from '@/domain/types'
import { offsetGeo } from '@/lib/geo'

const route: RoutePlan = {
  algorithm: 'auto', params: {}, thetaMaxDeg: 180, returnToTakeoff: true,
  order: ['t1', 't2'], lengthM: 1200, turnViolations: 0, source: 'auto', computedAt: '2026-09-24T10:00:00Z',
}
const weather = {
  fetchedAt: '2026-09-24T10:00:00Z', source: 'farm', location: { lat: 48.2, lon: 40.3 },
  timezone: 'Europe/Moscow', utcOffsetSeconds: 10800,
  current: { time: '2026-09-24T13:00', temperatureC: 15, windMs10: 4, windDirDeg10: 180, gustMs10: 7, weatherCode: 1, precipitationMm: 0 },
  hourly: [],
} satisfies WeatherSnapshot

let database: WtmDatabase
let repo: ReturnType<typeof createMissionRepository>
let n = 0

beforeEach(async () => {
  database = new WtmDatabase(`test-${n++}`)
  await database.open()
  repo = createMissionRepository(database)
})

afterEach(async () => {
  await database.delete()
})

describe('репозиторий миссий', () => {
  it('новая миссия создаётся черновиком и становится активной', async () => {
    const m = await repo.create({ name: '  Ферма Ростов  ' })
    expect(m.name).toBe('Ферма Ростов')
    expect(m.status).toBe('draft')
    expect(await repo.getActiveId()).toBe(m.id)
  })

  it('при заполнении маршрута и погоды статус вычисляется сам', async () => {
    const m = await repo.create({ name: 'М' })
    expect((await repo.update(m.id, { route })).status).toBe('planned')
    expect((await repo.update(m.id, { weather })).status).toBe('planned')
    expect((await repo.update(m.id, { departureTime: '2026-09-24T15:00' })).status).toBe('ready')
    expect((await repo.update(m.id, { route: undefined })).status).toBe('draft')
  })

  it('завершение без погоды не проходит без подтверждения и ничего не меняет', async () => {
    const m = await repo.create({ name: 'М' })
    await repo.update(m.id, { route })
    const res = await repo.complete(m.id)
    expect(res).toEqual({ ok: false, missing: ['weather'] })
    expect((await repo.get(m.id))?.status).toBe('planned')
    expect(await repo.getActiveId()).toBe(m.id)
  })

  it('завершение ставит flown, сбрасывает активную миссию и ничего не удаляет', async () => {
    const m = await repo.create({ name: 'М' })
    await repo.update(m.id, { route, weather, departureTime: '2026-09-24T15:00' })
    const res = await repo.complete(m.id)
    expect(res.ok).toBe(true)
    const saved = await repo.get(m.id)
    expect(saved?.status).toBe('flown')
    expect(saved?.completedAt).toBeTruthy()
    expect(saved?.route?.order).toEqual(['t1', 't2'])
    expect(saved?.weather?.timezone).toBe('Europe/Moscow')
    expect(await repo.getActiveId()).toBeNull()
    // Снимок профиля: правка профиля не меняет облетанную миссию
    expect(saved?.droneSnapshot?.id).toBe('default')
    await database.droneProfiles.update('default', { cruiseSpeedMs: 3 })
    expect((await repo.get(m.id))?.droneSnapshot?.cruiseSpeedMs).toBe(10)
  })

  it('у облетанной миссии полётные данные только читаются, заметки — можно', async () => {
    const m = await repo.create({ name: 'М' })
    await repo.update(m.id, { route, weather })
    await repo.complete(m.id)
    await expect(repo.update(m.id, { weather: undefined })).rejects.toBeInstanceOf(MissionLockedError)
    await expect(repo.update(m.id, { flightAltitudeM: 50 })).rejects.toBeInstanceOf(MissionLockedError)
    expect((await repo.update(m.id, { notes: 'Лопасть 2: сколы' })).notes).toBe('Лопасть 2: сколы')
    expect((await repo.get(m.id))?.weather).toBeTruthy()
  })

  it('если транзакция завершения падает, данные остаются прежними', async () => {
    const m = await repo.create({ name: 'М' })
    await repo.update(m.id, { route, weather })
    const originalPut = database.missions.put.bind(database.missions)
    database.missions.put = (() => Promise.reject(new Error('диск переполнен'))) as unknown as typeof database.missions.put
    await expect(repo.complete(m.id)).rejects.toThrow('диск переполнен')
    database.missions.put = originalPut
    expect((await repo.get(m.id))?.status).toBe('planned')
    expect(await repo.getActiveId()).toBe(m.id)
  })

  it('удаление активной миссии сбрасывает выбор', async () => {
    const m = await repo.create({ name: 'М' })
    await repo.remove(m.id)
    expect(await repo.get(m.id)).toBeUndefined()
    expect(await repo.getActiveId()).toBeNull()
  })
})

describe('длина маршрута и профиль дрона', () => {
  // 6 турбин в ряд, перелёт на 90 м: при потолке 60 м транзит опускается и длина плана меняется
  const center = { lat: 48.2, lon: 40.3 }
  const farm: Farm = {
    center,
    defaults: { ...DEFAULT_FARM_DEFAULTS },
    turbines: Array.from({ length: 6 }, (_, k) => ({ id: `t${k}`, name: `T${k}`, ...offsetGeo(center, k * 500 - 1250, 0) })),
  }
  const farmRoute: RoutePlan = { ...route, order: farm.turbines.map((t) => t.id) }

  // Маршрут с длиной по текущему профилю, как после построения маршрута
  const takeoff = offsetGeo(center, -1600, 0)
  const { id: _id, ...profileBase } = DEFAULT_DRONE_PROFILE

  async function plannedMission(droneProfileId = 'default') {
    const m = await repo.create({ name: 'М', droneProfileId })
    const drone = (await database.droneProfiles.get(droneProfileId)) ?? DEFAULT_DRONE_PROFILE
    const lengthM = missionPlanLengthM({ ...m, farm, takeoff, route: farmRoute }, drone)!
    return repo.update(m.id, { farm, takeoff, route: { ...farmRoute, lengthM } })
  }

  it('завершение пересчитывает длину по снимку профиля, если профиль правили в настройках', async () => {
    const m = await plannedMission()
    const before = m.route!.lengthM
    await database.droneProfiles.put({ ...DEFAULT_DRONE_PROFILE, maxAltitudeM: 60 })
    const res = await repo.complete(m.id, { force: true })
    expect(res.ok).toBe(true)
    const saved = (await repo.get(m.id))!
    expect(saved.status).toBe('flown')
    expect(saved.droneSnapshot?.maxAltitudeM).toBe(60)
    const expected = missionPlanLengthM(saved, saved.droneSnapshot!)!
    expect(saved.route!.lengthM).toBeCloseTo(expected, 6)
    expect(saved.route!.lengthM).not.toBeCloseTo(before, 0)
    // Остальное в маршруте не трогается
    expect({ ...saved.route, lengthM: 0 }).toEqual({ ...m.route, lengthM: 0 })
  })

  it('завершение без фермы оставляет сохранённую длину как есть', async () => {
    const m = await repo.create({ name: 'М' })
    await repo.update(m.id, { route, weather })
    await repo.complete(m.id)
    expect((await repo.get(m.id))?.route?.lengthM).toBe(1200)
  })

  it('пересчёт длины после правки профиля: только миссии до полёта с этим профилем', async () => {
    const drones = createDroneProfileRepository(database)
    const other = await drones.save({ ...profileBase, name: 'Другой' })
    const mine = await plannedMission()
    const foreign = await plannedMission(other.id)
    const flown = await plannedMission()
    await repo.complete(flown.id, { force: true })
    const flownBefore = (await repo.get(flown.id))!

    await drones.save({ ...DEFAULT_DRONE_PROFILE, maxAltitudeM: 60 })
    expect(await repo.recomputeRouteLengths('default')).toBe(1)

    const savedMine = (await repo.get(mine.id))!
    expect(savedMine.route!.lengthM).toBeCloseTo(missionPlanLengthM(savedMine, { ...DEFAULT_DRONE_PROFILE, maxAltitudeM: 60 })!, 6)
    expect(savedMine.route!.lengthM).not.toBeCloseTo(mine.route!.lengthM, 0)
    // Пересчёт производного поля - не правка миссии, порядок списка тот же
    expect(savedMine.updatedAt).toBe(mine.updatedAt)
    expect(savedMine.status).toBe(mine.status)
    expect((await repo.get(foreign.id))!.route!.lengthM).toBe(foreign.route!.lengthM)
    // У облетанной длина уже по снимку
    expect(await repo.get(flown.id)).toEqual(flownBefore)
    // Повторный вызов ничего не меняет
    expect(await repo.recomputeRouteLengths('default')).toBe(0)
  })

  it('после удаления профиля миссии считаются по профилю по умолчанию', async () => {
    const drones = createDroneProfileRepository(database)
    const low = await drones.save({ ...profileBase, name: 'Низкий', maxAltitudeM: 60 })
    const m = await plannedMission(low.id)
    await drones.remove(low.id)
    expect(await repo.recomputeRouteLengths(low.id)).toBe(1)
    const saved = (await repo.get(m.id))!
    expect(saved.route!.lengthM).toBeCloseTo(missionPlanLengthM(saved, DEFAULT_DRONE_PROFILE)!, 6)

    // Потом правят профиль по умолчанию, миссия удалённого профиля летит на нём и тоже пересчитывается
    await drones.save({ ...DEFAULT_DRONE_PROFILE, maxAltitudeM: 70 })
    expect(await repo.recomputeRouteLengths('default')).toBe(1)
    const again = (await repo.get(m.id))!
    expect(again.route!.lengthM).toBeCloseTo(missionPlanLengthM(again, { ...DEFAULT_DRONE_PROFILE, maxAltitudeM: 70 })!, 6)
  })

  it('без id пересчитываются все миссии до полёта', async () => {
    const drones = createDroneProfileRepository(database)
    const other = await drones.save({ ...profileBase, name: 'Другой' })
    await plannedMission()
    await plannedMission(other.id)
    await drones.save({ ...DEFAULT_DRONE_PROFILE, maxAltitudeM: 60 })
    await drones.save({ ...other, maxAltitudeM: 60 })
    expect(await repo.recomputeRouteLengths()).toBe(2)
    expect(await repo.recomputeRouteLengths()).toBe(0)
  })
})

describe('профили дронов', () => {
  it('профиль по умолчанию создаётся при первом открытии базы', async () => {
    const drones = createDroneProfileRepository(database)
    const all = await drones.list()
    expect(all.map((d) => d.id)).toContain('default')
    expect((await drones.getOrDefault('нет-такого')).id).toBe('default')
    await expect(drones.remove('default')).rejects.toThrow()
  })
})
