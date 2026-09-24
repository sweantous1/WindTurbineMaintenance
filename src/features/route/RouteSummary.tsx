import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import type { DroneProfile, Farm, FlightPlan, RoutePlan } from '@/domain/types'
import { estimateMission } from '@/domain/flightCheck'
import { turbineHubM } from '@/domain/flightPlan'
import { formatKm, formatNumber } from './format'
import { orbitSegmentTurbine, segmentEndpoints, turbinesAboveCeiling, verticalPlace, type EndpointRef } from './planGeometry'
import { cleanOrder } from './routeLogic'

interface RouteSummaryProps {
  farm: Farm
  route?: RoutePlan
  plan?: FlightPlan
  // undefined — профиль ещё загружается
  drone?: DroneProfile
  flightAltitudeM: number
  ceilingM: number
}

// Сколько имён турбин перечислять в предупреждении, остальные — числом
const MAX_LISTED_NAMES = 5

function Tile({ label, value, sub, tone = 'normal' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'normal' | 'bad' }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${tone === 'bad' ? 'bg-red-50' : 'bg-gray-50'}`}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-base font-semibold ${tone === 'bad' ? 'text-red-700' : 'text-gray-900'}`}>{value}</dd>
      {sub && <dd className="text-xs text-gray-500 mt-0.5">{sub}</dd>}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'bad'; children: ReactNode }) {
  const cls = tone === 'bad' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
  return <li className={`text-sm rounded-lg border px-3 py-2 ${cls}`}>{children}</li>
}

export default function RouteSummary({ farm, route, plan, drone, flightAltitudeM, ceilingM }: RouteSummaryProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const m = (value: number) => t('routePlan.units.mValue', { value: formatNumber(value, lang) })

  const names = new Map(farm.turbines.map((tb) => [tb.id, tb.name]))
  const nameOf = (id: string) => names.get(id) ?? id
  const listNames = (ids: string[]) => {
    const shown = ids.slice(0, MAX_LISTED_NAMES).map(nameOf).join(', ')
    const rest = ids.length - MAX_LISTED_NAMES
    return rest > 0 ? t('routePlan.summary.andMore', { names: shown, rest }) : shown
  }
  const endpoint = (e: EndpointRef) => {
    if (e.kind === 'turbine') return nameOf(e.id)
    return t(`routePlan.summary.endpoints.${e.kind}`)
  }

  const order = route ? cleanOrder(farm, route.order) : []
  const notInRoute = farm.turbines.length - order.length
  const above = turbinesAboveCeiling(farm, ceilingM)
  const estimate = plan && drone ? estimateMission(plan.lengthM, drone) : undefined
  const transitAltM = plan?.transitAltM ?? Math.min(flightAltitudeM, ceilingM)

  const notices: ReactNode[] = []
  if (above.length > 0) {
    const maxHub = Math.max(...above.map((tb) => turbineHubM(farm, tb)))
    notices.push(
      <Notice key="above" tone="bad">
        {t('routePlan.summary.hubAboveCeiling', {
          ceiling: formatNumber(ceilingM, lang),
          hub: formatNumber(maxHub, lang),
          names: listNames(above.map((tb) => tb.id)),
        })}
      </Notice>,
    )
  }
  if (flightAltitudeM > ceilingM) {
    notices.push(
      <Notice key="transit" tone="warn">
        {t('routePlan.summary.transitClamped', { flight: formatNumber(flightAltitudeM, lang), ceiling: formatNumber(ceilingM, lang) })}
      </Notice>,
    )
  }
  if (route && notInRoute > 0) {
    notices.push(
      <Notice key="missing" tone="warn">
        {t('routePlan.summary.notInRoute', { count: notInRoute })}
      </Notice>,
    )
  }
  if (estimate && estimate.sorties > 1) {
    notices.push(
      <Notice key="battery" tone={Number.isFinite(estimate.sorties) ? 'warn' : 'bad'}>
        {Number.isFinite(estimate.sorties)
          ? t('routePlan.summary.sorties', { count: estimate.sorties })
          : t('routePlan.summary.unreachable')}
      </Notice>,
    )
  }

  return (
    <Card title={t('routePlan.summary.title')}>
      <div className="space-y-4">
        {!route && <p className="text-sm text-gray-500">{t('routePlan.summary.noRoute')}</p>}

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile
            label={t('routePlan.summary.turbines')}
            value={route ? t('routePlan.summary.turbinesValue', { inRoute: order.length, total: farm.turbines.length }) : farm.turbines.length}
          />
          <Tile
            label={t('routePlan.summary.length')}
            value={plan ? t('routePlan.units.kmValue', { value: formatKm(plan.lengthM, lang) }) : '—'}
            sub={plan ? t('routePlan.summary.lengthHint') : undefined}
          />
          <Tile
            label={t('routePlan.summary.time')}
            value={estimate ? t('routePlan.units.minValue', { value: formatNumber(estimate.timeMin, lang) }) : '—'}
            sub={drone ? t('routePlan.summary.timeHint', { speed: formatNumber(drone.cruiseSpeedMs, lang, 1) }) : undefined}
          />
          <Tile
            label={t('routePlan.summary.battery')}
            tone={estimate && estimate.sorties > 1 ? 'bad' : 'normal'}
            value={estimate ? t('routePlan.units.pctValue', { value: formatNumber(estimate.batteryPct, lang) }) : '—'}
            sub={
              drone
                ? t('routePlan.summary.batteryHint', {
                    usable: formatNumber(100 - drone.reservePct, lang),
                    reserve: formatNumber(drone.reservePct, lang),
                  })
                : undefined
            }
          />
          <Tile
            label={t('routePlan.summary.transitAlt')}
            value={m(transitAltM)}
            sub={flightAltitudeM > ceilingM ? t('routePlan.summary.clampedByCeiling') : undefined}
          />
          <Tile
            label={t('routePlan.summary.maxAlt')}
            tone={plan && plan.maxAltM > ceilingM ? 'bad' : 'normal'}
            value={plan ? m(plan.maxAltM) : '—'}
            sub={t('routePlan.summary.ceiling', { value: formatNumber(ceilingM, lang) })}
          />
          <Tile
            label={t('routePlan.summary.turnViolations')}
            tone={route && route.turnViolations > 0 ? 'bad' : 'normal'}
            value={route ? formatNumber(route.turnViolations, lang) : '—'}
            sub={
              route
                ? route.thetaMaxDeg >= 180
                  ? t('routePlan.summary.noTurnLimit')
                  : t('routePlan.summary.turnLimit', { theta: formatNumber(route.thetaMaxDeg, lang) })
                : undefined
            }
          />
          <Tile
            label={t('routePlan.summary.source')}
            value={
              route
                ? route.source === 'auto'
                  ? t(`routePlan.settings.algorithms.${route.algorithm}`)
                  : t('routePlan.summary.sourceEdited')
                : '—'
            }
            sub={route ? t('routePlan.summary.computedAt', { date: formatDateTime(route.computedAt, lang) }) : undefined}
          />
        </dl>

        {notices.length > 0 && <ul className="space-y-2">{notices}</ul>}

        {plan && (
          <div>
            <h4 className="text-sm font-semibold text-gray-800 mb-2">
              {t('routePlan.summary.conflictsTitle', { n: plan.conflicts.length })}
            </h4>
            {plan.conflicts.length === 0 ? (
              <p className="text-sm text-gray-500">{t('routePlan.summary.noConflicts')}</p>
            ) : (
              <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {plan.conflicts.map((c, i) => {
                  const ends = segmentEndpoints(plan, c.segmentIndex)
                  const orbitOf = orbitSegmentTurbine(plan, c.segmentIndex)
                  const values = {
                    turbine: nameOf(c.turbineId),
                    distance: formatNumber(c.distanceM, lang),
                    min: formatNumber(c.minDistanceM, lang),
                  }
                  return (
                    <li key={`${c.segmentIndex}-${c.turbineId}-${i}`} className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">
                      {!ends
                        ? t('routePlan.summary.conflictUnknown', values)
                        : orbitOf !== undefined
                          ? t('routePlan.summary.conflictOrbit', { ...values, at: nameOf(orbitOf) })
                          : ends.vertical
                            ? t('routePlan.summary.conflictVertical', { ...values, at: endpoint(verticalPlace(ends)) })
                            : t('routePlan.summary.conflict', { ...values, from: endpoint(ends.from), to: endpoint(ends.to) })}
                    </li>
                  )
                })}
              </ul>
            )}
            {plan.conflicts.length > 0 && <p className="text-xs text-gray-500 mt-2">{t('routePlan.summary.conflictsHint')}</p>}
            {/* Облёт, задевший соседа, не исправить ни взлётом, ни порядком, ни высотой транзита */}
            {plan.conflicts.some((c) => orbitSegmentTurbine(plan, c.segmentIndex) !== undefined) && (
              <p className="text-xs text-gray-500 mt-1">{t('routePlan.summary.conflictsOrbitHint')}</p>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function formatDateTime(iso: string, lang: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' })
}
