import type { WeatherSnapshot } from '@/domain/types'

// Время от Open-Meteo - местное время фермы без зоны ('2026-09-24T14:00').
// Форматируем в UTC, чтобы час не сдвигался на пояс компьютера

export const DASH = '—'

const numberFormats = new Map<string, Intl.NumberFormat>()

export function formatNumber(value: number | null | undefined, lang: string, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return DASH
  const key = `${lang}|${digits}`
  let f = numberFormats.get(key)
  if (!f) {
    // без -0 у значений, округлённых до нуля
    f = new Intl.NumberFormat(lang, { maximumFractionDigits: digits, signDisplay: 'negative' })
    numberFormats.set(key, f)
  }
  return f.format(value)
}

export interface LocalTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const LOCAL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

export function parseLocalTime(time: string): LocalTimeParts | null {
  const m = LOCAL_TIME_RE.exec(time)
  if (!m) return null
  const [year, month, day, hour, minute] = m.slice(1).map(Number)
  return { year, month, day, hour, minute }
}

const pad = (n: number) => String(n).padStart(2, '0')

// местное время как UTC-момент, для арифметики и Intl с timeZone 'UTC'
function asUtc(p: LocalTimeParts): Date {
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute))
}

function fromUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export function formatClock(time: string): string {
  const p = parseLocalTime(time)
  return p ? `${pad(p.hour)}:${pad(p.minute)}` : DASH
}

// Ключ суток: '2026-09-24'
export function dayKey(time: string): string {
  return time.slice(0, 10)
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()

function dateFormat(lang: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(opts)}`
  let f = dateFormats.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' })
    dateFormats.set(key, f)
  }
  return f
}

// "чт, 25 сент."
export function formatDay(time: string, lang: string): string {
  const p = parseLocalTime(time)
  return p ? dateFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(asUtc(p)) : DASH
}

// "25 сент." для подписей оси
export function formatDayShort(time: string, lang: string): string {
  const p = parseLocalTime(time)
  return p ? dateFormat(lang, { day: 'numeric', month: 'short' }).format(asUtc(p)) : DASH
}

// "чт, 25 сент., 14:00"
export function formatDayTime(time: string, lang: string): string {
  const p = parseLocalTime(time)
  return p ? `${formatDay(time, lang)}, ${formatClock(time)}` : DASH
}

export function addHours(time: string, hours: number): string {
  const p = parseLocalTime(time)
  if (!p) return time
  return fromUtc(new Date(asUtc(p).getTime() + hours * 3_600_000))
}

export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type CompassPoint = (typeof COMPASS_POINTS)[number]

// откуда дует, как в метеосводках
export function compassPoint(deg: number | null | undefined): CompassPoint | null {
  if (deg == null || !Number.isFinite(deg)) return null
  const normalized = ((deg % 360) + 360) % 360
  return COMPASS_POINTS[Math.round(normalized / 45) % 8]
}

export function formatUtcOffset(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds === 0) return 'UTC'
  const sign = seconds < 0 ? '-' : '+'
  const abs = Math.abs(Math.round(seconds / 60))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? `:${pad(m)}` : ''}`
}

const zoneNames = new Map<string, string>()

// Название пояса на языке интерфейса вместо Europe/Moscow, без летнего/зимнего (смещение из снимка).
// Если у Intl названия нет (Etc/GMT-3 и т.п.), остаётся IANA-идентификатор
export function formatTimeZone(timezone: string, lang: string): string {
  const key = `${lang}|${timezone}`
  const cached = zoneNames.get(key)
  if (cached !== undefined) return cached
  let name = timezone
  try {
    const part = new Intl.DateTimeFormat(lang, { timeZone: timezone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value
    if (part && !/^(GMT|UTC)([+-]|$)/.test(part)) name = part
  } catch {
    // неизвестный пояс, оставляем как есть
  }
  zoneNames.set(key, name)
  return name
}

// Текущее время фермы в шкале снимка: Open-Meteo даёт весь ряд с одним utc_offset_seconds
// без перехода на летнее время, поэтому и сейчас считаем по нему, а не по имени пояса
export function farmLocalNow(s: Pick<WeatherSnapshot, 'timezone' | 'utcOffsetSeconds'>, now: Date = new Date()): string {
  return fromUtc(new Date(now.getTime() + s.utcOffsetSeconds * 1000))
}

// смещение пояса на момент instant; null, если Intl пояс не знает
function zoneOffsetSeconds(timezone: string, instant: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant)
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
    return Math.round((local - Math.floor(instant.getTime() / 60_000) * 60_000) / 1000)
  } catch {
    return null
  }
}

// сдвиг в секундах, если в горизонте прогноза на ферме переводят часы, иначе null
export function offsetShiftInForecast(s: Pick<WeatherSnapshot, 'timezone' | 'utcOffsetSeconds' | 'hourly'>): number | null {
  for (const h of [s.hourly[0], s.hourly[s.hourly.length - 1]]) {
    const p = h && parseLocalTime(h.time)
    if (!p) continue
    const offset = zoneOffsetSeconds(s.timezone, new Date(asUtc(p).getTime() - s.utcOffsetSeconds * 1000))
    if (offset !== null && offset !== s.utcOffsetSeconds) return offset - s.utcOffsetSeconds
  }
  return null
}

// текущий час (14:00 при 14:35) прошедшим не считается
export function isPastHour(
  time: string,
  s: Pick<WeatherSnapshot, 'timezone' | 'utcOffsetSeconds'>,
  now: Date = new Date(),
): boolean {
  const current = farmLocalNow(s, now).slice(0, 13)
  return time.slice(0, 13) < current
}

export type AgeUnit = 'justNow' | 'minutes' | 'hours' | 'days'

// для подписи "обновлено 25 мин назад"; null, если дату не разобрать
export function snapshotAge(fetchedAt: string, now: Date = new Date()): { unit: AgeUnit; count: number } | null {
  const ms = Date.parse(fetchedAt)
  if (Number.isNaN(ms)) return null
  const minutes = Math.floor((now.getTime() - ms) / 60_000)
  if (minutes < 1) return { unit: 'justNow', count: 0 }
  if (minutes < 60) return { unit: 'minutes', count: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return { unit: 'hours', count: hours }
  return { unit: 'days', count: Math.floor(hours / 24) }
}

// минуты -> часы и минуты; null для бесконечных и отрицательных
export function splitMinutes(min: number): { h: number; m: number } | null {
  if (!Number.isFinite(min) || min < 0) return null
  const total = Math.round(min)
  return { h: Math.floor(total / 60), m: total % 60 }
}

export type ByteUnit = 'B' | 'KB' | 'MB' | 'GB'

export function formatBytes(bytes: number, lang: string): { value: string; unit: ByteUnit } {
  const units: ByteUnit[] = ['B', 'KB', 'MB', 'GB']
  let v = Math.max(0, bytes)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return { value: formatNumber(v, lang, i === 0 ? 0 : 1), unit: units[i] }
}
