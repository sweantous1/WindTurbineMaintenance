import { Fragment, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WIND_LEVELS_M, type WeatherHour, type WindLevel } from '@/domain/types'
import { wmoKey } from '@/lib/wmo'
import WindArrow from './WindArrow'
import { dayKey, formatClock, formatDay, formatNumber } from './format'

interface HourlyTableProps {
  hours: WeatherHour[]
  selectedTime?: string
}

const LEVELS = WIND_LEVELS_M.map((m) => String(m) as WindLevel)
const COLUMNS = 10 + LEVELS.length

export default function HourlyTable({ hours, selectedTime }: HourlyTableProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const [open, setOpen] = useState(false)
  const regionId = useId()
  const n = (v: number | null, digits = 1) => formatNumber(v, lang, digits)

  // Заголовки переносятся на две строки: иначе 14 колонок не помещаются в окно шириной 1024 px
  const thBase = 'px-1.5 py-2 align-bottom text-[11px] leading-tight font-medium text-gray-600'
  const th = `${thBase} text-right`
  const td = 'px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap'
  const header = (key: string) => (
    <th rowSpan={2} className={th}>
      {t(key)}
    </th>
  )

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? regionId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span>
          <span className="block text-base font-semibold text-gray-900">{t('weatherScreen.table.title')}</span>
          <span className="block text-sm text-gray-500">{t('weatherScreen.table.subtitle', { count: hours.length })}</span>
        </span>
        <svg
          className={`h-5 w-5 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div id={regionId} className="max-h-[520px] overflow-auto border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                <th rowSpan={2} className={`${thBase} pl-4 text-left`}>
                  {t('weatherScreen.table.time')}
                </th>
                <th rowSpan={2} className={`${thBase} text-left`}>
                  {t('weatherScreen.table.conditions')}
                </th>
                {header('weatherScreen.table.temp')}
                {header('weatherScreen.table.precip')}
                {header('weatherScreen.table.precipProb')}
                <th colSpan={LEVELS.length} className="border-b border-gray-200 px-1.5 pt-2 pb-1 text-center text-[11px] font-medium text-gray-600">
                  {t('weatherScreen.table.wind')}
                </th>
                {header('weatherScreen.table.gust10')}
                {header('weatherScreen.table.humidity')}
                {header('weatherScreen.table.pressure')}
                {header('weatherScreen.table.cloud')}
                <th rowSpan={2} className={`${th} pr-4`}>
                  {t('weatherScreen.table.visibility')}
                </th>
              </tr>
              <tr>
                {LEVELS.map((level) => (
                  <th key={level} className="px-1.5 pt-1 pb-2 text-right text-[11px] font-medium whitespace-nowrap text-gray-600">
                    {t('weatherScreen.table.windAt', { alt: level })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((h, i) => {
                const selected = h.time === selectedTime
                const newDay = i === 0 || dayKey(h.time) !== dayKey(hours[i - 1].time)
                return (
                  <Fragment key={h.time}>
                    {newDay && (
                      <tr className="bg-gray-50/60">
                        <th colSpan={COLUMNS} scope="rowgroup" className="px-4 pt-2.5 pb-1 text-left text-xs font-semibold text-gray-700">
                          {formatDay(h.time, lang)}
                        </th>
                      </tr>
                    )}
                    <tr
                      className={`border-t border-gray-100 ${selected ? 'bg-blue-50 font-medium' : ''}`}
                      aria-current={selected || undefined}
                    >
                      <td className="py-1.5 pr-1.5 pl-4 text-left tabular-nums whitespace-nowrap text-gray-900">
                        {formatClock(h.time)}
                      </td>
                      <td className="min-w-[10.5rem] px-1.5 py-1.5 text-left leading-tight text-gray-700">{t(wmoKey(h.weatherCode))}</td>
                      <td className={td}>{n(h.temperatureC)}</td>
                      <td className={td}>{n(h.precipitationMm, 2)}</td>
                      <td className={td}>{n(h.precipitationProbabilityPct, 0)}</td>
                      {LEVELS.map((level) => (
                        <td key={level} className={td}>
                          <span className="inline-flex items-center justify-end gap-1">
                            {n(h.windMs[level])}
                            {/* Направление — стрелкой; румб и градусы — в подсказке и для экранного диктора */}
                            <WindArrow deg={h.windDirDeg[level]} className="h-3.5 w-3.5 text-gray-500" />
                          </span>
                        </td>
                      ))}
                      <td className={td}>{n(h.gustMs10)}</td>
                      <td className={td}>{n(h.humidityPct, 0)}</td>
                      <td className={td}>{n(h.pressureHpa, 0)}</td>
                      <td className={td}>{n(h.cloudCoverPct, 0)}</td>
                      <td className={`${td} pr-4`}>{n(h.visibilityKm)}</td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
