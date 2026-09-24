import { describe, expect, it } from 'vitest'
import type { FlightPlan, FlightWaypoint } from '@/domain/types'
import { orbitRadiusM } from '@/domain/flightPlan'
import {
  orbitCircles,
  orbitSegmentTurbine,
  orderNumbers,
  planLines,
  planPath,
  segmentEndpoints,
  turbinesAboveCeiling,
  verticalPlace,
  viewBounds,
} from '../planGeometry'
import { planFor, type RouteContext } from '../routeLogic'
import { at, lineFarm, makeFarm } from './helpers'

function wp(kind: FlightWaypoint['kind'], lat: number, lon: number, turbineId?: string): FlightWaypoint {
  return { kind, lat, lon, altM: 0, ...(turbineId ? { turbineId } : {}) }
}

// Условный план: взлёт в (0,0), турбина A с облётом из трёх точек, возврат
function syntheticPlan(conflictSegments: number[] = []): FlightPlan {
  const waypoints = [
    wp('takeoff', 0, 0),
    wp('transit', 0, 0),
    wp('transit', 0, 1, 'A'),
    wp('orbit', 0, 1, 'A'),
    wp('orbit', 1, 1, 'A'),
    wp('orbit', 0, 1, 'A'),
    wp('transit', 0, 0),
    wp('landing', 0, 0),
  ]
  return {
    waypoints,
    transitAltM: 90,
    altitudeLevelsM: [90, 100],
    maxAltM: 100,
    lengthM: 1,
    turbineOrder: ['A'],
    conflicts: conflictSegments.map((segmentIndex) => ({ segmentIndex, turbineId: 'B', distanceM: 10, minDistanceM: 90 })),
  }
}

describe('линии плана на карте', () => {
  it('облёты и вертикальные отрезки не рисуются как транзит', () => {
    const lines = planLines(syntheticPlan())
    expect(lines.transit).toEqual([
      [
        [0, 0],
        [0, 1],
      ],
      [
        [0, 1],
        [0, 0],
      ],
    ])
    expect(lines.conflict).toEqual([])
    expect(lines.conflictPoints).toEqual([])
  })

  it('отрезки с конфликтом — отдельной линией, вертикальный конфликт — точкой', () => {
    const lines = planLines(syntheticPlan([0, 1]))
    expect(lines.conflictPoints).toEqual([[0, 0]])
    expect(lines.conflict).toEqual([
      [
        [0, 0],
        [0, 1],
      ],
    ])
    expect(lines.transit).toHaveLength(1)
  })

  it('на настоящем плане перелёт взлёт → дальняя турбина над рядом — красный', () => {
    const farm = lineFarm(4)
    const ctx: RouteContext = { farm, takeoff: at(-300, 0), flightAltitudeM: 90, maxAltitudeM: 120 }
    const plan = planFor(ctx, ['t4', 't3', 't2', 't1'], false)
    expect(plan.conflicts.length).toBeGreaterThan(0)
    const lines = planLines(plan)
    expect(lines.conflict.length).toBeGreaterThan(0)
    // Каждая точка конфликтной линии — точка плана
    const keys = new Set(plan.waypoints.map((w) => `${w.lat},${w.lon}`))
    for (const line of lines.conflict) for (const [lat, lon] of line) expect(keys.has(`${lat},${lon}`)).toBe(true)

    const clean = planLines(planFor(ctx, ['t1', 't2', 't3', 't4'], false))
    expect(clean.conflict).toEqual([])
    expect(clean.transit.length).toBeGreaterThan(0)
  })

  it('взлёт внутри круга облёта чужой турбины — конфликт на подъёме', () => {
    const farm = lineFarm(3)
    const ctx: RouteContext = { farm, takeoff: at(5, 0), flightAltitudeM: 90, maxAltitudeM: 120 }
    const plan = planFor(ctx, ['t2', 't3', 't1'], false)
    const lines = planLines(plan)
    expect(lines.conflictPoints.length).toBeGreaterThan(0)
    const first = plan.conflicts.find((c) => c.segmentIndex === 0)
    expect(first?.turbineId).toBe('t1')
  })

  it('дуга облёта с конфликтом — красной линией, без конфликта — не рисуется', () => {
    const lines = planLines(syntheticPlan([3]))
    expect(lines.conflict).toEqual([
      [
        [0, 1],
        [1, 1],
      ],
    ])
    // Остальные дуги облёта по-прежнему не попадают ни в транзит, ни в конфликт
    expect(lines.transit).toHaveLength(2)
    expect(lines.conflictPoints).toEqual([])
  })

  it('на настоящем плане облёт, задевший соседа, виден на карте', () => {
    // T1 и T3 в 140 м: облёт T1 на высоте ступицы проходит сквозь зону ротора T3
    const farm = makeFarm([
      [0, 0],
      [600, 600],
      [140, 0],
      [700, -300],
    ])
    const plan = planFor({ farm, takeoff: at(-600, 0), flightAltitudeM: 90, maxAltitudeM: 120 }, ['t1', 't2', 't3', 't4'], true)
    const onOrbit = plan.conflicts.filter((c) => orbitSegmentTurbine(plan, c.segmentIndex) === 't1' && c.turbineId === 't3')
    expect(onOrbit.length).toBeGreaterThan(0)
    const orbitKeys = new Set(plan.waypoints.filter((w) => w.kind === 'orbit' && w.turbineId === 't1').map((w) => `${w.lat},${w.lon}`))
    const redOrbit = planLines(plan).conflict.filter((line) => line.every(([lat, lon]) => orbitKeys.has(`${lat},${lon}`)))
    expect(redOrbit.length).toBeGreaterThan(0)
  })
})

describe('описание отрезков', () => {
  it('откуда и куда ведёт отрезок', () => {
    const plan = syntheticPlan()
    expect(segmentEndpoints(plan, 0)).toEqual({ from: { kind: 'takeoff' }, to: { kind: 'takeoff' }, vertical: true })
    expect(segmentEndpoints(plan, 1)).toEqual({ from: { kind: 'takeoff' }, to: { kind: 'turbine', id: 'A' }, vertical: false })
    expect(segmentEndpoints(plan, 5)).toEqual({ from: { kind: 'turbine', id: 'A' }, to: { kind: 'takeoff' }, vertical: false })
    expect(segmentEndpoints(plan, 6)).toEqual({ from: { kind: 'takeoff' }, to: { kind: 'landing' }, vertical: true })
    expect(segmentEndpoints(plan, 7)).toBeUndefined()
  })

  it('дуга облёта узнаётся по турбине, перелёты и подъёмы — нет', () => {
    const plan = syntheticPlan()
    expect(orbitSegmentTurbine(plan, 3)).toBe('A')
    expect(orbitSegmentTurbine(plan, 4)).toBe('A')
    expect(orbitSegmentTurbine(plan, 1)).toBeUndefined()
    expect(orbitSegmentTurbine(plan, 2)).toBeUndefined()
    expect(orbitSegmentTurbine(plan, 5)).toBeUndefined()
    expect(orbitSegmentTurbine(plan, 7)).toBeUndefined()
  })

  it('подъём при взлёте — «взлёт», спуск к посадке — «посадка», а не второй «взлёт»', () => {
    const plan = syntheticPlan()
    const up = segmentEndpoints(plan, 0)
    const down = segmentEndpoints(plan, 6)
    expect(up && verticalPlace(up)).toEqual({ kind: 'takeoff' })
    expect(down && verticalPlace(down)).toEqual({ kind: 'landing' })
  })

  it('на настоящем плане с возвратом два конфликта у взлёта описаны разными точками', () => {
    // Турбина t1 в 83 м от взлёта при радиусе облёта 90 м: и подъём, и спуск задевают её зону
    const farm = { ...lineFarm(2, 600), turbines: [{ id: 't1', name: 'T1', ...at(83, 0) }, { id: 't2', name: 'T2', ...at(600, 0) }] }
    const plan = planFor({ farm, takeoff: at(0, 0), flightAltitudeM: 90, maxAltitudeM: 120 }, ['t2', 't1'], true)
    const vertical = plan.conflicts
      .filter((c) => c.turbineId === 't1')
      .map((c) => segmentEndpoints(plan, c.segmentIndex))
      .filter((e) => e?.vertical)
    expect(vertical).toHaveLength(2)
    expect(vertical.map((e) => e && verticalPlace(e))).toEqual([{ kind: 'takeoff' }, { kind: 'landing' }])
  })

  it('на настоящем плане без возврата последний отрезок — посадка у последней турбины', () => {
    const farm = lineFarm(2)
    const plan = planFor({ farm, takeoff: at(-300, 0), flightAltitudeM: 90, maxAltitudeM: 120 }, ['t1', 't2'], false)
    const last = segmentEndpoints(plan, plan.waypoints.length - 2)
    expect(last).toEqual({ from: { kind: 'turbine', id: 't2' }, to: { kind: 'landing' }, vertical: true })
  })
})

describe('прочая геометрия', () => {
  it('окружности облёта — по турбинам маршрута, радиус как у плана полёта', () => {
    const farm = lineFarm(3)
    const circles = orbitCircles(farm, ['t3', 'ghost', 't1'])
    expect(circles.map((c) => c.turbineId)).toEqual(['t3', 't1'])
    expect(circles[0].radiusM).toBe(orbitRadiusM(farm, farm.turbines[2]))
    expect(circles[0].radiusM).toBe(farm.defaults.rotorDiameterM / 2 + farm.defaults.safeDistanceM)
  })

  it('номера облёта с единицы', () => {
    expect(orderNumbers(['b', 'a'])).toEqual(
      new Map([
        ['b', 1],
        ['a', 2],
      ]),
    )
  })

  it('границы вида', () => {
    expect(viewBounds([])).toBeUndefined()
    expect(
      viewBounds([
        { lat: 1, lon: 5 },
        { lat: -2, lon: 7 },
      ]),
    ).toEqual([
      [-2, 5],
      [1, 7],
    ])
  })

  it('турбины со ступицей выше потолка', () => {
    const farm = lineFarm(3)
    farm.turbines[1] = { ...farm.turbines[1], hubHeightM: 150 }
    expect(turbinesAboveCeiling(farm, 120).map((t) => t.id)).toEqual(['t2'])
    expect(turbinesAboveCeiling(farm, 90).map((t) => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('путь для KML без повторов подряд', () => {
    const path = planPath(syntheticPlan())
    expect(path).toEqual([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 0 },
    ])
  })
})
