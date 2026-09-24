import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import Card from '@/components/common/Card'
import type { MissionEstimate } from '@/domain/flightCheck'
import { isPreFlight } from '@/domain/missionStatus'
import type { Mission } from '@/domain/types'
import { isStale } from '@/domain/weather'
import { useMissionDrone } from '@/hooks/useMissions'
import { statusLook } from '@/features/weather/flightWindow'
import { gapScreen, missionForecast, type ForecastGap, type PlanIssue } from '@/features/weather/forecast'
import { formatDayTime, formatNumber, isPastHour, splitMinutes } from '@/features/weather/format'
import { formatReason, missingWindAltitudes } from '@/features/weather/reasons'
import { useNow } from '@/features/weather/useNow'
import { droneDisplayName } from '@/features/settings/droneName'

// Вердикт на выбранный час вылета: та же проверка, что и в полосе окна вылета, но с причинами
// и оценкой длины, времени и заряда по плану полёта
export default function FlightForecastCard({ mission, now: screenNow }: { mission: Mission; now?: Date }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const drone = useMissionDrone(mission)
  // Главная перерисовывается только при смене данных: без таймера «прогноз устарел»
  // и «час вылета прошёл» так и не появились бы у открытого экрана
  const ownNow = useNow(60_000)
  // На «Погоде» — часы экрана: «час прошёл» и «прогноз устарел» меняются одновременно
  // с полосой окна вылета и баннером, а не со сдвигом до минуты
  const now = screenNow ?? ownNow
  const forecast = useMemo(() => (drone ? missionForecast(mission, drone) : undefined), [mission, drone])

  if (!drone || !forecast) {
    return (
      <Card title={t('flightForecast.title')}>
        <p className="py-4 text-center text-sm text-gray-500">{t('common.loading')}</p>
      </Card>
    )
  }

  const preFlight = isPreFlight(mission.status)

  if (forecast.gap !== null) {
    return (
      <Card title={t('flightForecast.title')}>
        {/* Облетанную миссию уже не дополнить: ссылка «получите прогноз» только запутает */}
        {preFlight ? (
          <GapHint gap={forecast.gap} />
        ) : (
          <p className="py-2 text-sm text-gray-600">{t('flightForecast.readOnlyGap')}</p>
        )}
      </Card>
    )
  }

  const { assessment, hour, plan, planIssue, farFromFarmM } = forecast
  const look = statusLook(assessment.status)
  const missing = missingWindAltitudes(assessment)
  const staleWeather = preFlight && mission.weather !== undefined && isStale(mission.weather, now)
  // Час вылета, выбранный вчера, сегодня уже в прошлом: вердикт на него ничего не решает
  const departurePast = preFlight && mission.weather !== undefined && isPastHour(hour.time, mission.weather, now)
  const ms = t('weatherScreen.units.ms')

  return (
    <Card
      title={t('flightForecast.title')}
      subtitle={t('flightForecast.departure', { time: formatDayTime(hour.time, lang) })}
    >
      <div className="space-y-4">
        <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${look.chip}`} role="status">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/70 text-base font-bold">
            {look.icon}
          </span>
          <span className="text-base font-semibold">{t(`flightForecast.verdict.${assessment.status}`)}</span>
        </div>
        {farFromFarmM !== undefined && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t('flightForecast.farFromFarm', { km: formatNumber(farFromFarmM / 1000, lang, 0) })}{' '}
            {preFlight && <ScreenLink to="/weather">{t('flightForecast.links.weather')}</ScreenLink>}
          </p>
        )}

        {assessment.reasons.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {assessment.reasons.map((r, i) => {
              const rl = statusLook(r.severity)
              return (
                <li key={`${r.code}-${i}`} className="flex gap-2">
                  <span
                    role="img"
                    aria-label={t(rl.labelKey)}
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${rl.chip}`}
                  >
                    {rl.icon}
                  </span>
                  <span className="text-gray-800 first-letter:uppercase">
                    {formatReason(r, t, lang)}
                    {r.code === 'conflict' && preFlight && (
                      <>
                        {' '}
                        <ScreenLink to="/router">{t('flightForecast.links.route')}</ScreenLink>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {missing.length > 0 && (
          <p className="text-sm text-gray-700">{t('flightForecast.missingWind', { alts: missing.map((a) => formatNumber(a, lang, 0)).join(', ') })}</p>
        )}
        {assessment.status === 'ok' && <p className="text-sm text-gray-700">{t('flightForecast.allWithinLimits')}</p>}

        {assessment.windByAlt.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">{t('flightForecast.windByAlt')}</p>
            <ul className="space-y-0.5 text-sm text-gray-700">
              {assessment.windByAlt.map((w) => (
                <li key={w.altM} className="flex justify-between gap-2">
                  <span>{t('flightForecast.altitude', { alt: formatNumber(w.altM, lang, 0) })}</span>
                  <span className="tabular-nums">
                    {formatNumber(w.ms, lang, 1)} {ms}
                    <span className="text-gray-500">
                      {' · '}
                      {t('flightForecast.gustShort', { value: formatNumber(w.gustMs, lang, 1) })}
                    </span>
                    {w.extrapolated && <span title={t('weatherScreen.chart.extrapolatedShort')}> *</span>}
                  </span>
                </li>
              ))}
            </ul>
            {assessment.windByAlt.some((w) => w.extrapolated) && (
              <p className="mt-1 text-xs text-gray-500">* {t('weatherScreen.chart.extrapolatedShort')}</p>
            )}
          </div>
        )}

        {assessment.estimate && plan && <EstimateBlock estimate={assessment.estimate} lang={lang} />}
        {planIssue && preFlight && <PlanIssueNote issue={planIssue} />}

        {departurePast && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t('flightForecast.departurePast')} <ScreenLink to="/weather">{t('flightForecast.links.changeHour')}</ScreenLink>
          </p>
        )}
        {staleWeather && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t('flightForecast.staleWeather')} <ScreenLink to="/weather">{t('flightForecast.links.weather')}</ScreenLink>
          </p>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-gray-500">
          <span>{t('flightForecast.droneProfile', { name: droneDisplayName(drone, t) })}</span>
          {preFlight && <ScreenLink to="/weather">{t('flightForecast.links.changeHour')}</ScreenLink>}
        </div>
      </div>
    </Card>
  )
}

function EstimateBlock({ estimate: e, lang }: { estimate: MissionEstimate; lang: string }) {
  const { t } = useTranslation()
  const pct = (v: number) => (Number.isFinite(v) ? `${formatNumber(v, lang, 0)}%` : t('flightForecast.estimate.impossible'))
  const duration = (min: number) => {
    const d = splitMinutes(min)
    if (!d) return t('flightForecast.estimate.impossible')
    return d.h > 0 ? t('flightForecast.estimate.hoursMinutes', { h: d.h, m: d.m }) : t('flightForecast.estimate.minutes', { m: d.m })
  }
  let sorties: string
  if (!Number.isFinite(e.sorties)) sorties = t('flightForecast.estimate.sortiesImpossible')
  else if (e.sorties <= 1) sorties = t('flightForecast.estimate.oneSortie')
  else sorties = t('flightForecast.estimate.sorties', { count: e.sorties })

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2.5">
      <p className="mb-1.5 text-xs font-medium text-gray-500">{t('flightForecast.estimate.title')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-gray-600">{t('flightForecast.estimate.length')}</dt>
        <dd className="text-right tabular-nums text-gray-900">
          {t('flightForecast.estimate.km', { value: formatNumber(e.lengthM / 1000, lang, 1) })}
        </dd>
        <dt className="text-gray-600">{t('flightForecast.estimate.time')}</dt>
        <dd className="text-right tabular-nums text-gray-900">
          {duration(e.timeMin)}
          <span className="block text-xs text-gray-500">{t('flightForecast.estimate.worst', { value: duration(e.timeWorstMin) })}</span>
        </dd>
        <dt className="text-gray-600">{t('flightForecast.estimate.battery')}</dt>
        <dd className="text-right tabular-nums text-gray-900">
          {pct(e.batteryPct)}
          <span className="block text-xs text-gray-500">
            {t('flightForecast.estimate.worst', { value: pct(e.batteryWorstPct) })}
            {' · '}
            {t('flightForecast.estimate.usable', { value: formatNumber(e.usablePct, lang, 0) })}
          </span>
        </dd>
      </dl>
      <p className={`mt-2 text-sm font-medium ${e.sorties > 1 ? 'text-amber-900' : 'text-gray-900'}`}>{sorties}</p>
      {/* Число вылетов — оценка снизу: перелёты между точкой разбиения и базой в неё не входят */}
      {e.sorties > 1 && Number.isFinite(e.sorties) && (
        <p className="mt-1 text-xs text-gray-500">{t('flightForecast.estimate.sortiesNote')}</p>
      )}
      <p className="mt-1 text-xs text-gray-500">{t('flightForecast.estimate.worstNote')}</p>
    </div>
  )
}

function GapHint({ gap }: { gap: ForecastGap }) {
  const { t } = useTranslation()
  const to = gapScreen(gap)
  return (
    <div className="space-y-2 py-2 text-sm">
      <p className="text-gray-700">{t(`flightForecast.gaps.${gap}`)}</p>
      <ScreenLink to={to}>{t(`flightForecast.gapLinks.${gap}`)}</ScreenLink>
    </div>
  )
}

function PlanIssueNote({ issue }: { issue: PlanIssue }) {
  const { t } = useTranslation()
  return (
    <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
      {t(`flightForecast.planIssues.${issue}`)} <ScreenLink to={gapScreen(issue)}>{t('flightForecast.links.route')}</ScreenLink>
    </p>
  )
}

// На том же экране ссылка не нужна: подсказка и так относится к нему
function ScreenLink({ to, children }: { to: string; children: ReactNode }) {
  const { pathname } = useLocation()
  if (pathname === to) return null
  return (
    <Link to={to} className="font-medium text-blue-600 hover:text-blue-700">
      {children} →
    </Link>
  )
}
