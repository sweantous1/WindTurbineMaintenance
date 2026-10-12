import { z } from 'zod'
import { WIND_LEVELS_M } from './types'
import type { GeoPoint, WeatherCurrent, WeatherHour, WeatherSnapshot, WindLevel } from './types'
import { haversineM } from '@/lib/geo'
import { fetchForecastRaw, OpenMeteoError, zodIssuePath } from '@/services/openMeteo'

// Единицы в ответе не те, в которых сравниваются лимиты - прогноз не принимаем
export class WeatherUnitsError extends OpenMeteoError {
  readonly field: string
  // Пустая строка - сервер не указал единицу
  readonly unit: string

  constructor(field: string, unit: string, expected: string) {
    super('units', { field, unit, expected })
    this.name = 'WeatherUnitsError'
    this.field = field
    this.unit = unit
  }
}

// Всё, что сравнивается с лимитами, должно прийти в этих единицах
const EXPECTED_UNITS: Record<string, string> = {
  wind_speed_10m: 'm/s',
  wind_speed_80m: 'm/s',
  wind_speed_120m: 'm/s',
  wind_speed_180m: 'm/s',
  wind_gusts_10m: 'm/s',
  temperature_2m: '°C',
  precipitation: 'mm',
  visibility: 'm',
}

const value = z.number().nullable()
const series = z.array(value).optional()
const units = z.record(z.string(), z.string())

const hourlySchema = z
  .object({
    time: z.array(z.string()),
    temperature_2m: series,
    precipitation: series,
    precipitation_probability: series,
    weather_code: series,
    wind_speed_10m: series,
    wind_speed_80m: series,
    wind_speed_120m: series,
    wind_speed_180m: series,
    wind_direction_10m: series,
    wind_direction_80m: series,
    wind_direction_120m: series,
    wind_direction_180m: series,
    wind_gusts_10m: series,
    relative_humidity_2m: series,
    pressure_msl: series,
    cloud_cover: series,
    visibility: series,
  })
  .superRefine((h, ctx) => {
    // Ряд другой длины сдвинул бы значения на чужие часы
    for (const [key, arr] of Object.entries(h)) {
      if (key !== 'time' && Array.isArray(arr) && arr.length !== h.time.length) {
        ctx.addIssue({ code: 'custom', message: 'length mismatch', path: [key] })
      }
    }
  })

const forecastSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  utc_offset_seconds: z.number(),
  current_units: units.optional(),
  current: z.object({
    time: z.string(),
    temperature_2m: value.optional(),
    wind_speed_10m: value.optional(),
    wind_direction_10m: value.optional(),
    wind_gusts_10m: value.optional(),
    weather_code: value.optional(),
    precipitation: value.optional(),
  }),
  hourly_units: units.optional(),
  hourly: hourlySchema,
})

// Единица обязательна у каждого ряда, иначе км/ч не отличить от м/с.
// Ветер у земли проверяем всегда: по нему видно, учёл ли сервер wind_speed_unit=ms
function checkUnits(given: Record<string, string> | undefined, data: object, always: readonly string[] = []): void {
  for (const [field, expected] of Object.entries(EXPECTED_UNITS)) {
    const present = always.includes(field) || (data as Record<string, unknown>)[field] !== undefined
    if (!present) continue
    const unit = given?.[field]
    if (unit !== expected) throw new WeatherUnitsError(field, unit ?? '', expected)
  }
}

export function normalizeForecast(
  raw: unknown,
  meta: { source: WeatherSnapshot['source']; name?: string; farmCenter?: GeoPoint; fetchedAt?: string },
): WeatherSnapshot {
  const parsed = forecastSchema.safeParse(raw)
  if (!parsed.success) throw new OpenMeteoError('badShape', { path: zodIssuePath(parsed.error) })
  const d = parsed.data
  checkUnits(d.hourly_units, d.hourly, ['wind_speed_10m'])
  checkUnits(d.current_units, d.current)

  const h = d.hourly
  const at = (arr: (number | null)[] | undefined, i: number) => arr?.[i] ?? null
  const hourly: WeatherHour[] = h.time.map((time, i) => {
    const visibilityM = at(h.visibility, i)
    return {
      time,
      temperatureC: at(h.temperature_2m, i),
      precipitationMm: at(h.precipitation, i),
      precipitationProbabilityPct: at(h.precipitation_probability, i),
      weatherCode: at(h.weather_code, i),
      windMs: {
        '10': at(h.wind_speed_10m, i),
        '80': at(h.wind_speed_80m, i),
        '120': at(h.wind_speed_120m, i),
        '180': at(h.wind_speed_180m, i),
      },
      windDirDeg: {
        '10': at(h.wind_direction_10m, i),
        '80': at(h.wind_direction_80m, i),
        '120': at(h.wind_direction_120m, i),
        '180': at(h.wind_direction_180m, i),
      },
      gustMs10: at(h.wind_gusts_10m, i),
      humidityPct: at(h.relative_humidity_2m, i),
      pressureHpa: at(h.pressure_msl, i),
      cloudCoverPct: at(h.cloud_cover, i),
      // Open-Meteo отдаёт видимость в метрах, лимит задан в километрах
      visibilityKm: visibilityM == null ? null : visibilityM / 1000,
    }
  })

  const c = d.current
  const current: WeatherCurrent = {
    time: c.time,
    temperatureC: c.temperature_2m ?? null,
    windMs10: c.wind_speed_10m ?? null,
    windDirDeg10: c.wind_direction_10m ?? null,
    gustMs10: c.wind_gusts_10m ?? null,
    weatherCode: c.weather_code ?? null,
    precipitationMm: c.precipitation ?? null,
  }

  // Точка прогноза - узел сетки модели из ответа, а не запрошенная точка
  const location: WeatherSnapshot['location'] = {
    lat: d.latitude,
    lon: d.longitude,
    ...(meta.name ? { name: meta.name } : {}),
  }

  return {
    fetchedAt: meta.fetchedAt ?? new Date().toISOString(),
    source: meta.source,
    location,
    ...(meta.farmCenter ? { distanceToFarmM: haversineM(location, meta.farmCenter) } : {}),
    timezone: d.timezone,
    utcOffsetSeconds: d.utc_offset_seconds,
    current,
    hourly,
  }
}

export async function fetchWeatherSnapshot(
  p: GeoPoint,
  hours: number,
  meta: { source: WeatherSnapshot['source']; name?: string; farmCenter?: GeoPoint },
  signal?: AbortSignal,
): Promise<WeatherSnapshot> {
  const raw = await fetchForecastRaw(p, hours, signal)
  return normalizeForecast(raw, meta)
}

// Показатель степенного профиля ветра для открытой местности (правило 1/7)
const POWER_LAW_ALPHA = 0.14

const levelKey = (level: number) => String(level) as WindLevel

// Нет данных - null, а не догадка: заниженный ветер на высоте опаснее, чем "нет данных"
export function windAtAltitude(h: WeatherHour, altM: number): { ms: number | null; extrapolated: boolean } {
  const none = { ms: null, extrapolated: false }
  if (!Number.isFinite(altM)) return none
  const bottom = WIND_LEVELS_M[0]
  const top = WIND_LEVELS_M[WIND_LEVELS_M.length - 1]
  const at = (level: number) => {
    const v = h.windMs[levelKey(level)]
    return v != null && Number.isFinite(v) ? v : null
  }

  if (altM >= top) {
    // Выше верхнего уровня данных нет, берём его значение с пометкой
    const v = at(top)
    return v == null ? none : { ms: v, extrapolated: altM > top }
  }
  if (altM <= bottom) {
    const v = at(bottom)
    return v == null ? none : { ms: v * (Math.max(altM, 0) / bottom) ** POWER_LAW_ALPHA, extrapolated: false }
  }

  // Ближайшие уровни с данными: при пропуске 80 м интерполируем между 10 и 120
  const known = WIND_LEVELS_M.filter((level) => at(level) != null)
  const lower = known.findLast((level) => level <= altM)
  const upper = known.find((level) => level >= altM)
  if (lower === undefined || upper === undefined) return none
  const vLow = at(lower) ?? 0
  const vUp = at(upper) ?? 0
  if (lower === upper) return { ms: vLow, extrapolated: false }
  const f = (Math.log(altM) - Math.log(lower)) / (Math.log(upper) - Math.log(lower))
  return { ms: vLow + (vUp - vLow) * f, extrapolated: false }
}

export function gustAtAltitude(h: WeatherHour, altM: number): number | null {
  const gust10 = h.gustMs10
  const wind = windAtAltitude(h, altM).ms
  if (gust10 == null || wind == null) return null
  const wind10 = h.windMs['10']
  // Прибавку порыва у земли переносим на высоту как есть: отношение порыв/ветер
  // при штиле у земли раздуло бы порывы наверху в разы
  const excess = wind10 == null ? gust10 - wind : Math.max(0, gust10 - wind10)
  // Порыв не бывает слабее среднего ветра на той же высоте (штиль у земли при ветре на 120 м)
  return Math.max(wind + excess, wind)
}

export function findHour(s: WeatherSnapshot, time: string | undefined): WeatherHour | undefined {
  if (!time) return undefined
  return s.hourly.find((h) => h.time === time)
}

export function isStale(s: WeatherSnapshot, now: Date = new Date(), maxAgeH = 3): boolean {
  const fetchedMs = Date.parse(s.fetchedAt)
  if (Number.isNaN(fetchedMs)) return true
  return now.getTime() - fetchedMs > maxAgeH * 3_600_000
}
