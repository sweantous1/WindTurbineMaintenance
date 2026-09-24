import i18next from 'i18next'
import { z } from 'zod'
import type { GeoPoint } from '@/domain/types'

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
export const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

export const MAX_FORECAST_HOURS = 168
// Без ответа за это время запрос считается зависшим, иначе экран погоды ждёт бесконечно
export const FETCH_TIMEOUT_MS = 20_000
const GEOCODE_COUNT = 10
const MAX_REASON_LENGTH = 300

const CURRENT_VARS = [
  'temperature_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'weather_code',
  'precipitation',
]

const HOURLY_VARS = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'wind_speed_10m',
  'wind_speed_80m',
  'wind_speed_120m',
  'wind_speed_180m',
  'wind_direction_10m',
  'wind_direction_80m',
  'wind_direction_120m',
  'wind_direction_180m',
  'wind_gusts_10m',
  'relative_humidity_2m',
  'pressure_msl',
  'cloud_cover',
  'visibility',
]

export type OpenMeteoErrorCode = 'badPoint' | 'network' | 'timeout' | 'http' | 'badJson' | 'badShape' | 'units'

type ErrorParams = Record<string, string | number>

// Сервис вызывают и вне React (тесты, фоновое обновление): пока i18next не поднят, в тексте остаётся ключ
function translate(key: string, params: ErrorParams): string {
  return i18next.isInitialized ? i18next.t(key, params) : key
}

// Без reason или без единицы в шаблоне остались бы пустые кавычки — для них отдельные тексты
function errorKey(code: OpenMeteoErrorCode, params: ErrorParams): string {
  if (code === 'http' && !params.reason) return 'wmo.errors.httpStatus'
  if (code === 'units' && !params.unit) return 'wmo.errors.unitsMissing'
  return `wmo.errors.${code}`
}

export class OpenMeteoError extends Error {
  readonly code: OpenMeteoErrorCode
  // Ключ и параметры перевода: UI может перевести сообщение заново после смены языка
  readonly i18nKey: string
  readonly params: ErrorParams

  constructor(code: OpenMeteoErrorCode, params: ErrorParams = {}, options?: ErrorOptions) {
    const i18nKey = errorKey(code, params)
    super(translate(i18nKey, params), options)
    this.name = 'OpenMeteoError'
    this.code = code
    this.i18nKey = i18nKey
    this.params = params
  }
}

export function clampForecastHours(hours: number): number {
  if (Number.isNaN(hours)) return 1
  return Math.min(MAX_FORECAST_HOURS, Math.max(1, Math.ceil(hours)))
}

// Сетка Open-Meteo — километры, пять знаков (~1 м) хватает с запасом и не тащат хвост 0.30000000000000004
const coord = (x: number) => String(Math.round(x * 1e5) / 1e5)

function assertPoint(p: GeoPoint): void {
  const ok = Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
  if (!ok) throw new OpenMeteoError('badPoint', { lat: p.lat, lon: p.lon })
}

export function buildForecastUrl(p: GeoPoint, hours: number): string {
  assertPoint(p)
  const params: [string, string][] = [
    ['latitude', coord(p.lat)],
    ['longitude', coord(p.lon)],
    ['current', CURRENT_VARS.join(',')],
    ['hourly', HOURLY_VARS.join(',')],
    // Без этого параметра ветер приходит в км/ч — на этом ошибся эталон Grant-temp
    ['wind_speed_unit', 'ms'],
    // Время часов — местное время фермы, в нём же выбирают час вылета
    ['timezone', 'auto'],
    ['forecast_hours', String(clampForecastHours(hours))],
  ]
  return `${OPEN_METEO_FORECAST_URL}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`
}

const apiErrorSchema = z.object({ error: z.literal(true), reason: z.string() })

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let res: Response
  let text: string
  try {
    res = await fetch(url, { signal: combined })
    text = await res.text()
  } catch (e) {
    // Отмену вызывающим пробрасываем как есть: это не ошибка, показывать её не нужно
    if (signal?.aborted) throw e
    if (timeout.aborted) throw new OpenMeteoError('timeout', { seconds: FETCH_TIMEOUT_MS / 1000 }, { cause: e })
    throw new OpenMeteoError('network', {}, { cause: e })
  }

  const body = parseJson(text)
  const apiError = apiErrorSchema.safeParse(body)
  if (res.status !== 200 || apiError.success) {
    const reason = apiError.success ? apiError.data.reason : res.statusText
    throw new OpenMeteoError('http', { status: res.status, reason: reason.slice(0, MAX_REASON_LENGTH) })
  }
  if (body === undefined) throw new OpenMeteoError('badJson')
  return body
}

export async function fetchForecastRaw(p: GeoPoint, hours: number, signal?: AbortSignal): Promise<unknown> {
  return fetchJson(buildForecastUrl(p, hours), signal)
}

export interface GeocodeResult {
  name: string
  lat: number
  lon: number
  country?: string
  admin1?: string
}

const geocodeSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().nullish(),
        admin1: z.string().nullish(),
      }),
    )
    .optional(),
})

export function zodIssuePath(error: z.ZodError): string {
  return error.issues[0]?.path.map(String).join('.') || '—'
}

export async function geocode(name: string, lang: 'ru' | 'en', signal?: AbortSignal): Promise<GeocodeResult[]> {
  const query = name.trim()
  // Open-Meteo ищет от двух символов, более короткий запрос всегда пуст
  if (query.length < 2) return []
  const url = `${OPEN_METEO_GEOCODING_URL}?name=${encodeURIComponent(query)}&count=${GEOCODE_COUNT}&language=${lang}&format=json`
  const parsed = geocodeSchema.safeParse(await fetchJson(url, signal))
  if (!parsed.success) throw new OpenMeteoError('badShape', { path: zodIssuePath(parsed.error) })
  return (parsed.data.results ?? []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    ...(r.country ? { country: r.country } : {}),
    ...(r.admin1 ? { admin1: r.admin1 } : {}),
  }))
}
