import { memo, useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import Card from '@/components/common/Card'
import { batteryUsedPct, sampleAt, type TurbineVisit } from '@/domain/flightPath'
import { isPreFlight } from '@/domain/missionStatus'
import type { DroneProfile, Mission } from '@/domain/types'
import { formatLocalHour, formatNumber } from '@/features/mission/missionView'
import WindArrow from '@/features/weather/WindArrow'
import { statusLook } from '@/features/weather/flightWindow'
import { missionForecast } from '@/features/weather/forecast'
import { wmoKey } from '@/lib/wmo'
import type { SimClock } from './simClock'
import type { SimReady } from './simData'
import { batteryLevel, currentVisitIndex, DRONE_VISUAL_SPAN_M, formatClock, PATH_COLORS, PATH_KINDS, phaseText, RING_COLORS } from './simView'
import { useSimSnapshot } from './useSimClock'

interface SimPanelProps {
  data: SimReady
  mission: Mission
  drone: DroneProfile
  clock: SimClock
}

const MODEL_URL = 'https://sketchfab.com/3d-models/drone-19d310dec81c446fba1a797903e083eb'
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'

const BATTERY_BAR: Record<ReturnType<typeof batteryLevel>, string> = {
  ok: 'bg-green-600',
  reserve: 'bg-amber-500',
  empty: 'bg-red-600',
}

export default function SimPanel({ data, mission, drone, clock }: SimPanelProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const snap = useSimSnapshot(clock)
  const { trajectory } = data
  const sample = sampleAt(trajectory, snap.timeS)
  const names = useMemo(() => new Map(data.turbines.map((tb) => [tb.id, tb.name])), [data.turbines])
  const nameOf = (id: string) => names.get(id) ?? id
  const total = trajectory.visits.length
  const phase = phaseText(sample, total, nameOf)

  const remainingPct = 100 - batteryUsedPct(sample.timeS, drone.enduranceMin)
  const level = batteryLevel(remainingPct, drone.reservePct)
  const km = (m: number) => formatNumber(m / 1000, lang, 1)
  const seekTo = useCallback((v: TurbineVisit) => clock.seek(v.transitStartS), [clock])
  // После полёта маршрут и погода только для чтения: ссылок «поправить» не показываем
  const editable = isPreFlight(mission.status)

  return (
    <div className="space-y-6">
      <Card title={t('sim.now.title')}>
        <div className="space-y-4">
          <p className="font-medium text-gray-900">{t(phase.key, phase.params)}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-gray-600">{t('sim.now.altitude')}</dt>
            <dd className="text-right tabular-nums text-gray-900">{t('sim.now.meters', { value: formatNumber(sample.position.z, lang, 0) })}</dd>
            <dt className="text-gray-600">{t('sim.now.distance')}</dt>
            <dd className="text-right tabular-nums text-gray-900">
              {t('sim.now.ofKm', { done: km(sample.distanceM), total: km(trajectory.lengthM) })}
            </dd>
            <dt className="text-gray-600">{t('sim.now.time')}</dt>
            <dd className="text-right tabular-nums text-gray-900">
              {t('sim.now.ofTime', { elapsed: formatClock(sample.timeS), total: formatClock(trajectory.durationS) })}
            </dd>
            <dt className="text-gray-600">{t('sim.now.inspected')}</dt>
            <dd className="text-right tabular-nums text-gray-900">{t('sim.now.ofCount', { done: sample.inspectedCount, total })}</dd>
          </dl>

          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-gray-600">{t('sim.now.battery')}</span>
              <span className={`tabular-nums font-medium ${level === 'ok' ? 'text-gray-900' : level === 'reserve' ? 'text-amber-800' : 'text-red-700'}`}>
                {t('sim.now.percent', { value: formatNumber(Math.max(0, remainingPct), lang, 0) })}
              </span>
            </div>
            <div
              role="meter"
              aria-label={t('sim.now.battery')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.max(0, Math.min(100, remainingPct)))}
              className="relative h-2.5 rounded-full bg-gray-200"
            >
              <div className={`h-full rounded-full ${BATTERY_BAR[level]}`} style={{ width: `${Math.max(0, Math.min(100, remainingPct))}%` }} />
              <div
                className="absolute -top-1 h-[1.125rem] w-0.5 bg-gray-700"
                style={{ left: `${Math.max(0, Math.min(100, drone.reservePct))}%` }}
                aria-hidden="true"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">{t('sim.now.reserve', { value: formatNumber(drone.reservePct, lang, 0) })}</p>
            {level === 'reserve' && <p className="mt-1 text-sm text-amber-800">{t('sim.now.belowReserve')}</p>}
            {level === 'empty' && <p className="mt-1 text-sm font-medium text-red-700">{t('sim.now.empty')}</p>}
          </div>

          {data.estimate.sorties > 1 && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {Number.isFinite(data.estimate.sorties)
                ? t('sim.now.sorties', { count: data.estimate.sorties })
                : t('sim.now.sortiesImpossible')}
            </p>
          )}
        </div>
      </Card>

      <WeatherCard data={data} mission={mission} drone={drone} editable={editable} />

      {data.plan.conflicts.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {t('sim.conflicts.text', { count: data.conflictSegments.size })}
          {editable && (
            <>
              {' '}
              <ScreenLink to="/router">{t('sim.conflicts.link')}</ScreenLink>
            </>
          )}
        </div>
      )}

      <Card title={t('sim.order.title')}>
        <VisitList
          visits={trajectory.visits}
          names={names}
          current={currentVisitIndex(sample)}
          inspected={sample.inspectedCount}
          onSelect={seekTo}
        />
      </Card>

      <Card title={t('sim.legend.title')}>
        <ul className="space-y-1.5 text-sm text-gray-700">
          {PATH_KINDS.map((kind) => (
            <li key={kind} className="flex items-center gap-2">
              <span className="flex w-8 shrink-0 flex-col gap-0.5" aria-hidden="true">
                <span className="h-0.5 rounded" style={{ backgroundColor: PATH_COLORS[kind].plan }} />
                <span className="h-1 rounded" style={{ backgroundColor: PATH_COLORS[kind].passed }} />
              </span>
              {t(`sim.legend.${kind}`)}
            </li>
          ))}
          <li className="text-xs text-gray-500">{t('sim.legend.passed')}</li>
          <li className="flex items-center gap-2">
            <Ring color={RING_COLORS.conflict} />
            {t('sim.legend.conflictRing')}
          </li>
          <li className="flex items-center gap-2">
            <Ring color={RING_COLORS.current} />
            {t('sim.legend.currentRing')}
          </li>
        </ul>
        <p className="mt-3 text-xs text-gray-600">{t('sim.legend.droneScale', { span: DRONE_VISUAL_SPAN_M })}</p>
        <p className="mt-1 text-xs text-gray-500">
          {t('sim.legend.model')}{' '}
          <a href={MODEL_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
            “Drone”
          </a>{' '}
          — liz3d,{' '}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
            CC BY 4.0
          </a>
        </p>
      </Card>
    </div>
  )
}

function WeatherCard({ data, mission, drone, editable }: { data: SimReady; mission: Mission; drone: DroneProfile; editable: boolean }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const forecast = useMemo(() => missionForecast(mission, drone), [mission, drone])
  const { wind } = data

  if (!wind) {
    return (
      <Card title={t('sim.weather.title')}>
        <div className="space-y-2 text-sm">
          <p className="text-gray-700">{t(editable ? 'sim.weather.none' : 'sim.weather.noneFlown')}</p>
          {editable && <ScreenLink to="/weather">{t('sim.weather.noneLink')}</ScreenLink>}
        </div>
      </Card>
    )
  }

  const ms = (v: number | null) => (v == null ? '—' : t('sim.weather.ms', { value: formatNumber(v, lang, 1) }))
  const alt = formatNumber(data.plan.transitAltM, lang, 0)
  const temp = wind.hour.temperatureC
  const verdict = forecast.gap === null ? forecast.assessment.status : null
  const look = verdict ? statusLook(verdict) : null

  return (
    <Card title={t('sim.weather.title')} subtitle={formatLocalHour(wind.hour.time, lang)}>
      <div className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-gray-600">{t('sim.weather.temperature')}</dt>
          <dd className="text-right tabular-nums text-gray-900">
            {temp != null && Number.isFinite(temp) ? t('sim.weather.tempC', { value: formatNumber(temp, lang, 0) }) : '—'}
          </dd>
          <dt className="text-gray-600">{t('sim.weather.wind', { alt })}</dt>
          <dd className="flex items-center justify-end gap-1.5 tabular-nums text-gray-900">
            <WindArrow deg={wind.fromDeg} />
            {ms(wind.transitMs)}
          </dd>
          <dt className="text-gray-600">{t('sim.weather.gust', { alt })}</dt>
          <dd className="text-right tabular-nums text-gray-900">{ms(wind.gustMs)}</dd>
          <dt className="text-gray-600">{t('sim.weather.conditions')}</dt>
          <dd className="text-right text-gray-900">{t(wmoKey(wind.hour.weatherCode))}</dd>
        </dl>
        {look && verdict && (
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${look.chip}`} role="status">
            <span aria-hidden="true">{look.icon}</span>
            <span>{t(`flightForecast.verdict.${verdict}`)}</span>
          </div>
        )}
        <ScreenLink to="/weather">{t('sim.weather.more')}</ScreenLink>
      </div>
    </Card>
  )
}

interface VisitListProps {
  visits: readonly TurbineVisit[]
  names: ReadonlyMap<string, string>
  current: number | null
  inspected: number
  onSelect: (visit: TurbineVisit) => void
}

// Отдельно и под memo: при сотне турбин список не перерисовывается на каждом уведомлении часов
const VisitList = memo(function VisitList({ visits, names, current, inspected, onSelect }: VisitListProps) {
  const { t } = useTranslation()
  return (
    <ol className="-mx-2 max-h-80 space-y-0.5 overflow-y-auto px-2">
      {visits.map((v) => {
        const name = names.get(v.turbineId) ?? v.turbineId
        const isCurrent = v.visitIndex === current
        const done = v.visitIndex < inspected
        const goTo = t('sim.order.goTo', { n: v.visitIndex + 1, name })
        return (
          <li key={v.turbineId}>
            <button
              type="button"
              onClick={() => onSelect(v)}
              aria-current={isCurrent ? 'step' : undefined}
              // Содержимое кнопки в её имя не попадает, поэтому отметка «осмотрена» — в самом aria-label
              aria-label={done ? `${goTo}, ${t('sim.order.inspected')}` : goTo}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isCurrent ? 'bg-cyan-50 text-gray-900 ring-1 ring-cyan-400' : 'text-gray-800 hover:bg-gray-50'
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isCurrent ? 'bg-cyan-600 text-white' : 'bg-blue-600 text-white'
                }`}
                aria-hidden="true"
              >
                {v.visitIndex + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {done && (
                <svg className="h-4 w-4 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
})

function Ring({ color }: { color: string }) {
  return <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-[3px]" style={{ borderColor: color }} aria-hidden="true" />
}

function ScreenLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-medium text-blue-600 hover:text-blue-700">
      {children} →
    </Link>
  )
}
