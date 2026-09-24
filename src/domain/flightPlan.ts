import { distPointToSegment, makeLocalFrame, type LocalPoint } from '@/lib/geo'
import { effectiveLimits } from './flightCheck'
import type { DroneProfile, Farm, FlightConflict, FlightPlan, FlightWaypoint, GeoPoint, Mission, Turbine, WaypointKind } from './types'

// План полёта по готовому порядку турбин: взлёт, подъём на высоту транзита, у каждой
// турбины — облёт многоугольником вокруг круга безопасной дистанции на высоте ступицы,
// затем возврат или посадка. Считается в локальных метрах от центра фермы, хранится в WGS84

export const DEFAULT_ORBIT_SEGMENTS = 12
const MIN_ORBIT_SEGMENTS = 3
const MAX_ORBIT_SEGMENTS = 360
// Отрезок, начинающийся ровно на окружности облёта, не должен считаться заходом внутрь
// из-за ошибок округления
const BOUNDARY_TOLERANCE_M = 1e-3
// Доворот к выходу короче метра не делаем: почти совпадающие путевые точки автопилот
// может отвергнуть, а на безопасность такой недоворот не влияет — отрезок, уходящий
// с окружности наружу, внутрь круга уже не заходит
const MIN_EXIT_ARC_M = 1
// Чтобы доворот ровно на k шагов из-за погрешности не делился на k + 1
const STEP_EPSILON = 1e-9
const FULL_TURN = 2 * Math.PI

export interface FlightPlanInput {
  farm: Farm
  takeoff: GeoPoint
  // id турбин в порядке облёта; неизвестные и повторные пропускаются
  order: string[]
  flightAltitudeM: number
  maxAltitudeM: number
  returnToTakeoff: boolean
  // Сколько отрезков в окружности облёта; по умолчанию 12
  orbitSegments?: number
}

export function turbineHubM(farm: Farm, t: Turbine): number {
  return t.hubHeightM ?? farm.defaults.hubHeightM
}

export function turbineRotorM(farm: Farm, t: Turbine): number {
  return t.rotorDiameterM ?? farm.defaults.rotorDiameterM
}

// Облёт идёт на безопасной дистанции от конца лопасти при любом положении ротора
export function orbitRadiusM(farm: Farm, t: Turbine): number {
  return turbineRotorM(farm, t) / 2 + farm.defaults.safeDistanceM
}

// Радиус, на котором стоят вершины облёта. Между вершинами дрон летит по прямой, и хорды
// вписанного в круг многоугольника срезали бы безопасную дистанцию (при роторе 300 м и
// запасе 5 м — до захода в диск ротора). Стороны описанного многоугольника лишь касаются
// круга orbitRadiusM, поэтому он и остаётся гарантированной минимальной дистанцией
export function orbitPathRadiusM(farm: Farm, t: Turbine, orbitSegments?: number): number {
  return orbitRadiusM(farm, t) / Math.cos(Math.PI / resolveOrbitSegments(orbitSegments))
}

interface PlanPoint extends LocalPoint {
  kind: WaypointKind
  turbineId?: string
  altM: number
}

export function buildFlightPlan(input: FlightPlanInput): FlightPlan {
  // NaN в высотах молча прошёл бы через все сравнения в проверке погоды
  for (const [name, value] of [['flightAltitudeM', input.flightAltitudeM], ['maxAltitudeM', input.maxAltitudeM]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} должно быть неотрицательным числом, получено ${value}`)
  }
  const { farm } = input
  const frame = makeLocalFrame(farm.center)
  const segments = resolveOrbitSegments(input.orbitSegments)
  const transitAltM = Math.min(input.flightAltitudeM, input.maxAltitudeM)
  const byId = new Map(farm.turbines.map((t) => [t.id, t]))

  const visited: Turbine[] = []
  const seen = new Set<string>()
  for (const id of input.order) {
    const t = byId.get(id)
    if (!t || seen.has(id)) continue
    seen.add(id)
    visited.push(t)
  }

  const home = frame.toLocal(input.takeoff)
  const pts: PlanPoint[] = [
    { kind: 'takeoff', ...home, altM: 0 },
    { kind: 'transit', ...home, altM: transitAltM },
  ]

  let cur: LocalPoint = home
  visited.forEach((t, k) => {
    const center = frame.toLocal(t)
    // Вход и выход — на том же радиусе, что и вершины: иначе спуск ко входу не был бы вертикальным
    const pathRadius = orbitPathRadiusM(farm, t, segments)
    const hubM = turbineHubM(farm, t)
    // Вход — ближайшая к текущей позиции точка окружности
    const entryAngle = angleFrom(center, cur)
    pts.push({ kind: 'transit', turbineId: t.id, ...onCircle(center, pathRadius, entryAngle), altM: transitAltM })

    // Куда лететь после облёта: к следующей турбине или домой. Выход — точка окружности
    // в сторону цели: улетая от неё по прямой, дрон не пересекает облётный круг
    // и не проходит сквозь башню
    const next = visited[k + 1]
    const target = next ? frame.toLocal(next) : input.returnToTakeoff ? home : undefined
    const exitAngle = target ? angleFrom(center, target) : entryAngle
    // Направление облёта выбирается так, чтобы доворот до выхода был не больше полукруга
    const ccwExtra = normalizeAngle(exitAngle - entryAngle)
    const dir = ccwExtra <= Math.PI ? 1 : -1
    const extra = dir === 1 ? ccwExtra : FULL_TURN - ccwExtra

    const step = FULL_TURN / segments
    for (let s = 0; s <= segments; s++) {
      // Последняя точка — ровно точка входа: круг замыкается без накопленной погрешности
      const angle = s === segments ? entryAngle : entryAngle + dir * step * s
      pts.push({ kind: 'orbit', turbineId: t.id, ...onCircle(center, pathRadius, angle), altM: hubM })
    }
    if (extra * pathRadius >= MIN_EXIT_ARC_M) {
      // Доворот — равными шагами не длиннее шага облёта: хорда длиннее шага срезала бы
      // безопасную дистанцию, а равные шаги не оставляют хвоста в полметра
      const extraSteps = Math.max(1, Math.ceil(extra / step - STEP_EPSILON))
      for (let s = 1; s <= extraSteps; s++) {
        const angle = s === extraSteps ? exitAngle : entryAngle + (dir * extra * s) / extraSteps
        pts.push({ kind: 'orbit', turbineId: t.id, ...onCircle(center, pathRadius, angle), altM: hubM })
      }
    }
    cur = pts[pts.length - 1]
  })

  if (input.returnToTakeoff) {
    pts.push({ kind: 'transit', ...home, altM: transitAltM })
    pts.push({ kind: 'landing', ...home, altM: 0 })
  } else {
    pts.push({ kind: 'landing', x: cur.x, y: cur.y, altM: 0 })
  }

  const waypoints: FlightWaypoint[] = pts.map((p) => {
    // Точки над местом взлёта берут его исходные координаты, без круга через проекцию
    const geo = p.x === home.x && p.y === home.y ? input.takeoff : frame.toGeo(p)
    const wp: FlightWaypoint = { kind: p.kind, lat: geo.lat, lon: geo.lon, altM: p.altM }
    if (p.turbineId !== undefined) wp.turbineId = p.turbineId
    return wp
  })

  let lengthM = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    lengthM += Math.hypot(b.x - a.x, b.y - a.y, b.altM - a.altM)
  }

  const levels = new Set<number>([transitAltM, ...visited.map((t) => turbineHubM(farm, t))])

  return {
    waypoints,
    transitAltM,
    altitudeLevelsM: [...levels].sort((a, b) => a - b),
    maxAltM: pts.reduce((m, p) => Math.max(m, p.altM), -Infinity),
    lengthM,
    turbineOrder: visited.map((t) => t.id),
    conflicts: findConflicts(farm, frame.toLocal, pts),
  }
}

// Длина плана полёта миссии — тем же построением, что на экранах: взлёт из точки взлёта или,
// пока её не задали, из центра фермы; потолок — общий для миссии и дрона.
// undefined — плана нет: нет фермы или маршрута либо в порядке не осталось турбин фермы
export function missionPlanLengthM(
  m: Pick<Mission, 'farm' | 'takeoff' | 'route' | 'flightAltitudeM' | 'limits'>,
  drone: DroneProfile,
): number | undefined {
  const { farm, route } = m
  if (!farm || !route || route.order.length === 0) return undefined
  const plan = buildFlightPlan({
    farm,
    takeoff: m.takeoff ?? farm.center,
    order: route.order,
    flightAltitudeM: m.flightAltitudeM,
    maxAltitudeM: effectiveLimits(m.limits, drone).maxAltitudeM,
    returnToTakeoff: route.returnToTakeoff,
  })
  return plan.turbineOrder.length > 0 ? plan.lengthM : undefined
}

function resolveOrbitSegments(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_ORBIT_SEGMENTS
  return Math.min(MAX_ORBIT_SEGMENTS, Math.max(MIN_ORBIT_SEGMENTS, Math.round(value)))
}

function angleFrom(center: LocalPoint, p: LocalPoint): number {
  const dx = p.x - center.x
  const dy = p.y - center.y
  // Стоим над самой башней — направление не определено, заходим с востока
  return Math.hypot(dx, dy) < 1e-9 ? 0 : Math.atan2(dy, dx)
}

function onCircle(center: LocalPoint, radius: number, angle: number): LocalPoint {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }
}

function normalizeAngle(a: number): number {
  const r = a % FULL_TURN
  return r < 0 ? r + FULL_TURN : r
}

// Конфликт: отрезок плана заходит в круг облёта башни ниже верха лопасти плюс безопасная
// дистанция. Проверяются все отрезки, включая облёты, и все башни, включая ту, к которой
// летим: облёт соседа может пройти сквозь чужой ротор, а перелёт с выхода предыдущего облёта
// — начаться внутри круга следующей башни. Свой круг правильный план не задевает: стороны
// облёта его касаются, вход и выход лежат снаружи, а путь к ним и от них радиальный
function findConflicts(farm: Farm, toLocal: (p: GeoPoint) => LocalPoint, pts: PlanPoint[]): FlightConflict[] {
  const towers = farm.turbines.map((t) => ({
    id: t.id,
    center: toLocal(t),
    radius: orbitRadiusM(farm, t),
    clearAltM: turbineHubM(farm, t) + turbineRotorM(farm, t) / 2 + farm.defaults.safeDistanceM,
  }))
  const conflicts: FlightConflict[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    for (const tower of towers) {
      const lowestInside = lowestAltInsideCircle(a, b, tower.center, tower.radius - BOUNDARY_TOLERANCE_M)
      if (lowestInside === null || lowestInside >= tower.clearAltM) continue
      conflicts.push({
        segmentIndex: i,
        turbineId: tower.id,
        distanceM: distPointToSegment(tower.center, a, b),
        minDistanceM: tower.radius,
      })
    }
  }
  return conflicts
}

// Самая низкая высота на той части отрезка, что проходит в плане внутри круга;
// null — отрезок в круг не заходит. Высота меняется вдоль отрезка линейно,
// поэтому минимум — на одном из концов этой части
function lowestAltInsideCircle(a: PlanPoint, b: PlanPoint, center: LocalPoint, radius: number): number | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const wx = a.x - center.x
  const wy = a.y - center.y
  const dd = dx * dx + dy * dy
  const c0 = wx * wx + wy * wy - radius * radius
  let t0: number
  let t1: number
  if (dd < 1e-12) {
    if (c0 >= 0) return null
    t0 = 0
    t1 = 1
  } else {
    const half = wx * dx + wy * dy
    const disc = half * half - dd * c0
    if (disc <= 0) return null
    const root = Math.sqrt(disc)
    t0 = Math.max(0, (-half - root) / dd)
    t1 = Math.min(1, (-half + root) / dd)
    if (t0 >= t1) return null
  }
  const alt = (t: number) => a.altM + (b.altM - a.altM) * t
  return Math.min(alt(t0), alt(t1))
}
