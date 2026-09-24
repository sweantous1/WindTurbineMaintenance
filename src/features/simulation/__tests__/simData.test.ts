import { describe, expect, it } from 'vitest'
import { assessHour, effectiveLimits, estimateMission, planWorstWindMs } from '@/domain/flightCheck'
import { gustAtAltitude, windAtAltitude } from '@/domain/weather'
import { planFor, routeContext } from '@/features/route/routeLogic'
import { buildSimData, windDirNear, type SimReady } from '../simData'
import { DRONE, FARM, HOUR, makeMission, ROUTE, turbine, WEATHER } from './fixtures'

function ready(data: ReturnType<typeof buildSimData>): SimReady {
  if (data.kind !== 'ready') throw new Error(`ожидались данные сцены, получен пробел ${data.gap}`)
  return data
}

describe('buildSimData: пробелы', () => {
  it('без фермы или без турбин — farm', () => {
    expect(buildSimData(makeMission({ farm: undefined }), DRONE)).toEqual({ kind: 'gap', gap: 'farm' })
    expect(buildSimData(makeMission({ farm: { ...FARM, turbines: [] } }), DRONE)).toEqual({ kind: 'gap', gap: 'farm' })
  })

  it('без маршрута, с пустым порядком или только с удалёнными турбинами — route', () => {
    expect(buildSimData(makeMission({ route: undefined }), DRONE)).toEqual({ kind: 'gap', gap: 'route' })
    expect(buildSimData(makeMission({ route: { ...ROUTE, order: [] } }), DRONE)).toEqual({ kind: 'gap', gap: 'route' })
    expect(buildSimData(makeMission({ route: { ...ROUTE, order: ['нет-такой'] } }), DRONE)).toEqual({ kind: 'gap', gap: 'route' })
  })

  it('неположительная или нечисловая скорость дрона — speed, без исключения', () => {
    for (const cruiseSpeedMs of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildSimData(makeMission(), { ...DRONE, cruiseSpeedMs })).toEqual({ kind: 'gap', gap: 'speed' })
    }
  })

  it('без точки взлёта взлетает из центра фермы, как экран маршрута', () => {
    const data = ready(buildSimData(makeMission({ takeoff: undefined }), DRONE))
    expect(data.takeoff.x).toBeCloseTo(0, 6)
    expect(data.takeoff.y).toBeCloseTo(0, 6)
  })
})

describe('buildSimData: сцена', () => {
  it('номера облёта по порядку маршрута, турбина вне маршрута — null', () => {
    const data = ready(buildSimData(makeMission({ route: { ...ROUTE, order: ['b', 'a'] } }), DRONE))
    expect(data.turbines.map((t) => [t.id, t.visitIndex])).toEqual([
      ['a', 1],
      ['b', 0],
      ['c', null],
    ])
    expect(data.turbines[0]).toMatchObject({ name: 'WTG-A', hubM: 100, rotorM: 120, orbitRadiusM: 90 })
  })

  it('размеры турбины берутся из самой турбины, если заданы', () => {
    const farm = { ...FARM, turbines: [...FARM.turbines, turbine('d', 'WTG-D', 0, 900, { hubHeightM: 140, rotorDiameterM: 160 })] }
    const data = ready(buildSimData(makeMission({ farm }), DRONE))
    expect(data.turbines.find((t) => t.id === 'd')).toMatchObject({ hubM: 140, rotorM: 160, orbitRadiusM: 110 })
  })

  it('конфликты: башня под перелётом помечена, отрезки совпадают с планом', () => {
    const data = ready(buildSimData(makeMission(), DRONE))
    expect(data.plan.conflicts.length).toBeGreaterThan(0)
    expect(data.turbines.map((t) => [t.id, t.conflict])).toEqual([
      ['a', false],
      ['b', false],
      ['c', true],
    ])
    expect([...data.conflictSegments].sort((x, y) => x - y)).toEqual([...new Set(data.plan.conflicts.map((c) => c.segmentIndex))].sort((x, y) => x - y))
    // Отрезок траектории с тем же номером — перелёт от A к B
    for (const i of data.conflictSegments) expect(data.trajectory.segments[i].phase).toBe('transit')
  })

  it('без конфликтов — пустое множество', () => {
    const farm = { ...FARM, turbines: FARM.turbines.filter((t) => t.id !== 'c') }
    const data = ready(buildSimData(makeMission({ farm }), DRONE))
    expect(data.conflictSegments.size).toBe(0)
    expect(data.turbines.every((t) => !t.conflict)).toBe(true)
  })

  it('длина траектории равна длине плана planFor с тем же потолком, что на экране маршрута', () => {
    // Высота перелёта выше потолка миссии: план прижимает её к 100 м
    const mission = makeMission({ flightAltitudeM: 150, limits: { ...makeMission().limits, maxAltitudeM: 100 } })
    const data = ready(buildSimData(mission, DRONE))
    const ctx = routeContext(mission, effectiveLimits(mission.limits, DRONE).maxAltitudeM)
    if (!ctx) throw new Error('нет контекста маршрута')
    const plan = planFor(ctx, ROUTE.order, ROUTE.returnToTakeoff)
    expect(data.plan.transitAltM).toBe(100)
    expect(data.trajectory.lengthM).toBeCloseTo(plan.lengthM, 6)
    expect(data.trajectory.durationS).toBeCloseTo(plan.lengthM / DRONE.cruiseSpeedMs, 6)
    // Потолок дрона ниже потолка миссии — берётся он
    const low = ready(buildSimData(mission, { ...DRONE, maxAltitudeM: 60 }))
    expect(low.plan.transitAltM).toBe(60)
  })

  it('рамка охватывает турбины и взлётку с полями', () => {
    const data = ready(buildSimData(makeMission(), DRONE))
    for (const p of [...data.turbines.map((t) => t.local), data.takeoff]) {
      expect(p.x).toBeGreaterThan(data.bounds.minX)
      expect(p.x).toBeLessThan(data.bounds.maxX)
      expect(p.y).toBeGreaterThan(data.bounds.minY)
      expect(p.y).toBeLessThan(data.bounds.maxY)
    }
  })
})

describe('buildSimData: ветер и оценка', () => {
  it('без прогноза или без часа вылета — ветра нет, оценка без ветра', () => {
    const noWeather = ready(buildSimData(makeMission(), DRONE))
    expect(noWeather.wind).toBeNull()
    expect(noWeather.estimate).toEqual(estimateMission(noWeather.plan.lengthM, DRONE, undefined))
    expect(ready(buildSimData(makeMission({ weather: WEATHER }), DRONE)).wind).toBeNull()
    expect(ready(buildSimData(makeMission({ weather: WEATHER, departureTime: '2026-09-25T14:00' }), DRONE)).wind).toBeNull()
  })

  it('с часом вылета: ветер на транзите и ступице, порывы, направление ближайшего уровня', () => {
    const data = ready(buildSimData(makeMission({ weather: WEATHER, departureTime: HOUR.time }), DRONE))
    const wind = data.wind
    if (!wind) throw new Error('нет ветра')
    expect(wind.hour).toBe(HOUR)
    expect(wind.transitMs).toBeCloseTo(windAtAltitude(HOUR, data.plan.transitAltM).ms ?? NaN, 9)
    expect(wind.hubMs).toBeCloseTo(windAtAltitude(HOUR, 100).ms ?? NaN, 9)
    expect(wind.gustMs).toBeCloseTo(gustAtAltitude(HOUR, data.plan.transitAltM) ?? NaN, 9)
    // Ступица 100 м ровно между уровнями 80 и 120 — берётся нижний
    expect(wind.fromDeg).toBe(210)
    expect(data.estimate).toEqual(estimateMission(data.plan.lengthM, DRONE, planWorstWindMs(HOUR, data.plan)))
    expect(data.estimate.timeWorstMin).toBeGreaterThan(data.estimate.timeMin)
  })

  it('оценка заряда совпадает с вердиктом часа: худший ветер на высотах плана, а не на транзите', () => {
    // Транзит 40 м, ступицы 120 м: наверху ветер заметно сильнее
    const tall = { ...FARM, defaults: { ...FARM.defaults, hubHeightM: 120 } }
    const hour = { ...HOUR, windMs: { '10': 3, '80': 5, '120': 8, '180': 9 } }
    const mission = makeMission({ farm: tall, flightAltitudeM: 40, weather: { ...WEATHER, hourly: [hour] }, departureTime: hour.time })
    const data = ready(buildSimData(mission, DRONE))
    const verdict = assessHour(hour, { limits: mission.limits, drone: DRONE, plan: data.plan, flightAltitudeM: 40 })
    expect(planWorstWindMs(hour, data.plan)).toBeCloseTo(8, 9)
    expect(data.estimate).toEqual(verdict.estimate)
  })

  it('направление — по средней высоте ступиц и только по уровням с данными', () => {
    const tall = { ...FARM, defaults: { ...FARM.defaults, hubHeightM: 135 } }
    const data = ready(buildSimData(makeMission({ farm: tall, weather: WEATHER, departureTime: HOUR.time }), DRONE))
    expect(data.wind?.fromDeg).toBe(220)
    expect(windDirNear({ ...HOUR, windDirDeg: { ...HOUR.windDirDeg, '120': null } }, 135)).toBe(230)
    expect(windDirNear({ ...HOUR, windDirDeg: { '10': null, '80': null, '120': null, '180': null } }, 100)).toBeNull()
  })
})
