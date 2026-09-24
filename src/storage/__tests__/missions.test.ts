import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WtmDatabase } from '../db'
import { createMissionRepository, MissionLockedError } from '../missions'
import { createDroneProfileRepository } from '../droneProfiles'
import type { RoutePlan, WeatherSnapshot } from '@/domain/types'

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

describe('профили дронов', () => {
  it('профиль по умолчанию создаётся при первом открытии базы', async () => {
    const drones = createDroneProfileRepository(database)
    const all = await drones.list()
    expect(all.map((d) => d.id)).toContain('default')
    expect((await drones.getOrDefault('нет-такого')).id).toBe('default')
    await expect(drones.remove('default')).rejects.toThrow()
  })
})
