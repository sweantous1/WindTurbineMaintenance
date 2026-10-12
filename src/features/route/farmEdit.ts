import type { Farm, FarmDefaults, GeoPoint, Mission, MissionPatch, Turbine, WeatherSnapshot } from '@/domain/types'
import { DEFAULT_FARM_DEFAULTS } from '@/domain/defaults'
import { centroid, haversineM } from '@/lib/geo'
import { farmFromImport, type FarmImport } from '@/lib/kml'
import { FAR_FROM_FARM_M } from '@/features/weather/location'

// Ручная правка фермы на карте и замена фермы импортом

// дальше этого предлагаем перенести взлёт к новой ферме: скорее всего ферма другая,
// а локальные координаты точны примерно до 30 км от центра
export const FAR_TAKEOFF_M = 10_000

const NUMBERED_ID = /^t(\d+)$/i

// номер больше всех tN/TN среди id и имён, чтобы не было совпадений
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
      // высота рельефа из файла была для старой точки, на новом месте она неизвестна
      const { groundAltM, ...rest } = t
      void groundAltM
      return { ...rest, lat: p.lat, lon: p.lon }
    }),
  )
}

export function setFarmDefaults(farm: Farm, patch: Partial<FarmDefaults>): Farm {
  return { ...farm, defaults: { ...farm.defaults, ...patch } }
}

// расстояние от точки до центра импортируемой фермы; undefined, если точки нет
function distanceToImportM(p: GeoPoint | undefined, imp: Pick<FarmImport, 'turbines'>): number | undefined {
  if (!p || imp.turbines.length === 0) return undefined
  return haversineM(p, centroid(imp.turbines))
}

// undefined, если взлёт не задан
export function importTakeoffDistanceM(takeoff: GeoPoint | undefined, imp: Pick<FarmImport, 'turbines'>): number | undefined {
  return distanceToImportM(takeoff, imp)
}

// то же для точки прогноза; undefined, если прогноза нет
export function importWeatherDistanceM(weather: Pick<WeatherSnapshot, 'location'> | undefined, imp: Pick<FarmImport, 'turbines'>): number | undefined {
  return distanceToImportM(weather?.location, imp)
}

// прогноз дальше этого уже про чужую погоду; порог как на экране погоды
export function importDropsWeather(weather: Pick<WeatherSnapshot, 'location'> | undefined, imp: Pick<FarmImport, 'turbines'>): boolean {
  const distM = importWeatherDistanceM(weather, imp)
  return distM !== undefined && distM > FAR_FROM_FARM_M
}

// маршрут сбрасываем, взлёт по умолчанию в центр новой фермы. Далёкий прогноз сбрасываем
// вместе с выбранным по нему часом вылета, он был бы по погоде другого места
export function importPatch(m: Pick<Mission, 'farm' | 'takeoff' | 'weather'>, imp: FarmImport, opts: { moveTakeoff: boolean }): MissionPatch {
  const farm = farmFromImport(imp, m.farm)
  const takeoff = !m.takeoff || opts.moveTakeoff ? farm.center : m.takeoff
  const weatherReset = importDropsWeather(m.weather, imp) ? { weather: undefined, departureTime: undefined } : {}
  return { farm, route: undefined, takeoff, ...weatherReset }
}
