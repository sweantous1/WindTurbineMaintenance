import { describe, expect, it } from 'vitest'
import { makeLocalFrame, offsetGeo } from '@/lib/geo'
import { buildFlightPlan, type FlightPlanInput } from '../flightPlan'
import { batteryUsedPct, bearingRad, buildTrajectory, sampleAt } from '../flightPath'
import { estimateMission } from '../flightCheck'
import { DEFAULT_DRONE_PROFILE } from '../defaults'
import type { Farm, FlightPlan, Turbine } from '../types'

const CENTER = { lat: 47.5, lon: 40.1 }
const frame = makeLocalFrame(CENTER)

function turbine(id: string, eastM: number, northM: number, extra: Partial<Turbine> = {}): Turbine {
  return { id, name: id, ...offsetGeo(CENTER, eastM, northM), ...extra }
}

function farm(turbines: Turbine[]): Farm {
  return { center: CENTER, defaults: { hubHeightM: 100, rotorDiameterM: 120, safeDistanceM: 30 }, turbines }
}

function plan(overrides: Partial<FlightPlanInput> & Pick<FlightPlanInput, 'farm' | 'order'>): FlightPlan {
  return buildFlightPlan({
    takeoff: offsetGeo(CENTER, 0, -500),
    flightAltitudeM: 90,
    maxAltitudeM: 120,
    returnToTakeoff: true,
    ...overrides,
  })
}

const TWO = farm([turbine('a', 0, 0), turbine('b', 600, 0)])

describe('buildTrajectory', () => {
  it('длина и время совпадают с планом и с оценкой времени полёта', () => {
    const p = plan({ farm: TWO, order: ['a', 'b'] })
    const traj = buildTrajectory(p, TWO, 10)
    expect(traj.lengthM).toBeCloseTo(p.lengthM, 6)
    expect(traj.durationS).toBeCloseTo(p.lengthM / 10, 6)
    const est = estimateMission(p.lengthM, { ...DEFAULT_DRONE_PROFILE, cruiseSpeedMs: 10 })
    expect(traj.durationS / 60).toBeCloseTo(est.timeMin, 9)
  })

  it('отрезок i — между путевыми точками i и i + 1, как в FlightConflict.segmentIndex', () => {
    const p = plan({ farm: TWO, order: ['a', 'b'] })
    const traj = buildTrajectory(p, TWO, 10)
    expect(traj.segments).toHaveLength(p.waypoints.length - 1)
    p.waypoints.forEach((w, i) => {
      if (i === p.waypoints.length - 1) return
      const s = traj.segments[i]
      const local = frame.toLocal(w)
      expect(s.from.x).toBeCloseTo(local.x, 6)
      expect(s.from.y).toBeCloseTo(local.y, 6)
      expect(s.from.z).toBe(w.altM)
    })
  })

  it('фазы идут в порядке взлёт → перелёт → выход на ступицу → облёт → … → возврат → посадка', () => {
    const p = plan({ farm: TWO, order: ['a', 'b'] })
    const phases = buildTrajectory(p, TWO, 10).segments.map((s) => s.phase)
    const compact = phases.filter((ph, i) => ph !== phases[i - 1])
    expect(compact).toEqual(['takeoff', 'transit', 'approach', 'orbit', 'transit', 'approach', 'orbit', 'return', 'landing'])
  })

  it('без возврата последний отрезок — посадка на месте выхода из облёта', () => {
    const p = plan({ farm: TWO, order: ['a', 'b'], returnToTakeoff: false })
    const traj = buildTrajectory(p, TWO, 10)
    const last = traj.segments[traj.segments.length - 1]
    expect(last.phase).toBe('landing')
    expect(last.to.z).toBe(0)
    expect(last.to.x).toBeCloseTo(last.from.x, 9)
    expect(last.to.y).toBeCloseTo(last.from.y, 9)
    expect(traj.segments.some((s) => s.phase === 'return')).toBe(false)
  })

  it('номер турбины в облёте и время каждого визита', () => {
    const p = plan({ farm: TWO, order: ['b', 'a'] })
    const traj = buildTrajectory(p, TWO, 10)
    expect(traj.visits.map((v) => [v.turbineId, v.visitIndex])).toEqual([
      ['b', 0],
      ['a', 1],
    ])
    const [b, a] = traj.visits
    expect(b.transitStartS).toBeLessThan(b.orbitStartS)
    expect(b.orbitStartS).toBeLessThan(b.orbitEndS)
    expect(b.orbitEndS).toBeLessThanOrEqual(a.transitStartS + 1e-9)
    expect(b.center.x).toBeCloseTo(600, 3)
    for (const seg of traj.segments.filter((x) => x.turbineId === 'a')) expect(seg.visitIndex).toBe(1)
    // На всех отрезках облёта дрон на высоте ступицы
    for (const seg of traj.segments.filter((x) => x.phase === 'orbit')) {
      expect(seg.from.z).toBe(100)
      expect(seg.to.z).toBe(100)
    }
  })

  it('неизвестные турбины в порядке пропускаются так же, как в плане', () => {
    const p = plan({ farm: TWO, order: ['ghost', 'a'] })
    const traj = buildTrajectory(p, TWO, 10)
    expect(traj.visits.map((v) => v.turbineId)).toEqual(['a'])
  })

  it('неположительная или нечисловая скорость — ошибка, а не бесконечное время', () => {
    const p = plan({ farm: TWO, order: ['a'] })
    expect(() => buildTrajectory(p, TWO, 0)).toThrow(RangeError)
    expect(() => buildTrajectory(p, TWO, -5)).toThrow(RangeError)
    expect(() => buildTrajectory(p, TWO, NaN)).toThrow(RangeError)
  })

  it('курс: при подъёме со взлётки — уже в сторону первого перелёта, на вертикалях — прежний', () => {
    const p = plan({ farm: TWO, order: ['a', 'b'] })
    const segs = buildTrajectory(p, TWO, 10).segments
    const firstTransit = segs.find((s) => s.phase === 'transit')!
    expect(segs[0].phase).toBe('takeoff')
    expect(segs[0].headingRad).toBeCloseTo(firstTransit.headingRad, 12)
    // Взлёт южнее фермы, первая турбина в центре, летим на север
    expect(firstTransit.headingRad).toBeCloseTo(0, 6)
    for (const s of segs) expect(Number.isFinite(s.headingRad)).toBe(true)
    const landing = segs[segs.length - 1]
    const ret = segs[segs.length - 2]
    expect(landing.headingRad).toBe(ret.headingRad)
  })

  it('план из одних вертикалей не даёт NaN в курсе', () => {
    const p = plan({ farm: TWO, order: [] })
    const traj = buildTrajectory(p, TWO, 10)
    for (const s of traj.segments) expect(s.headingRad).toBe(0)
    expect(traj.visits).toEqual([])
  })
})

describe('sampleAt', () => {
  const p = plan({ farm: TWO, order: ['a', 'b'] })
  const traj = buildTrajectory(p, TWO, 10)

  it('начало — на земле у взлётки, конец — посадка, finished только в конце', () => {
    const start = sampleAt(traj, 0)
    expect(start.position.z).toBe(0)
    expect(start.phase).toBe('takeoff')
    expect(start.finished).toBe(false)
    expect(start.progress).toBe(0)
    const end = sampleAt(traj, traj.durationS)
    expect(end.finished).toBe(true)
    expect(end.phase).toBe('landing')
    expect(end.position.z).toBe(0)
    expect(end.distanceM).toBeCloseTo(traj.lengthM, 6)
    expect(end.inspectedCount).toBe(2)
    expect(end.progress).toBe(1)
  })

  it('время за пределами полёта и NaN прижимаются к краям', () => {
    expect(sampleAt(traj, -10).timeS).toBe(0)
    expect(sampleAt(traj, traj.durationS + 100).finished).toBe(true)
    expect(sampleAt(traj, NaN).timeS).toBe(0)
  })

  it('позиция непрерывна: соседние моменты не дальше пути за это время', () => {
    const dt = 0.5
    let prev = sampleAt(traj, 0)
    for (let t = dt; t <= traj.durationS; t += dt) {
      const cur = sampleAt(traj, t)
      const step = Math.hypot(cur.position.x - prev.position.x, cur.position.y - prev.position.y, cur.position.z - prev.position.z)
      expect(step).toBeLessThanOrEqual(traj.speedMs * dt + 1e-6)
      expect(cur.distanceM).toBeGreaterThanOrEqual(prev.distanceM - 1e-9)
      prev = cur
    }
  })

  it('на облёте нос смотрит на турбину', () => {
    const visit = traj.visits[0]
    const mid = sampleAt(traj, (visit.orbitStartS + visit.orbitEndS) / 2)
    expect(mid.phase).toBe('orbit')
    expect(mid.turbineId).toBe('a')
    expect(mid.yawRad).toBeCloseTo(bearingRad(mid.position, visit.center), 12)
    expect(mid.inspectedCount).toBe(0)
    expect(sampleAt(traj, visit.orbitEndS + 0.01).inspectedCount).toBe(1)
  })

  it('на перелёте нос — по ходу движения', () => {
    const transit = traj.segments.find((s) => s.phase === 'transit' && s.turbineId === 'b')!
    const sample = sampleAt(traj, transit.startS + transit.durationS / 2)
    expect(sample.phase).toBe('transit')
    expect(sample.visitIndex).toBe(1)
    expect(sample.yawRad).toBeCloseTo(bearingRad(transit.from, transit.to), 12)
  })

  it('отрезок нулевой длины не выбирается: высота транзита равна высоте ступицы', () => {
    const flat = plan({ farm: TWO, order: ['a'], flightAltitudeM: 100 })
    const t = buildTrajectory(flat, TWO, 10)
    const zero = t.segments.findIndex((s) => s.durationS === 0)
    expect(zero).toBeGreaterThan(0)
    const s = sampleAt(t, t.segments[zero].startS)
    expect(s.segmentIndex).not.toBe(zero)
    expect(Number.isFinite(s.position.x)).toBe(true)
  })

  it('пустая траектория — посадка на месте, без исключений', () => {
    const empty = { segments: [], visits: [], lengthM: 0, durationS: 0, speedMs: 10 }
    const s = sampleAt(empty, 5)
    expect(s.finished).toBe(true)
    expect(s.segmentIndex).toBe(-1)
  })
})

describe('batteryUsedPct', () => {
  it('доля времени от выносливости дрона, как в estimateMission', () => {
    expect(batteryUsedPct(35 * 60, 35)).toBeCloseTo(100, 9)
    expect(batteryUsedPct(7 * 60, 35)).toBeCloseTo(20, 9)
    expect(batteryUsedPct(-1, 35)).toBe(0)
    expect(batteryUsedPct(60, 0)).toBe(Infinity)
  })
})

describe('bearingRad', () => {
  it('север 0, восток π/2, юг π, запад 3π/2', () => {
    const o = { x: 0, y: 0 }
    expect(bearingRad(o, { x: 0, y: 1 })).toBeCloseTo(0, 12)
    expect(bearingRad(o, { x: 1, y: 0 })).toBeCloseTo(Math.PI / 2, 12)
    expect(bearingRad(o, { x: 0, y: -1 })).toBeCloseTo(Math.PI, 12)
    expect(bearingRad(o, { x: -1, y: 0 })).toBeCloseTo((3 * Math.PI) / 2, 12)
  })
})
