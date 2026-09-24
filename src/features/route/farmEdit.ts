import type { Farm, FarmDefaults, GeoPoint, Mission, MissionPatch, Turbine } from '@/domain/types'
import { DEFAULT_FARM_DEFAULTS } from '@/domain/defaults'
import { centroid, haversineM } from '@/lib/geo'
import { farmFromImport, type FarmImport } from '@/lib/kml'

// Ручная правка фермы на карте и замена фермы импортом

// Дальше этого старую точку взлёта для новой фермы предлагаем перенести: скорее всего,
// ферма другая, а локальная система координат точна примерно до 30 км от центра
export const FAR_TAKEOFF_M = 10_000

const NUMBERED_ID = /^t(\d+)$/i

// Номер новой турбины — больше всех «tN» и «TN» среди id и имён, чтобы не совпасть ни с одной
function nextTurbineNumber(turbines: readonly Turbine[]): number {
  let max = turbines.length
  for (const t of turbines) {
    for (const s of [t.id, t.name]) {
      const m = NUMBERED_ID.exec(s)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  const ids = new Set(turbines.map((t) => t.id))
  let n = max + 1
  while (ids.has(`t${n}`)) n++
  return n
}

// Центр пересчитывается: от него строится локальная система координат и берётся прогноз
function withTurbines(farm: Farm, turbines: Turbine[]): Farm {
  return { ...farm, turbines, center: turbines.length > 0 ? centroid(turbines) : farm.center }
}

// Турбина кликом по карте; без фермы создаётся новая с параметрами по умолчанию
export function addTurbine(farm: Farm | undefined, p: GeoPoint): { farm: Farm; turbine: Turbine } {
  const base: Farm = farm ?? { center: { lat: p.lat, lon: p.lon }, defaults: { ...DEFAULT_FARM_DEFAULTS }, turbines: [] }
  const n = nextTurbineNumber(base.turbines)
  const turbine: Turbine = { id: `t${n}`, name: `T${n}`, lat: p.lat, lon: p.lon }
  return { farm: withTurbines(base, [...base.turbines, turbine]), turbine }
}

// Последнюю турбину тоже можно удалить: ферма остаётся с параметрами по умолчанию и прежним центром
export function removeTurbine(farm: Farm, id: string): Farm {
  return withTurbines(
    farm,
    farm.turbines.filter((t) => t.id !== id),
  )
}

export function moveTurbine(farm: Farm, id: string, p: GeoPoint): Farm {
  return withTurbines(
    farm,
    farm.turbines.map((t) => {
      if (t.id !== id) return t
      // Высота рельефа из файла относится к старой точке — на новом месте она неизвестна
      const { groundAltM, ...rest } = t
      void groundAltM
      return { ...rest, lat: p.lat, lon: p.lon }
    }),
  )
}

export function setFarmDefaults(farm: Farm, patch: Partial<FarmDefaults>): Farm {
  return { ...farm, defaults: { ...farm.defaults, ...patch } }
}

// Насколько сохранённая точка взлёта далеко от центра импортируемой фермы; undefined — взлёт не задан
export function importTakeoffDistanceM(takeoff: GeoPoint | undefined, imp: Pick<FarmImport, 'turbines'>): number | undefined {
  if (!takeoff || imp.turbines.length === 0) return undefined
  return haversineM(takeoff, centroid(imp.turbines))
}

// Замена фермы импортом: маршрут сбрасывается, взлёт по умолчанию — центр новой фермы
export function importPatch(m: Pick<Mission, 'farm' | 'takeoff'>, imp: FarmImport, opts: { moveTakeoff: boolean }): MissionPatch {
  const farm = farmFromImport(imp, m.farm)
  const takeoff = !m.takeoff || opts.moveTakeoff ? farm.center : m.takeoff
  return { farm, route: undefined, takeoff }
}
