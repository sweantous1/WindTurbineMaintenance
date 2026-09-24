import { makeLocalFrame, type LocalPoint } from '@/lib/geo'
import type { Farm, FlightPlan, FlightWaypoint } from './types'

// Траектория облёта для 3D-просмотра: те же путевые точки, что у плана полёта на карте
// и в прогнозе, в тех же локальных метрах от центра фермы. Время — по крейсерской скорости
// дрона на всём пути, как в estimateMission: длительность проигрывания совпадает с оценкой
// времени полёта, которую показывают главная и погода

export type FlightPhase = 'takeoff' | 'transit' | 'approach' | 'orbit' | 'return' | 'landing'

// x — метры на восток, y — на север от центра фермы, z — высота над землёй
export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface TrajectorySegment {
  phase: FlightPhase
  // Турбина, к которой летим (transit), на высоту ступицы которой выходим (approach) или которую облетаем
  turbineId?: string
  // Номер турбины в порядке облёта, с нуля
  visitIndex?: number
  from: Vec3
  to: Vec3
  lengthM: number
  // Пройдено и прошло к началу отрезка
  startM: number
  startS: number
  durationS: number
  // Азимут носа дрона на отрезке (от севера по часовой, радианы). Для облёта и выхода
  // на высоту ступицы нос смотрит на турбину, и курс считается в каждой точке — см. sampleAt
  headingRad: number
}

export interface TurbineVisit {
  turbineId: string
  visitIndex: number
  center: LocalPoint
  // Начало перелёта к турбине, начало и конец облёта
  transitStartS: number
  orbitStartS: number
  orbitEndS: number
}

export interface Trajectory {
  // Отрезок i — между путевыми точками i и i + 1 плана: индексы совпадают с FlightConflict.segmentIndex
  segments: TrajectorySegment[]
  visits: TurbineVisit[]
  lengthM: number
  durationS: number
  speedMs: number
}

export interface TrajectorySample {
  position: Vec3
  yawRad: number
  segmentIndex: number
  phase: FlightPhase
  turbineId?: string
  visitIndex?: number
  distanceM: number
  timeS: number
  // Сколько турбин уже облетели целиком
  inspectedCount: number
  // Доля времени полёта, 0…1
  progress: number
  finished: boolean
}

// Отрезок короче сантиметра по горизонтали считается вертикальным: курс у него не определён
const HORIZONTAL_EPS_M = 0.01
const TIME_EPS_S = 1e-9
const FULL_TURN = 2 * Math.PI

export function buildTrajectory(plan: FlightPlan, farm: Farm, speedMs: number): Trajectory {
  if (!Number.isFinite(speedMs) || speedMs <= 0) {
    throw new RangeError(`Скорость должна быть положительной, получено ${speedMs}`)
  }
  // Та же система координат, что у buildFlightPlan: центр фермы
  const frame = makeLocalFrame(farm.center)
  const points: Vec3[] = plan.waypoints.map((w) => ({ ...frame.toLocal(w), z: w.altM }))
  const visitIndexOf = new Map(plan.turbineOrder.map((id, i) => [id, i]))

  const segments: TrajectorySegment[] = []
  let startM = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]
    const to = points[i + 1]
    const lengthM = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
    const { phase, turbineId } = classify(plan.waypoints[i], plan.waypoints[i + 1])
    const visitIndex = turbineId !== undefined ? visitIndexOf.get(turbineId) : undefined
    segments.push({
      phase,
      ...(turbineId !== undefined ? { turbineId } : {}),
      ...(visitIndex !== undefined ? { visitIndex } : {}),
      from,
      to,
      lengthM,
      startM,
      startS: startM / speedMs,
      durationS: lengthM / speedMs,
      headingRad: NaN,
    })
    startM += lengthM
  }
  fillHeadings(segments)

  const byId = new Map(farm.turbines.map((t) => [t.id, t]))
  const visits: TurbineVisit[] = []
  plan.turbineOrder.forEach((turbineId, visitIndex) => {
    const turbine = byId.get(turbineId)
    const own = segments.filter((s) => s.turbineId === turbineId)
    const orbit = own.filter((s) => s.phase === 'orbit')
    if (!turbine || own.length === 0) return
    const first = own[0]
    const lastOrbit = orbit[orbit.length - 1]
    visits.push({
      turbineId,
      visitIndex,
      center: frame.toLocal(turbine),
      transitStartS: first.startS,
      orbitStartS: orbit[0]?.startS ?? first.startS,
      orbitEndS: lastOrbit ? lastOrbit.startS + lastOrbit.durationS : first.startS + first.durationS,
    })
  })

  return { segments, visits, lengthM: startM, durationS: startM / speedMs, speedMs }
}

function classify(a: FlightWaypoint, b: FlightWaypoint): { phase: FlightPhase; turbineId?: string } {
  if (a.kind === 'takeoff') return { phase: 'takeoff' }
  if (b.kind === 'landing') return { phase: 'landing' }
  if (b.kind === 'orbit') {
    // Со входа на высоте транзита — вертикально на высоту ступицы; дальше — по кругу
    return { phase: a.kind === 'orbit' ? 'orbit' : 'approach', ...(b.turbineId !== undefined ? { turbineId: b.turbineId } : {}) }
  }
  if (b.turbineId !== undefined) return { phase: 'transit', turbineId: b.turbineId }
  return { phase: 'return' }
}

function isHorizontal(s: TrajectorySegment): boolean {
  return Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) >= HORIZONTAL_EPS_M
}

// Курс по ходу движения; вертикальный отрезок держит прежний курс, а подъём со взлётки —
// курс первого перелёта, чтобы дрон не разворачивался в воздухе сразу после взлёта
function fillHeadings(segments: TrajectorySegment[]): void {
  let last: number | undefined
  for (const s of segments) {
    if (isHorizontal(s)) last = bearingRad(s.from, s.to)
    if (last !== undefined) s.headingRad = last
  }
  const first = segments.find(isHorizontal)
  const initial = first ? bearingRad(first.from, first.to) : 0
  for (const s of segments) {
    if (!Number.isNaN(s.headingRad)) break
    s.headingRad = initial
  }
}

// Азимут от a на b: 0 — север, π/2 — восток
export function bearingRad(a: LocalPoint, b: LocalPoint): number {
  const r = Math.atan2(b.x - a.x, b.y - a.y) % FULL_TURN
  return r < 0 ? r + FULL_TURN : r
}

export function sampleAt(traj: Trajectory, timeS: number): TrajectorySample {
  const { segments, durationS } = traj
  if (segments.length === 0) {
    return {
      position: { x: 0, y: 0, z: 0 },
      yawRad: 0,
      segmentIndex: -1,
      phase: 'landing',
      distanceM: 0,
      timeS: 0,
      inspectedCount: 0,
      progress: 1,
      finished: true,
    }
  }
  const t = Number.isFinite(timeS) ? Math.min(Math.max(timeS, 0), durationS) : 0
  const finished = t >= durationS - TIME_EPS_S
  const index = finished ? segments.length - 1 : segmentIndexAt(segments, t)
  const seg = segments[index]
  const f = finished ? 1 : seg.durationS > 0 ? Math.min(1, (t - seg.startS) / seg.durationS) : 1
  const position: Vec3 = {
    x: seg.from.x + (seg.to.x - seg.from.x) * f,
    y: seg.from.y + (seg.to.y - seg.from.y) * f,
    z: seg.from.z + (seg.to.z - seg.from.z) * f,
  }
  return {
    position,
    yawRad: yawAt(traj, seg, position),
    segmentIndex: index,
    phase: seg.phase,
    ...(seg.turbineId !== undefined ? { turbineId: seg.turbineId } : {}),
    ...(seg.visitIndex !== undefined ? { visitIndex: seg.visitIndex } : {}),
    distanceM: seg.startM + seg.lengthM * f,
    timeS: t,
    inspectedCount: traj.visits.filter((v) => v.orbitEndS <= t + TIME_EPS_S).length,
    progress: durationS > 0 ? t / durationS : 1,
    finished,
  }
}

// Последний отрезок, начавшийся не позже t. Отрезки нулевой длины начинаются одновременно
// со следующим — берётся следующий: нулевой отрезок к этому моменту уже пройден
function segmentIndexAt(segments: readonly TrajectorySegment[], t: number): number {
  let lo = 0
  let hi = segments.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segments[mid].startS <= t + TIME_EPS_S) lo = mid
    else hi = mid - 1
  }
  return lo
}

function yawAt(traj: Trajectory, seg: TrajectorySegment, p: Vec3): number {
  if ((seg.phase === 'orbit' || seg.phase === 'approach') && seg.turbineId !== undefined) {
    const visit = traj.visits.find((v) => v.turbineId === seg.turbineId)
    if (visit && Math.hypot(visit.center.x - p.x, visit.center.y - p.y) > HORIZONTAL_EPS_M) return bearingRad(p, visit.center)
  }
  return seg.headingRad
}

// Израсходованный заряд к моменту t — той же моделью, что estimateMission (без ветра)
export function batteryUsedPct(timeS: number, enduranceMin: number): number {
  if (!(enduranceMin > 0)) return Infinity
  return (Math.max(0, timeS) / 60 / enduranceMin) * 100
}
