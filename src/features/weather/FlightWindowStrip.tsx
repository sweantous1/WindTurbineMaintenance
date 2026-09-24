import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { HourStatus } from '@/domain/flightCheck'
import { countByStatus, formatWindowRange, groupByDay, okWindows, STATUS_ORDER, statusLook, type WindowCell } from './flightWindow'
import { formatDay, formatDayTime, formatNumber } from './format'
import { formatReason, missingWindAltitudes } from './reasons'

interface FlightWindowStripProps {
  cells: WindowCell[]
  selectedTime?: string
  // Нет обработчика — только просмотр (облетанная миссия)
  onSelect?: (time: string) => void
  // Прошедшие часы видны, но выбрать их вылетом нельзя
  isPast?: (time: string) => boolean
}

const MAX_WINDOWS_SHOWN = 4

export default function FlightWindowStrip({ cells, selectedTime, onSelect, isPast }: FlightWindowStripProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const days = useMemo(() => groupByDay(cells), [cells])
  const counts = useMemo(() => countByStatus(cells), [cells])
  const windows = useMemo(() => okWindows(cells, { skip: (c) => isPast?.(c.time) ?? false }), [cells, isPast])

  const describe = (c: WindowCell) => {
    const parts = [`${formatDayTime(c.time, lang)} — ${t(statusLook(c.status).labelKey)}`]
    const reasons = c.assessment.reasons.map((r) => formatReason(r, t, lang))
    if (reasons.length > 0) parts.push(reasons.join('; '))
    if (c.status === 'insufficient') {
      const alts = missingWindAltitudes(c.assessment).map((a) => formatNumber(a, lang, 0))
      parts.push(t('flightForecast.missingWind', { alts: alts.join(', ') }))
    }
    return parts.join('\n')
  }

  if (cells.length === 0) return <p className="py-6 text-center text-sm text-gray-400">{t('common.noData')}</p>

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {days.map((d) => (
          <div key={d.day} className="flex items-center gap-2">
            <div className="w-20 shrink-0 text-xs font-medium text-gray-600">{formatDay(d.day + 'T00:00', lang)}</div>
            {/* Колонка = час суток: одинаковые часы разных дней стоят друг под другом */}
            <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-0.5">
              {d.cells.map((c) => {
                const look = statusLook(c.status)
                const selected = c.time === selectedTime
                const past = isPast?.(c.time) ?? false
                const selectable = onSelect !== undefined && !past
                return (
                  <button
                    key={c.time}
                    type="button"
                    style={{ gridColumnStart: c.hour + 1 }}
                    aria-pressed={selected}
                    aria-disabled={!selectable}
                    aria-label={describe(c)}
                    title={describe(c)}
                    onClick={selectable ? () => onSelect(c.time) : undefined}
                    className={`relative flex h-10 flex-col items-center justify-center rounded border text-center leading-none transition-colors focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${look.cell} ${
                      past ? 'opacity-40' : ''
                    } ${selectable ? 'cursor-pointer' : 'cursor-default'} ${
                      selected ? 'z-10 outline-2 outline-offset-1 outline-gray-900' : ''
                    }`}
                  >
                    <span aria-hidden="true" className="text-xs font-bold">
                      {look.icon}
                    </span>
                    <span aria-hidden="true" className="mt-0.5 text-[10px] tabular-nums">
                      {String(c.hour).padStart(2, '0')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <ul className="flex flex-wrap gap-2 text-xs">
        {STATUS_ORDER.map((s: HourStatus) => {
          const look = statusLook(s)
          return (
            <li key={s} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${look.chip}`}>
              <span aria-hidden="true" className="font-bold">
                {look.icon}
              </span>
              {t(look.labelKey)}
              <span className="tabular-nums opacity-80">{t('weatherScreen.window.hoursCount', { count: counts[s] })}</span>
            </li>
          )
        })}
      </ul>

      <div className="text-sm text-gray-700">
        {windows.length === 0 ? (
          <p>{t('weatherScreen.window.noWindows')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-medium">{t('weatherScreen.window.windows')}</span>
            {windows.slice(0, MAX_WINDOWS_SHOWN).map((w) => {
              const label = `${formatWindowRange(w, lang)} · ${t('weatherScreen.window.hoursCount', { count: w.hours })}`
              const cls = 'rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs text-green-900'
              // Клик по окну выбирает его первый час вылетом
              return onSelect ? (
                <button
                  key={w.start}
                  type="button"
                  title={t('weatherScreen.window.pickStart')}
                  onClick={() => onSelect(w.start)}
                  className={`${cls} hover:bg-green-100`}
                >
                  {label}
                </button>
              ) : (
                <span key={w.start} className={cls}>
                  {label}
                </span>
              )
            })}
            {windows.length > MAX_WINDOWS_SHOWN && (
              <span className="text-xs text-gray-500">
                {t('weatherScreen.window.more', { count: windows.length - MAX_WINDOWS_SHOWN })}
              </span>
            )}
          </div>
        )}
        {onSelect && <p className="mt-2 text-xs text-gray-500">{t('weatherScreen.window.clickHint')}</p>}
      </div>
    </div>
  )
}
