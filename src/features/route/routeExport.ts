import type { Farm, FlightPlan, Mission, RoutePlan } from '@/domain/types'
import { farmToKml } from '@/lib/kml'
import { cleanOrder } from './routeLogic'
import { planPath } from './planGeometry'

// Выгрузка фермы и маршрута: JSON с полными данными (для других программ или архива),
// KML для просмотра в Google Earth

export const ROUTE_EXPORT_FORMAT = 'wtm-route'
export const ROUTE_EXPORT_VERSION = 1

export interface RouteExport {
  format: typeof ROUTE_EXPORT_FORMAT
  version: typeof ROUTE_EXPORT_VERSION
  exportedAt: string
  mission: { id: string; name: string; flightAltitudeM: number }
  farm: Farm
  takeoff?: Mission['takeoff']
  route?: RoutePlan
  plan?: FlightPlan
}

export function routeExportJson(
  m: Pick<Mission, 'id' | 'name' | 'flightAltitudeM' | 'takeoff' | 'route'> & { farm: Farm },
  plan: FlightPlan | undefined,
  exportedAt: string,
): string {
  const data: RouteExport = {
    format: ROUTE_EXPORT_FORMAT,
    version: ROUTE_EXPORT_VERSION,
    exportedAt,
    mission: { id: m.id, name: m.name, flightAltitudeM: m.flightAltitudeM },
    farm: m.farm,
    ...(m.takeoff ? { takeoff: m.takeoff } : {}),
    ...(m.route ? { route: m.route } : {}),
    ...(plan ? { plan } : {}),
  }
  return JSON.stringify(data, null, 2)
}

// Турбины в порядке облёта с номерами и линия всего плана полёта
export function routeExportKml(farm: Farm, route: RoutePlan | undefined, plan: FlightPlan | undefined, name?: string): string {
  const order = route ? cleanOrder(farm, route.order) : undefined
  return farmToKml(farm, {
    ...(name ? { name } : {}),
    ...(order && order.length > 0 ? { order } : {}),
    ...(plan ? { path: planPath(plan) } : {}),
  })
}

const MAX_BASE_LENGTH = 80
// Символы, запрещённые в именах файлов Windows, и управляющие
const isForbiddenFileChar = (ch: string) => ch.charCodeAt(0) < 0x20 || '<>:"/\\|?*'.includes(ch)
// Зарезервированные имена устройств Windows: такой файл не создать
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i

export function exportFileName(base: string, ext: 'json' | 'kml'): string {
  const replaced = Array.from(base, (ch) => (isForbiddenFileChar(ch) ? ' ' : ch)).join('')
  // Имя режется по символам, а не по UTF-16: суррогатная пара не разрывается
  const clean = Array.from(replaced.replace(/\s+/g, ' ').trim())
    .slice(0, MAX_BASE_LENGTH)
    .join('')
    // Windows не принимает имя, оканчивающееся точкой или пробелом
    .replace(/[. ]+$/, '')
  if (!clean) return `route.${ext}`
  return `${RESERVED_NAMES.test(clean) ? `${clean}_` : clean}.${ext}`
}
