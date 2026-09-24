import type { Farm, FlightPlan, FlightWaypoint, GeoPoint, Turbine } from '@/domain/types'
import { orbitRadiusM, turbineHubM } from '@/domain/flightPlan'
import { bbox } from '@/lib/geo'
import { cleanOrder } from './routeLogic'

// Геометрия плана для карты и тексты про отрезки плана — без Leaflet, чтобы проверялось тестами

export type LatLngTuple = [number, number]

export interface PlanLines {
  // Транзит без конфликтов — пунктир
  transit: LatLngTuple[][]
  // Отрезки транзита, проходящие слишком близко к чужой башне, — красным
  conflict: LatLngTuple[][]
  // Конфликт на вертикальном отрезке (подъём или спуск на месте): в плане это точка
  conflictPoints: LatLngTuple[]
}

const tuple = (p: GeoPoint): LatLngTuple => [p.lat, p.lon]
const samePlace = (a: GeoPoint, b: GeoPoint) => a.lat === b.lat && a.lon === b.lon

// Дуги облёта рисуются окружностями отдельно (orbitCircles), здесь — только перелёты.
// Соседние отрезки одного вида склеиваются в одну линию: меньше слоёв на карте
export function planLines(plan: FlightPlan): PlanLines {
  const conflictSegments = new Set(plan.conflicts.map((c) => c.segmentIndex))
  const lines: PlanLines = { transit: [], conflict: [], conflictPoints: [] }
  let current: { kind: 'transit' | 'conflict'; points: LatLngTuple[]; lastIndex: number } | null = null
  const wps = plan.waypoints
  for (let i = 0; i + 1 < wps.length; i++) {
    const a = wps[i]
    const b = wps[i + 1]
    if (a.kind === 'orbit' && b.kind === 'orbit') continue
    const isConflict = conflictSegments.has(i)
    if (samePlace(a, b)) {
      if (isConflict) lines.conflictPoints.push(tuple(a))
      continue
    }
    const kind = isConflict ? 'conflict' : 'transit'
    if (current && current.kind === kind && current.lastIndex === i - 1) {
      current.points.push(tuple(b))
    } else {
      current = { kind, points: [tuple(a), tuple(b)], lastIndex: i }
      lines[kind].push(current.points)
    }
    current.lastIndex = i
  }
  return lines
}

export interface OrbitCircle {
  turbineId: string
  center: GeoPoint
  radiusM: number
}

export function orbitCircles(farm: Farm, order: readonly string[]): OrbitCircle[] {
  const byId = new Map(farm.turbines.map((t) => [t.id, t]))
  return cleanOrder(farm, order).flatMap((id) => {
    const t = byId.get(id)
    return t ? [{ turbineId: id, center: { lat: t.lat, lon: t.lon }, radiusM: orbitRadiusM(farm, t) }] : []
  })
}

// Номер турбины в облёте, с единицы
export function orderNumbers(order: readonly string[]): Map<string, number> {
  return new Map(order.map((id, i) => [id, i + 1]))
}

export type EndpointRef = { kind: 'takeoff' } | { kind: 'landing' } | { kind: 'turbine'; id: string }

// Откуда и куда ведёт отрезок плана — чтобы описать конфликт словами, а не номером отрезка
export function segmentEndpoints(plan: FlightPlan, index: number): { from: EndpointRef; to: EndpointRef; vertical: boolean } | undefined {
  const a: FlightWaypoint | undefined = plan.waypoints[index]
  const b: FlightWaypoint | undefined = plan.waypoints[index + 1]
  if (!a || !b) return undefined
  const ref = (w: FlightWaypoint): EndpointRef => {
    if (w.turbineId !== undefined) return { kind: 'turbine', id: w.turbineId }
    return w.kind === 'landing' ? { kind: 'landing' } : { kind: 'takeoff' }
  }
  return { from: ref(a), to: ref(b), vertical: samePlace(a, b) }
}

// Границы вида карты: [[юг, запад], [север, восток]]
export function viewBounds(points: readonly GeoPoint[]): [LatLngTuple, LatLngTuple] | undefined {
  if (points.length === 0) return undefined
  const b = bbox([...points])
  return [
    [b.south, b.west],
    [b.north, b.east],
  ]
}

// Турбины, облёт которых на высоте ступицы выше разрешённого потолка
export function turbinesAboveCeiling(farm: Farm, ceilingM: number): Turbine[] {
  return farm.turbines.filter((t) => turbineHubM(farm, t) > ceilingM)
}

// Путь для KML: без повторов точки подряд (подъёмы и спуски на месте)
export function planPath(plan: FlightPlan): GeoPoint[] {
  const out: GeoPoint[] = []
  for (const w of plan.waypoints) {
    const last = out[out.length - 1]
    if (!last || !samePlace(last, w)) out.push({ lat: w.lat, lon: w.lon })
  }
  return out
}
