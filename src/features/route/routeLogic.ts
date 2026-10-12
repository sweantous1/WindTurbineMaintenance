import type { Farm, FlightPlan, GeoPoint, Mission, MissionPatch, RouteAlgorithm, RoutePlan, Turbine } from '@/domain/types'
import type { SolveResult } from '@/domain/route'
import { buildFlightPlan } from '@/domain/flightPlan'
import { createRouteModel } from '@/domain/route/matrix'
import { countTurnViolations } from '@/domain/route/turns'
import { makeLocalFrame, type LocalPoint } from '@/lib/geo'

// Логика экрана маршрута без React: перевод точек для решателя, сборка RoutePlan
// и пересчёт плана после ручной правки фермы, порядка, взлёта или высоты

// Всё, от чего зависит план полёта, кроме самого порядка
export interface RouteContext {
  farm: Farm
  takeoff: GeoPoint
  flightAltitudeM: number
  // Потолок: меньшее из ограничений миссии и дрона (effectiveLimits)
  maxAltitudeM: number
}

// то, что выбирают перед "Построить маршрут"
export interface OptimizerSettings {
  algorithm: RouteAlgorithm
  params: Record<string, number>
  thetaMaxDeg: number
  returnToTakeoff: boolean
}

type MissionRouteFields = Pick<Mission, 'farm' | 'takeoff' | 'route' | 'flightAltitudeM'>

// Пока точку взлёта не задали, взлетаем из центра фермы
export function effectiveTakeoff(m: Pick<Mission, 'farm' | 'takeoff'>): GeoPoint | undefined {
  return m.takeoff ?? m.farm?.center
}

export function routeContext(m: Pick<Mission, 'farm' | 'takeoff' | 'flightAltitudeM'>, maxAltitudeM: number): RouteContext | undefined {
  const takeoff = effectiveTakeoff(m)
  if (!m.farm || !takeoff) return undefined
  return { farm: m.farm, takeoff, flightAltitudeM: m.flightAltitudeM, maxAltitudeM }
}

// Точки для решателя: [взлёт, ...турбины] в локальных метрах от центра фермы
export function toSolvePoints(farm: Farm, takeoff: GeoPoint): LocalPoint[] {
  const frame = makeLocalFrame(farm.center)
  return [frame.toLocal(takeoff), ...farm.turbines.map((t) => frame.toLocal(t))]
}

// индексы решателя 1..n -> id турбин фермы, по которой строились точки
export function orderFromVisit(farm: Farm, visit: readonly number[]): string[] {
  const seen = new Set<number>()
  return visit.map((i) => {
    const t = Number.isInteger(i) ? farm.turbines[i - 1] : undefined
    if (!t || seen.has(i)) throw new Error(`Решатель вернул неверный индекс турбины: ${i}`)
    seen.add(i)
    return t.id
  })
}

// Порядок без турбин, которых уже нет в ферме, и без повторов
export function cleanOrder(farm: Farm, order: readonly string[]): string[] {
  const ids = new Set(farm.turbines.map((t) => t.id))
  const seen = new Set<string>()
  return order.filter((id) => {
    if (!ids.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function planFor(ctx: RouteContext, order: readonly string[], returnToTakeoff: boolean): FlightPlan {
  return buildFlightPlan({
    farm: ctx.farm,
    takeoff: ctx.takeoff,
    order: [...order],
    flightAltitudeM: ctx.flightAltitudeM,
    maxAltitudeM: ctx.maxAltitudeM,
    returnToTakeoff,
  })
}

// Считаем той же моделью, что и решатель, чтобы после ручной правки число совпадало
// с тем, что он насчитал бы для этого порядка
export function countOrderTurnViolations(
  ctx: Pick<RouteContext, 'farm' | 'takeoff'>,
  order: readonly string[],
  closed: boolean,
  thetaMaxDeg: number,
): number {
  if (!(thetaMaxDeg < 180)) return 0
  const byId = new Map(ctx.farm.turbines.map((t) => [t.id, t]))
  const visited = cleanOrder(ctx.farm, order).flatMap((id) => {
    const t = byId.get(id)
    return t ? [t] : []
  })
  if (visited.length === 0) return 0
  // модель только по точкам маршрута, на больших фермах так заметно дешевле
  const frame = makeLocalFrame(ctx.farm.center)
  const points = [frame.toLocal(ctx.takeoff), ...visited.map((t) => frame.toLocal(t))]
  const model = createRouteModel(points, closed, thetaMaxDeg)
  return countTurnViolations(
    model,
    visited.map((_, k) => k + 1),
  )
}

export function routeFromSolve(
  ctx: RouteContext,
  result: SolveResult,
  settings: OptimizerSettings,
  computedAt: string,
): { route: RoutePlan; plan: FlightPlan } {
  const order = orderFromVisit(ctx.farm, result.visit)
  const plan = planFor(ctx, order, settings.returnToTakeoff)
  const route: RoutePlan = {
    algorithm: settings.algorithm,
    params: { ...settings.params },
    thetaMaxDeg: settings.thetaMaxDeg,
    returnToTakeoff: settings.returnToTakeoff,
    order,
    // длина всего плана (с облётами и подъёмами), а не ломаной по центрам башен
    lengthM: plan.lengthM,
    turnViolations: result.turnViolations,
    source: 'auto',
    computedAt,
  }
  return { route, plan }
}

// Порядок сохраняем (без удалённых турбин), длину и нарушения считаем заново.
// edited = false, если поменялось то, что на порядок не влияет (высота транзита)
export function recomputeRoute(
  route: RoutePlan,
  ctx: RouteContext,
  opts: { edited: boolean; order?: readonly string[] },
): RoutePlan | undefined {
  const order = cleanOrder(ctx.farm, opts.order ?? route.order)
  if (order.length === 0) return undefined
  const plan = planFor(ctx, order, route.returnToTakeoff)
  return {
    ...route,
    order,
    lengthM: plan.lengthM,
    turnViolations: countOrderTurnViolations(ctx, order, route.returnToTakeoff, route.thetaMaxDeg),
    source: opts.edited ? 'edited' : route.source,
  }
}

// сдвиг на delta позиций; за край списка не сдвигаем
export function moveInOrder(order: readonly string[], index: number, delta: number): string[] {
  const target = index + delta
  if (index < 0 || index >= order.length || target < 0 || target >= order.length || delta === 0) return [...order]
  const next = [...order]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

// по id, а не по индексу: индекс устаревает, если две перестановки идут быстрее перерисовки
export function moveIdInOrder(order: readonly string[], id: string, delta: number): string[] {
  return moveInOrder(order, order.indexOf(id), delta)
}

// патчи миссии

// route: undefined значит сбросить маршрут (так это понимает missions.update)
function withRoute(patch: MissionPatch, m: MissionRouteFields, next: Pick<Mission, 'farm' | 'takeoff' | 'flightAltitudeM'>, maxAltitudeM: number, edited: boolean, order?: readonly string[]): MissionPatch {
  if (!m.route) return patch
  const ctx = routeContext(next, maxAltitudeM)
  return { ...patch, route: ctx ? recomputeRoute(m.route, ctx, { edited, order }) : undefined }
}

// ручная правка фермы: маршрут сохраняет порядок и помечается изменённым
export function farmEditPatch(m: MissionRouteFields, farm: Farm, maxAltitudeM: number): MissionPatch {
  return withRoute({ farm }, m, { ...m, farm }, maxAltitudeM, true)
}

// под новую точку взлёта порядок не оптимизировался, так что маршрут тоже изменённый
export function takeoffPatch(m: MissionRouteFields, takeoff: GeoPoint, maxAltitudeM: number): MissionPatch {
  return withRoute({ takeoff }, m, { ...m, takeoff }, maxAltitudeM, true)
}

// высота транзита на порядок не влияет, меняется только длина
export function altitudePatch(m: MissionRouteFields, flightAltitudeM: number, maxAltitudeM: number): MissionPatch {
  return withRoute({ flightAltitudeM }, m, { ...m, flightAltitudeM }, maxAltitudeM, false)
}

export function orderPatch(m: MissionRouteFields, order: readonly string[], maxAltitudeM: number): MissionPatch {
  return withRoute({}, m, m, maxAltitudeM, true, order)
}

// длина разошлась с планом (высоту или профиль дрона поменяли на другом экране)
export function lengthDrifted(route: RoutePlan, plan: FlightPlan): boolean {
  return Math.abs(route.lengthM - plan.lengthM) > 0.01
}

// отпечаток входных данных: если за время расчёта он поменялся, результат устарел
export function solveSignature(farm: Farm, takeoff: GeoPoint): string {
  const turbines = farm.turbines.map((t: Turbine) => `${t.id}@${t.lat},${t.lon}`).join(';')
  return `${farm.center.lat},${farm.center.lon}|${takeoff.lat},${takeoff.lon}|${turbines}`
}
