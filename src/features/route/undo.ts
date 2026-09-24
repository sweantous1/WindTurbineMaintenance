import type { Farm, Mission, MissionPatch, RoutePlan } from '@/domain/types'

// Отмена правки фермы (перенос и удаление турбины): маркер легко сдвинуть случайно,
// а координаты и высота рельефа из файла после этого пропадают

export interface FarmState {
  farm?: Farm
  route?: RoutePlan
}

// Состояние фермы и маршрута после применения патча
export function stateAfter(m: Pick<Mission, 'farm' | 'route'>, patch: MissionPatch): FarmState {
  return {
    farm: 'farm' in patch ? patch.farm : m.farm,
    route: 'route' in patch ? patch.route : m.route,
  }
}

// Данные из IndexedDB приходят копией, поэтому сравнение по содержимому
const sameData = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Откат только если с тех пор ферму и маршрут никто не менял: иначе он затёр бы более поздние правки.
// null — отменять уже нельзя
export function undoPatch(current: Pick<Mission, 'farm' | 'route'>, before: FarmState, after: FarmState): MissionPatch | null {
  if (!before.farm) return null
  if (!sameData(current.farm, after.farm) || !sameData(current.route, after.route)) return null
  // route: undefined очищает маршрут, если до правки его не было
  return { farm: before.farm, route: before.route }
}
