import type { Farm, GeoPoint, Mission, WeatherSnapshot } from '@/domain/types'
import { haversineM } from '@/lib/geo'
import { MAX_FORECAST_HOURS, type GeocodeResult } from '@/services/openMeteo'

export const DEFAULT_FORECAST_HOURS = 48
// дальше этого прогноз уже про другое место, предупреждаем
export const FAR_FROM_FARM_M = 30_000

export interface ForecastPoint extends GeoPoint {
  name?: string
  source: WeatherSnapshot['source']
}

// принимаем и запятую, и типографский минус при вставке из документов
export function parseDecimal(text: string): number | null {
  const s = text.trim().replace(/−/g, '-').replace(/\s+/g, '')
  if (s === '') return null
  if (s.includes('.') && s.includes(',')) return null
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export type CoordError = 'empty' | 'notNumber' | 'range'
export type ParseResult<E> = { ok: true; value: number } | { ok: false; error: E }

function parseCoord(text: string, limit: number): ParseResult<CoordError> {
  if (text.trim() === '') return { ok: false, error: 'empty' }
  const n = parseDecimal(text)
  if (n === null) return { ok: false, error: 'notNumber' }
  if (Math.abs(n) > limit) return { ok: false, error: 'range' }
  return { ok: true, value: n }
}

export const parseLatitude = (text: string) => parseCoord(text, 90)
export const parseLongitude = (text: string) => parseCoord(text, 180)

export type HoursError = 'empty' | 'notInteger' | 'range'

export function parseForecastHours(text: string): ParseResult<HoursError> {
  const s = text.trim()
  if (s === '') return { ok: false, error: 'empty' }
  if (!/^\d+$/.test(s)) return { ok: false, error: 'notInteger' }
  const n = Number(s)
  if (n < 1 || n > MAX_FORECAST_HOURS) return { ok: false, error: 'range' }
  return { ok: true, value: n }
}

export function farmPoint(farm: Farm): ForecastPoint {
  return { lat: farm.center.lat, lon: farm.center.lon, source: 'farm', ...(farm.name ? { name: farm.name } : {}) }
}

// центр фермы, иначе место прошлого прогноза, чтобы "Обновить" спрашивало то же
export function initialPoint(m: Pick<Mission, 'farm' | 'weather'>): ForecastPoint | null {
  if (m.farm) return farmPoint(m.farm)
  const w = m.weather
  if (w && w.source !== 'farm') {
    return { lat: w.location.lat, lon: w.location.lon, source: w.source, ...(w.location.name ? { name: w.location.name } : {}) }
  }
  return null
}

// "Каменск-Шахтинский, Ростовская область, Россия" без повторов (Москва и т.п.)
export function geocodeLabel(r: GeocodeResult): string {
  const parts: string[] = []
  for (const p of [r.name, r.admin1, r.country]) {
    if (p && !parts.includes(p)) parts.push(p)
  }
  return parts.join(', ')
}

export function distanceToFarmM(p: GeoPoint | null, farm: Farm | undefined): number | undefined {
  return p && farm ? haversineM(p, farm.center) : undefined
}

// до текущего центра фермы, а не distanceToFarmM из снимка: ферму могли переимпортировать
export function forecastDistanceM(m: Pick<Mission, 'farm' | 'weather'>): number | undefined {
  return m.weather ? distanceToFarmM(m.weather.location, m.farm) : undefined
}

export function isFarFromFarm(distanceM: number | undefined): distanceM is number {
  return distanceM !== undefined && distanceM > FAR_FROM_FARM_M
}

// тот же горизонт, что у сохранённого снимка, чтобы час вылета не выпал из нового прогноза
export function initialForecastHours(m: Pick<Mission, 'weather'>): number {
  const n = m.weather?.hourly.length ?? 0
  return n > 0 ? Math.min(n, MAX_FORECAST_HOURS) : DEFAULT_FORECAST_HOURS
}

// всегда с точкой, чтобы можно было вставить в карты
export function formatCoords(p: GeoPoint): string {
  return `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`
}
