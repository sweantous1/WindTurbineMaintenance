import { assessHour, type HourAssessment, type HourStatus } from '@/domain/flightCheck'
import type { WeatherHour } from '@/domain/types'
import { addHours, dayKey, formatClock, formatDay, parseLocalTime } from './format'

export type AssessContext = Parameters<typeof assessHour>[1]

export interface WindowCell {
  time: string
  // '2026-09-24'
  day: string
  hour: number
  status: HourStatus
  assessment: HourAssessment
}

export function assessHours(hours: WeatherHour[], ctx: AssessContext): WindowCell[] {
  return hours.map((h) => {
    const assessment = assessHour(h, ctx)
    return {
      time: h.time,
      day: dayKey(h.time),
      hour: parseLocalTime(h.time)?.hour ?? 0,
      status: assessment.status,
      assessment,
    }
  })
}

// Порядок в легенде: от «можно» к «нельзя», «нет данных» — отдельно в конце
export const STATUS_ORDER: readonly HourStatus[] = ['ok', 'marginal', 'no', 'insufficient']

export interface StatusLook {
  // Значок дублирует цвет: статус читается и без различения красного и зелёного
  icon: string
  // Клетка полосы окна вылета
  cell: string
  // Плашка вердикта и легенды
  chip: string
  labelKey: string
}

const LOOKS: Record<HourStatus, StatusLook> = {
  ok: {
    icon: '✓',
    cell: 'bg-green-600 text-white border-green-700 hover:bg-green-700',
    chip: 'bg-green-50 text-green-800 border-green-300',
    labelKey: 'flightForecast.status.ok',
  },
  marginal: {
    icon: '!',
    cell: 'bg-amber-300 text-amber-950 border-amber-500 hover:bg-amber-400',
    chip: 'bg-amber-50 text-amber-900 border-amber-300',
    labelKey: 'flightForecast.status.marginal',
  },
  no: {
    icon: '✕',
    cell: 'bg-red-600 text-white border-red-700 hover:bg-red-700',
    chip: 'bg-red-50 text-red-800 border-red-300',
    labelKey: 'flightForecast.status.no',
  },
  insufficient: {
    icon: '?',
    cell: 'bg-gray-100 text-gray-600 border-dashed border-gray-400 hover:bg-gray-200',
    chip: 'bg-gray-50 text-gray-700 border-dashed border-gray-400',
    labelKey: 'flightForecast.status.insufficient',
  },
}

export function statusLook(status: HourStatus): StatusLook {
  return LOOKS[status]
}

export function groupByDay(cells: WindowCell[]): { day: string; cells: WindowCell[] }[] {
  const groups: { day: string; cells: WindowCell[] }[] = []
  for (const cell of cells) {
    const last = groups[groups.length - 1]
    if (last && last.day === cell.day) last.cells.push(cell)
    else groups.push({ day: cell.day, cells: [cell] })
  }
  return groups
}

export function countByStatus(cells: WindowCell[]): Record<HourStatus, number> {
  const counts: Record<HourStatus, number> = { ok: 0, marginal: 0, no: 0, insufficient: 0 }
  for (const c of cells) counts[c.status]++
  return counts
}

export interface FlightWindow {
  start: string
  // Час, с которого лететь уже нельзя: окно 08:00–12:00 — это часы 08, 09, 10 и 11
  endExclusive: string
  hours: number
}

// Подряд идущие часы «можно». Ряды Open-Meteo идут без пропусков, но разрыв во времени
// (или переход на летнее время) всё равно рвёт окно: сплошным оно быть не обязано
export function okWindows(cells: WindowCell[], opts: { minHours?: number; skip?: (c: WindowCell) => boolean } = {}): FlightWindow[] {
  const minHours = opts.minHours ?? 1
  const result: FlightWindow[] = []
  let run: WindowCell[] = []
  const flush = () => {
    if (run.length >= minHours) {
      result.push({ start: run[0].time, endExclusive: addHours(run[run.length - 1].time, 1), hours: run.length })
    }
    run = []
  }
  for (const cell of cells) {
    const usable = cell.status === 'ok' && !opts.skip?.(cell)
    if (!usable) {
      flush()
      continue
    }
    const prev = run[run.length - 1]
    if (prev && addHours(prev.time, 1) !== cell.time) flush()
    run.push(cell)
  }
  flush()
  return result
}

// «пт, 25 сент. 08:00–13:00»; окно через полночь — с днём конца, иначе «22:00–16:00» читается
// как окно назад во времени. Конец ровно в полночь следующих суток — это ещё те же сутки
export function formatWindowRange(w: FlightWindow, lang: string): string {
  const start = `${formatDay(w.start, lang)} ${formatClock(w.start)}`
  const sameDay = dayKey(w.start) === dayKey(w.endExclusive)
  const endsAtMidnight = formatClock(w.endExclusive) === '00:00' && dayKey(addHours(w.endExclusive, -1)) === dayKey(w.start)
  if (sameDay || endsAtMidnight) return `${start}–${formatClock(w.endExclusive)}`
  return `${start} – ${formatDay(w.endExclusive, lang)} ${formatClock(w.endExclusive)}`
}
