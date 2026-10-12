import { describe, expect, it } from 'vitest'
import { buildTrajectory, sampleAt, type TrajectorySample } from '@/domain/flightPath'
import { buildFlightPlan } from '@/domain/flightPlan'
import { offsetGeo } from '@/lib/geo'
import { SPEED_OPTIONS } from '../simClock'
import {
  batteryLevel,
  CAMERA_MODES,
  currentVisitIndex,
  formatClock,
  nextCameraMode,
  nextSpeed,
  PATH_COLORS,
  pathKind,
  phaseText,
  PHASE_KEYS,
  smoothAngle,
  topViewDistance,
} from '../simView'
import { CENTER, FARM } from './fixtures'

describe('formatClock', () => {
  it('ч:мм:сс, часы без ведущего нуля', () => {
    expect(formatClock(0)).toBe('0:00:00')
    expect(formatClock(59.9)).toBe('0:00:59')
    expect(formatClock(61)).toBe('0:01:01')
    expect(formatClock(3 * 3600 + 5 * 60 + 7)).toBe('3:05:07')
    expect(formatClock(36_000)).toBe('10:00:00')
  })

  it('отрицательное и нечисловое — ноль', () => {
    expect(formatClock(-5)).toBe('0:00:00')
    expect(formatClock(Number.NaN)).toBe('0:00:00')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00:00')
  })
})

describe('скорость и камера', () => {
  it('[ и ] — соседняя скорость из списка, на краях стоит', () => {
    expect(nextSpeed(10, 1)).toBe(20)
    expect(nextSpeed(10, -1)).toBe(5)
    expect(nextSpeed(SPEED_OPTIONS[SPEED_OPTIONS.length - 1], 1)).toBe(100)
    expect(nextSpeed(1, -1)).toBe(1)
    // Не из списка: к ближайшей в нужную сторону
    expect(nextSpeed(7, 1)).toBe(10)
    expect(nextSpeed(7, -1)).toBe(5)
  })

  it('C — режимы по кругу', () => {
    expect(CAMERA_MODES.map(nextCameraMode)).toEqual(['free', 'top', 'follow'])
  })

  it('вид сверху вписывает рамку по вертикальному и горизонтальному углу', () => {
    const tan = Math.tan((50 * Math.PI) / 360)
    // Глубина решает при широком окне
    expect(topViewDistance(1000, 2000, 50, 2, 1)).toBeCloseTo(1000 / tan, 6)
    // Ширина решает при узком
    expect(topViewDistance(4000, 1000, 50, 1, 1)).toBeCloseTo(2000 / tan, 6)
    expect(topViewDistance(1000, 1000, 50, 1)).toBeGreaterThan(topViewDistance(1000, 1000, 50, 1, 1))
  })

  it('угол сглаживается кратчайшим путём и не проскакивает цель', () => {
    const deg = (d: number) => (d * Math.PI) / 180
    const next = smoothAngle(deg(350), deg(10), 0.1, 5)
    // Через 360°, а не назад через 180°
    expect(next).toBeGreaterThan(deg(350))
    expect(next).toBeLessThan(deg(370))
    expect(smoothAngle(1, 2, 10, 5)).toBeCloseTo(2, 6)
    expect(smoothAngle(1, 2, 0, 5)).toBe(1)
  })
})

describe('фаза полёта', () => {
  const plan = buildFlightPlan({
    farm: FARM,
    takeoff: offsetGeo(CENTER, 0, -500),
    order: ['a', 'b'],
    flightAltitudeM: 90,
    maxAltitudeM: 120,
    returnToTakeoff: true,
  })
  const traj = buildTrajectory(plan, FARM, 10)
  const names = new Map(FARM.turbines.map((t) => [t.id, t.name]))
  const nameOf = (id: string) => names.get(id) ?? id
  const at = (t: number): TrajectorySample => sampleAt(traj, t)
  const midOf = (phase: string, visit?: number) => {
    const s = traj.segments.find((seg) => seg.phase === phase && (visit === undefined || seg.visitIndex === visit))
    if (!s) throw new Error(`нет отрезка ${phase}`)
    return s.startS + s.durationS / 2
  }

  it('ключ и подстановки для каждой фазы', () => {
    expect(phaseText(at(0), 2, nameOf)).toEqual({ key: 'sim.phase.takeoff' })
    expect(phaseText(at(midOf('transit', 1)), 2, nameOf)).toEqual({ key: 'sim.phase.transit', params: { n: 2, total: 2, name: 'WTG-B' } })
    expect(phaseText(at(midOf('approach', 0)), 2, nameOf)).toEqual({ key: 'sim.phase.approach', params: { n: 1, total: 2, name: 'WTG-A' } })
    expect(phaseText(at(midOf('orbit', 1)), 2, nameOf)).toEqual({ key: 'sim.phase.orbit', params: { n: 2, total: 2, name: 'WTG-B' } })
    expect(phaseText(at(midOf('return')), 2, nameOf)).toEqual({ key: 'sim.phase.return' })
    expect(phaseText(at(midOf('landing')), 2, nameOf)).toEqual({ key: 'sim.phase.landing' })
    expect(phaseText(at(traj.durationS), 2, nameOf)).toEqual({ key: 'sim.phase.finished' })
    expect(PHASE_KEYS).toContain('sim.phase.finished')
  })

  it('текущая турбина — только на перелёте к ней, выходе на ступицу и облёте', () => {
    expect(currentVisitIndex(at(0))).toBeNull()
    expect(currentVisitIndex(at(midOf('transit', 0)))).toBe(0)
    expect(currentVisitIndex(at(midOf('orbit', 1)))).toBe(1)
    expect(currentVisitIndex(at(midOf('return')))).toBeNull()
    expect(currentVisitIndex(at(traj.durationS))).toBeNull()
  })
})

describe('цвета пути и заряд', () => {
  it('облёт янтарный, остальное синее, конфликт красный поверх любой фазы', () => {
    expect(pathKind('orbit', false)).toBe('orbit')
    for (const phase of ['takeoff', 'transit', 'approach', 'return', 'landing'] as const) expect(pathKind(phase, false)).toBe('transit')
    expect(pathKind('orbit', true)).toBe('conflict')
    expect(pathKind('transit', true)).toBe('conflict')
    // Пройденное отличается от плана во всех видах
    for (const c of Object.values(PATH_COLORS)) expect(c.passed).not.toBe(c.plan)
  })

  it('резерв и пустая батарея', () => {
    expect(batteryLevel(80, 20)).toBe('ok')
    expect(batteryLevel(20, 20)).toBe('ok')
    expect(batteryLevel(19.9, 20)).toBe('reserve')
    expect(batteryLevel(0, 20)).toBe('reserve')
    expect(batteryLevel(-0.1, 20)).toBe('empty')
    expect(batteryLevel(Number.NEGATIVE_INFINITY, 20)).toBe('empty')
    expect(batteryLevel(Number.NaN, 20)).toBe('empty')
  })
})
