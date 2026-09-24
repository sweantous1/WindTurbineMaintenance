import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { EffectiveLimits } from '@/domain/flightCheck'
import type { WeatherHour } from '@/domain/types'
import {
  axisTicks,
  buildWindChartData,
  chartTickTimes,
  hasTwoAltitudes,
  precipAxisMaxMm,
  windAxisMaxMs,
  type ChartAltitudes,
  type WindChartPoint,
} from './chartData'
import { formatClock, formatDayShort, formatDayTime, formatNumber, parseLocalTime } from './format'

// Первые три цвета категориальной палитры различимы при всех видах цветослепоты;
// порывы вдобавок пунктиром. Лимиты — «тревожный» красный, отличимый от серий
const COLORS = {
  transit: '#2a78d6',
  top: '#eb6834',
  gust: '#1baf7a',
  precip: '#4a3aa7',
  limit: '#d03b3b',
  grid: '#e5e7eb',
  axis: '#d1d5db',
  tick: '#6b7280',
  selected: '#111827',
}

const SYNC_ID = 'wtm-weather'
const Y_AXIS_WIDTH = 40
const MARGIN = { top: 8, right: 12, bottom: 0, left: 0 }

interface WindChartProps {
  hours: WeatherHour[]
  altitudes: ChartAltitudes
  limits: EffectiveLimits
  selectedTime?: string
}

export default function WindChart({ hours, altitudes, limits, selectedTime }: WindChartProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const points = useMemo(() => buildWindChartData(hours, altitudes), [hours, altitudes])
  const ticks = useMemo(() => chartTickTimes(points.map((p) => p.time)), [points])
  const twoAlts = hasTwoAltitudes(altitudes)
  const windMax = windAxisMaxMs(points, limits)
  const precipMax = precipAxisMaxMm(points, limits.maxPrecipMmH)
  const hasSelected = selectedTime !== undefined && points.some((p) => p.time === selectedTime)
  const anyExtrapolated = points.some((p) => p.extrapolated)

  const ms = t('weatherScreen.units.ms')
  const alt = (m: number) => formatNumber(m, lang, 0)
  const series = {
    transit: twoAlts
      ? t('weatherScreen.chart.windTransit', { alt: alt(altitudes.transitAltM) })
      : t('weatherScreen.chart.windAt', { alt: alt(altitudes.transitAltM) }),
    top: t('weatherScreen.chart.windTop', { alt: alt(altitudes.topAltM) }),
    gust: t('weatherScreen.chart.gust'),
  }

  // Полночь подписываем датой, остальные деления — временем
  const tickFormatter = (time: string) => (parseLocalTime(time)?.hour === 0 ? formatDayShort(time, lang) : formatClock(time))
  const xAxis = (
    <XAxis
      dataKey="time"
      ticks={ticks}
      interval={0}
      tickFormatter={tickFormatter}
      tick={{ fontSize: 11, fill: COLORS.tick }}
      stroke={COLORS.axis}
      tickLine={false}
    />
  )

  const tooltip = (props: TooltipContentProps) => (
    <ChartTooltip {...props} lang={lang} series={series} twoAlts={twoAlts} />
  )

  if (points.length === 0) return <p className="py-8 text-center text-sm text-gray-500">{t('common.noData')}</p>

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
        <LegendItem color={COLORS.transit} label={series.transit} />
        {twoAlts && <LegendItem color={COLORS.top} label={series.top} />}
        <LegendItem color={COLORS.gust} label={series.gust} dashed />
        <LegendItem color={COLORS.limit} label={t('weatherScreen.chart.windLimit', { value: formatNumber(limits.maxWindMs, lang, 1) })} />
        <LegendItem
          color={COLORS.limit}
          label={t('weatherScreen.chart.gustLimit', { value: formatNumber(limits.maxGustMs, lang, 1) })}
          dashed
        />
      </ul>

      <p className="text-xs font-medium text-gray-500">{t('weatherScreen.chart.windAxis')}</p>
      <div className="h-64" role="img" aria-label={t('weatherScreen.chart.windAria')}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} syncId={SYNC_ID} margin={MARGIN}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            {xAxis}
            <YAxis
              domain={[0, windMax]}
              ticks={axisTicks(windMax)}
              width={Y_AXIS_WIDTH}
              tick={{ fontSize: 11, fill: COLORS.tick }}
              tickFormatter={(v: number) => formatNumber(v, lang, 2)}
              stroke={COLORS.axis}
              tickLine={false}
            />
            <Tooltip content={tooltip} cursor={{ stroke: COLORS.tick, strokeWidth: 1 }} />
            <ReferenceLine y={limits.maxWindMs} stroke={COLORS.limit} strokeWidth={1.5} />
            <ReferenceLine y={limits.maxGustMs} stroke={COLORS.limit} strokeWidth={1.5} strokeDasharray="6 4" />
            {hasSelected && <ReferenceLine x={selectedTime} stroke={COLORS.selected} strokeWidth={1.5} strokeDasharray="3 3" />}
            <Line
              dataKey="windTransitMs"
              name={series.transit}
              stroke={COLORS.transit}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {twoAlts && (
              <Line
                dataKey="windTopMs"
                name={series.top}
                stroke={COLORS.top}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              dataKey="gustMs"
              name={series.gust}
              stroke={COLORS.gust}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs font-medium text-gray-500">
        {t('weatherScreen.chart.precipAxis')}
        <span className="ml-3 inline-flex items-center gap-1.5 font-normal text-gray-700">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS.precip }} />
          {t('weatherScreen.chart.precip')}
          <span className="ml-2 inline-block w-4 border-t-2" style={{ borderColor: COLORS.limit }} />
          {t('weatherScreen.chart.precipLimit', { value: formatNumber(limits.maxPrecipMmH, lang, 2) })}
        </span>
      </p>
      <div className="h-28" role="img" aria-label={t('weatherScreen.chart.precipAria')}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} syncId={SYNC_ID} margin={MARGIN} barCategoryGap={1}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            {xAxis}
            <YAxis
              domain={[0, precipMax]}
              ticks={axisTicks(precipMax, 3)}
              width={Y_AXIS_WIDTH}
              tick={{ fontSize: 11, fill: COLORS.tick }}
              tickFormatter={(v: number) => formatNumber(v, lang, 2)}
              stroke={COLORS.axis}
              tickLine={false}
            />
            {/* Подсказка общая с графиком ветра (syncId) и уже содержит осадки: вторая дублировала бы её */}
            <Tooltip content={() => null} cursor={{ fill: 'rgba(17, 24, 39, 0.06)' }} />
            <ReferenceLine y={limits.maxPrecipMmH} stroke={COLORS.limit} strokeWidth={1.5} />
            {hasSelected && <ReferenceLine x={selectedTime} stroke={COLORS.selected} strokeWidth={1.5} strokeDasharray="3 3" />}
            <Bar dataKey="precipMm" name={t('weatherScreen.chart.precip')} fill={COLORS.precip} radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-gray-500">
        {t('weatherScreen.chart.note', { ms })}
        {anyExtrapolated && ` ${t('weatherScreen.chart.extrapolatedNote')}`}
      </p>
    </div>
  )
}

function LegendItem({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <svg width="20" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="19" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '5 3' : undefined} strokeLinecap="round" />
      </svg>
      {label}
    </li>
  )
}

interface ChartTooltipExtra {
  lang: string
  series: { transit: string; top: string; gust: string }
  twoAlts: boolean
}

function ChartTooltip({ active, payload, lang, series, twoAlts }: TooltipContentProps & ChartTooltipExtra) {
  const { t } = useTranslation()
  const p = payload?.[0]?.payload as WindChartPoint | undefined
  if (!active || !p) return null
  const ms = t('weatherScreen.units.ms')
  const rows: { color: string; label: string; value: string; dashed?: boolean }[] = [
    { color: COLORS.transit, label: series.transit, value: `${formatNumber(p.windTransitMs, lang, 1)} ${ms}` },
    ...(twoAlts ? [{ color: COLORS.top, label: series.top, value: `${formatNumber(p.windTopMs, lang, 1)} ${ms}` }] : []),
    { color: COLORS.gust, label: series.gust, value: `${formatNumber(p.gustMs, lang, 1)} ${ms}`, dashed: true },
    { color: COLORS.precip, label: t('weatherScreen.chart.precip'), value: `${formatNumber(p.precipMm, lang, 2)} ${t('weatherScreen.units.mmH')}` },
  ]
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-gray-900">{formatDayTime(p.time, lang)}</p>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="pr-1.5 align-middle">
                <svg width="14" height="8" aria-hidden="true">
                  <line x1="1" y1="4" x2="13" y2="4" stroke={r.color} strokeWidth="2" strokeDasharray={r.dashed ? '4 2' : undefined} />
                </svg>
              </td>
              <td className="pr-3 text-gray-600">{r.label}</td>
              <td className="text-right font-medium tabular-nums text-gray-900">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.extrapolated && <p className="mt-1 text-gray-500">{t('weatherScreen.chart.extrapolatedShort')}</p>}
    </div>
  )
}
