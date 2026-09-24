import type { TFunction } from 'i18next'
import type { Mission, MissionLimits, MissionPatch, MissionStatus, MissionType, WeatherHour } from '@/domain/types'
import { FLIGHT_ALTITUDE_MAX_M, FLIGHT_ALTITUDE_MIN_M } from '@/domain/defaults'
import { canEdit, PRE_FLIGHT } from '@/domain/missionStatus'
import { findHour } from '@/domain/weather'
import { formatInputNumber } from '@/features/route/format'
import { lengthDrifted, planFor, routeContext } from '@/features/route/routeLogic'
import { wmoKey } from '@/lib/wmo'
import { escapeHtml, formatDate } from '@/utils'

// Общее для экранов миссии: проверка форм, форматирование, фильтр истории и отчёт.
// Без React, чтобы проверять тестами.

export const MISSION_TYPES: readonly MissionType[] = ['planned', 'emergency', 'post_storm']

// Границы высоты — общие с экраном маршрута (domain/defaults): здесь только реэкспорт,
// чтобы своё значение не разошлось с оптимизатором
export { FLIGHT_ALTITUDE_MAX_M, FLIGHT_ALTITUDE_MIN_M }

export type LimitKey = keyof MissionLimits

export const LIMIT_FIELDS: readonly LimitKey[] = [
  'maxWindMs',
  'maxGustMs',
  'maxPrecipMmH',
  'minVisibilityKm',
  'minTempC',
  'maxTempC',
  'maxAltitudeM',
]

export const LIMIT_RANGES: Readonly<Record<LimitKey, { min: number; max: number }>> = {
  maxWindMs: { min: 1, max: 40 },
  maxGustMs: { min: 1, max: 50 },
  maxPrecipMmH: { min: 0, max: 50 },
  minVisibilityKm: { min: 0, max: 50 },
  minTempC: { min: -60, max: 60 },
  maxTempC: { min: -60, max: 60 },
  maxAltitudeM: { min: FLIGHT_ALTITUDE_MIN_M, max: FLIGHT_ALTITUDE_MAX_M },
}

// Ключ перевода и параметры: текст собирается в компоненте, чтобы менялся вместе с языком
export interface FieldError {
  key: string
  params?: Record<string, string | number>
}

export type Parsed = { ok: true; value: number } | { ok: false; error: FieldError }

// На русской раскладке дробная часть набирается через запятую
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function parseInRange(raw: string, min: number, max: number): Parsed {
  if (raw.trim() === '') return { ok: false, error: { key: 'mission.errors.required' } }
  const n = parseDecimal(raw)
  if (n === null) return { ok: false, error: { key: 'mission.errors.notNumber' } }
  if (n < min || n > max) return { ok: false, error: { key: 'mission.errors.range', params: { min, max } } }
  return { ok: true, value: n }
}

export function validateName(raw: string): FieldError | null {
  return raw.trim() === '' ? { key: 'mission.errors.nameRequired' } : null
}

export type LimitsForm = Record<LimitKey, string>

// Дробь — с разделителем языка, как в полях экрана маршрута: «0,5», а не «0.5»
export function limitsToForm(limits: MissionLimits, lang: string): LimitsForm {
  const form = {} as LimitsForm
  for (const k of LIMIT_FIELDS) form[k] = formatInputNumber(limits[k], lang)
  return form
}

export function parseLimits(form: LimitsForm): { limits: MissionLimits | null; errors: Partial<Record<LimitKey, FieldError>> } {
  const errors: Partial<Record<LimitKey, FieldError>> = {}
  const values: Partial<MissionLimits> = {}
  for (const k of LIMIT_FIELDS) {
    const r = parseInRange(form[k], LIMIT_RANGES[k].min, LIMIT_RANGES[k].max)
    if (r.ok) values[k] = r.value
    else errors[k] = r.error
  }
  if (values.minTempC !== undefined && values.maxTempC !== undefined && values.minTempC >= values.maxTempC) {
    errors.maxTempC = { key: 'mission.errors.tempOrder' }
  }
  // Порыв не бывает слабее среднего ветра: такой лимит запрещал бы полёт раньше лимита ветра
  if (values.maxWindMs !== undefined && values.maxGustMs !== undefined && values.maxGustMs < values.maxWindMs) {
    errors.maxGustMs = { key: 'mission.errors.gustBelowWind' }
  }
  if (Object.keys(errors).length > 0) return { limits: null, errors }
  return { limits: values as MissionLimits, errors }
}

export interface SettingsValues {
  name: string
  type: MissionType
  droneProfileId: string
  flightAltitudeM: number
  limits: MissionLimits
}

// В патч попадают только изменённые поля, которые статус миссии разрешает править
export function buildSettingsPatch(mission: Mission, v: SettingsValues): MissionPatch {
  const patch: MissionPatch = {}
  const editable = (f: keyof MissionPatch) => canEdit(mission.status, f)
  const name = v.name.trim()
  if (editable('name') && name !== '' && name !== mission.name) patch.name = name
  if (editable('type') && v.type !== mission.type) patch.type = v.type
  if (editable('droneProfileId') && v.droneProfileId !== mission.droneProfileId) patch.droneProfileId = v.droneProfileId
  if (editable('flightAltitudeM') && v.flightAltitudeM !== mission.flightAltitudeM) patch.flightAltitudeM = v.flightAltitudeM
  if (editable('limits') && LIMIT_FIELDS.some((k) => v.limits[k] !== mission.limits[k])) patch.limits = { ...v.limits }
  return patch
}

// Длина маршрута зависит от высоты перелёта и потолка. Без пересчёта главная и история
// показывали бы старую длину, пока кто-нибудь не откроет экран маршрута
export function withRouteLength(m: Mission, patch: MissionPatch, ceilingM: number): MissionPatch {
  if (!m.route || m.route.order.length === 0 || !canEdit(m.status, 'route')) return patch
  const ctx = routeContext({ ...m, flightAltitudeM: patch.flightAltitudeM ?? m.flightAltitudeM }, ceilingM)
  if (!ctx) return patch
  const plan = planFor(ctx, m.route.order, m.route.returnToTakeoff)
  return lengthDrifted(m.route, plan) ? { ...patch, route: { ...m.route, lengthM: plan.lengthM } } : patch
}

export type CompletionGap = 'route' | 'weather' | 'departure'

// Чего не хватает для записи о полёте — по тем же правилам, что и шаги главной:
// пустой порядок облёта — не маршрут, прогноз без выбранного часа — не выбор погоды
export function completionGaps(m: Pick<Mission, 'route' | 'weather' | 'departureTime'>): CompletionGap[] {
  const gaps: CompletionGap[] = []
  if (!m.route || m.route.order.length === 0) gaps.push('route')
  if (!m.weather) gaps.push('weather')
  else if (!m.departureTime) gaps.push('departure')
  return gaps
}

// Ключ перевода предупреждения; погода и час вылета вместе не встречаются
export function completionGapsKey(gaps: readonly CompletionGap[]): string {
  const route = gaps.includes('route')
  if (gaps.includes('weather')) return route ? 'both' : 'weather'
  if (gaps.includes('departure')) return route ? 'routeDeparture' : 'departure'
  return 'route'
}

// ---------- Форматирование ----------

export function formatNumber(value: number, lang: string, digits: number): string {
  // -0 после округления показывался бы как «-0»
  const rounded = Number(value.toFixed(digits)) || 0
  return new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(rounded)
}

// Значения, которые вводит человек (высота, лимиты дрона): без лишних нулей, но с десятичным
// разделителем языка — «150,5 м», а не «150.5 м» в русском интерфейсе
export function formatValue(value: number, lang: string, maxDigits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(lang, { maximumFractionDigits: maxDigits, useGrouping: false }).format(value)
}

// Длина маршрута в км с одним знаком; null — маршрута нет
export function routeKm(m: Pick<Mission, 'route'>, lang: string): string | null {
  const route = m.route
  if (!route || route.order.length === 0 || !Number.isFinite(route.lengthM)) return null
  return formatNumber(route.lengthM / 1000, lang, 1)
}

export function turbineCount(m: Pick<Mission, 'farm'>): number | null {
  return m.farm ? m.farm.turbines.length : null
}

// Час Open-Meteo — местное время фермы без смещения. Показываем его как есть:
// перевод в пояс компьютера сдвинул бы час вылета, если ферма в другом поясе.
export function formatLocalHour(time: string, lang: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(time)
  if (!match) return time
  const [y, mo, d, h, mi] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi))
  return new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(date)
}

export function departureHour(m: Pick<Mission, 'weather' | 'departureTime'>): WeatherHour | undefined {
  return m.weather ? findHour(m.weather, m.departureTime) : undefined
}

// Температура и ветер на 10 м («15 °C · 4,2 м/с») отдельно от описания по коду WMO:
// в узкой колонке таблицы они идут разными строками
export function hourWeatherParts(h: WeatherHour, t: TFunction, lang: string): { measures: string; description: string } {
  const parts: string[] = []
  // Снимок из старой записи или импорта может не нести поля вовсе — это «нет данных», а не падение
  const temp = h.temperatureC
  if (temp != null && Number.isFinite(temp)) parts.push(t('mission.units.tempC', { value: formatNumber(temp, lang, 0) }))
  const wind = h.windMs?.['10']
  if (wind != null && Number.isFinite(wind)) parts.push(t('mission.units.windMs', { value: formatNumber(wind, lang, 1) }))
  return { measures: parts.join(' · '), description: t(wmoKey(h.weatherCode)) }
}

export function describeHourWeather(h: WeatherHour, t: TFunction, lang: string): string {
  const { measures, description } = hourWeatherParts(h, t, lang)
  return measures ? `${measures} · ${description}` : description
}

export interface MissionRow {
  name: string
  type: string
  status: string
  createdAt: string
  completedAt: string | null
  turbines: number | null
  routeKm: string | null
  departure: string | null
  weather: string | null
}

export function missionRow(m: Mission, t: TFunction, lang: string): MissionRow {
  const hour = departureHour(m)
  return {
    name: m.name,
    type: t(`mission.types.${m.type}`),
    status: t(`common.statuses.${m.status}`),
    createdAt: formatDate(m.createdAt, lang),
    completedAt: m.completedAt ? formatDate(m.completedAt, lang) : null,
    turbines: turbineCount(m),
    routeKm: routeKm(m, lang),
    departure: m.departureTime ? formatLocalHour(m.departureTime, lang) : null,
    weather: hour ? describeHourWeather(hour, t, lang) : null,
  }
}

// Цвет точки статуса в компактных списках, где плашка не помещается.
// «Час вылета выбран» — не зелёный: статус говорит только о данных, а можно ли лететь,
// решает вердикт прогноза на этот час
export const STATUS_DOT: Readonly<Record<MissionStatus, string>> = {
  draft: 'bg-gray-400',
  planned: 'bg-blue-500',
  ready: 'bg-sky-500',
  flown: 'bg-indigo-500',
  analyzed: 'bg-teal-500',
  archived: 'bg-slate-300',
}

// ---------- История ----------

export type HistoryFilter = 'all' | 'active' | 'flown' | 'archived'
export const HISTORY_FILTERS: readonly HistoryFilter[] = ['all', 'active', 'flown', 'archived']

export function parseHistoryFilter(value: string | null): HistoryFilter {
  return HISTORY_FILTERS.find((f) => f === value) ?? 'all'
}

export function matchesFilter(status: MissionStatus, filter: HistoryFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'active':
      return PRE_FLIGHT.includes(status)
    case 'flown':
      return status === 'flown' || status === 'analyzed'
    case 'archived':
      return status === 'archived'
  }
}

// «ё» и «е» в названиях пишут вперемешку — при поиске их не различаем
const normalizeSearch = (s: string) => s.toLocaleLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim()

export function filterMissions(list: readonly Mission[], filter: HistoryFilter, search: string): Mission[] {
  const q = normalizeSearch(search)
  return list.filter((m) => matchesFilter(m.status, filter) && (q === '' || normalizeSearch(m.name).includes(q)))
}

export function countByFilter(list: readonly Mission[]): Record<HistoryFilter, number> {
  const counts: Record<HistoryFilter, number> = { all: 0, active: 0, flown: 0, archived: 0 }
  for (const m of list) {
    for (const f of HISTORY_FILTERS) if (matchesFilter(m.status, f)) counts[f]++
  }
  return counts
}

// ---------- Файлы ----------

const FORBIDDEN_IN_FILE_NAME = '\\/:*?"<>|'

// Имя файла из названия миссии: без символов, запрещённых в Windows, и без управляющих
export function missionFileName(m: Pick<Mission, 'id' | 'name' | 'createdAt'>, ext: string): string {
  const cleaned = Array.from(m.name.normalize('NFKC'), (ch) =>
    ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || FORBIDDEN_IN_FILE_NAME.includes(ch) ? ' ' : ch,
  ).join('')
  const slug = cleaned.trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60).replace(/[.-]+$/, '')
  // Дата — по часам компьютера, как в истории: UTC-дата у миссии, созданной после полуночи, была бы вчерашней
  const created = /^\d{4}-\d{2}-\d{2}/.test(m.createdAt) ? new Date(m.createdAt) : null
  const date = created && !Number.isNaN(created.getTime()) ? `-${localDateStamp(created)}` : ''
  return `mission-${slug || m.id.slice(0, 8)}${date}.${ext}`
}

// Дата для имени файла — по часам компьютера: после полуночи UTC-дата была бы вчерашней
export function localDateStamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function downloadText(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Сразу после click() скачивание ещё не началось — освобождаем ссылку чуть позже
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- HTML-отчёт ----------

export interface ReportOptions {
  missions: readonly Mission[]
  t: TFunction
  lang: string
  filter: HistoryFilter
  search: string
  generatedAt?: Date
}

const REPORT_COLUMNS = ['name', 'type', 'status', 'created', 'completed', 'turbines', 'routeKm', 'departure', 'weather'] as const

// Все значения экранируются: название миссии вида <script> не должно стать разметкой отчёта
export function buildMissionsReportHtml({ missions: list, t, lang, filter, search, generatedAt = new Date() }: ReportOptions): string {
  const cell = (v: string | number | null) => `<td>${v === null ? '—' : escapeHtml(v)}</td>`
  const rows = list
    .map((m) => {
      const r = missionRow(m, t, lang)
      return `<tr>${[r.name, r.type, r.status, r.createdAt, r.completedAt, r.turbines, r.routeKm, r.departure, r.weather].map(cell).join('')}</tr>`
    })
    .join('\n')
  const head = REPORT_COLUMNS.map((c) => `<th>${escapeHtml(t(`missionHistory.columns.${c}`))}</th>`).join('')
  const title = escapeHtml(t('missionHistory.report.title'))
  const meta = [
    t('missionHistory.report.generated', { date: generatedAt.toLocaleString(lang) }),
    t('missionHistory.report.filter', { filter: t(`missionHistory.filters.${filter}`) }),
    search.trim() ? t('missionHistory.report.search', { query: search.trim() }) : null,
    t('missionHistory.report.count', { count: list.length }),
  ]
    .filter((s): s is string => s !== null)
    .map((s) => `<p class="meta">${escapeHtml(s)}</p>`)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;padding:24px;color:#111827}
h1{color:#1d4ed8;font-size:22px;margin:0 0 8px}
.meta{color:#4b5563;font-size:13px;margin:2px 0}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
th,td{padding:6px 8px;border:1px solid #d1d5db;text-align:left;vertical-align:top}
th{background:#f3f4f6}
footer{color:#9ca3af;font-size:12px;margin-top:20px}
</style></head>
<body>
<h1>${title}</h1>
${meta}
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
<footer>${escapeHtml(t('missionHistory.report.footer'))}</footer>
</body></html>`
}
