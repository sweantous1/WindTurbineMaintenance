import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import StatusBadge from '@/components/common/StatusBadge'
import ReadOnlyBanner from '@/components/mission/ReadOnlyBanner'
import { isPreFlight } from '@/domain/missionStatus'
import type { Mission } from '@/domain/types'
import { useActiveMission, useMissionCount, useMissionDrone } from '@/hooks/useMissions'
import CompleteMissionDialog from '@/features/mission/CompleteMissionDialog'
import MissionSettingsDialog from '@/features/mission/MissionSettingsDialog'
import MissionStepper from '@/features/mission/MissionStepper'
import NewMissionDialog from '@/features/mission/NewMissionDialog'
import { formatLocalHour, formatValue, routeKm, turbineCount } from '@/features/mission/missionView'
import FlightForecastCard from '@/features/forecast/FlightForecastCard'
import { droneDisplayName } from '@/features/settings/droneName'
import { formatDate } from '@/utils'

export default function Home() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const active = useActiveMission()
  // Главной нужно только «есть ли миссии», а не сами записи со всей историей
  const missionCount = useMissionCount()
  const [creating, setCreating] = useState(false)
  // id миссии, для которой открыты параметры: окно не должно само открыться у другой миссии,
  // если эта пропала (удалили в истории) и активной потом стала новая
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  // Снимок миссии для диалога завершения: после записи активная миссия сбрасывается
  const [completing, setCompleting] = useState<Mission | null>(null)

  let body: ReactNode
  if (active === undefined) {
    body = <p className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</p>
  } else if (active === null) {
    const hasMissions = (missionCount ?? 0) > 0
    body = (
      <>
        <Card>
          <div className="mx-auto max-w-xl space-y-3 py-8 text-center">
            <h2 className="text-lg font-semibold text-gray-900">
              {hasMissions ? t('mission.home.noActiveTitle') : t('mission.home.firstTitle')}
            </h2>
            <p className="text-sm text-gray-500">{hasMissions ? t('mission.home.noActiveHint') : t('mission.home.firstHint')}</p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button onClick={() => setCreating(true)}>{t('mission.switcher.create')}</Button>
              {hasMissions && (
                <Button variant="secondary" onClick={() => navigate('/history')}>
                  {t('mission.home.openHistory')}
                </Button>
              )}
            </div>
          </div>
        </Card>
        <MissionStepper mission={undefined} onCreate={() => setCreating(true)} />
      </>
    )
  } else {
    body = (
      <>
        <ReadOnlyBanner mission={active} />
        <MissionCard mission={active} onSettings={() => setSettingsFor(active.id)} onComplete={() => setCompleting(active)} />
        <MissionStepper
          mission={active}
          onCreate={() => setCreating(true)}
          onOpenSettings={() => setSettingsFor(active.id)}
          onComplete={() => setCompleting(active)}
        />
        <FlightForecastCard mission={active} />
      </>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('mission.home.title')}</h1>
        <p className="mt-1 text-gray-500">{t('mission.home.subtitle')}</p>
      </div>

      {body}

      {/* Диалоги стоят вне веток: смена активной миссии не должна закрывать их посреди работы */}
      <NewMissionDialog isOpen={creating} onClose={() => setCreating(false)} />
      {active && (
        <MissionSettingsDialog mission={active} isOpen={settingsFor === active.id} onClose={() => setSettingsFor(null)} />
      )}
      <CompleteMissionDialog mission={completing} onClose={() => setCompleting(null)} />
    </div>
  )
}

interface MissionCardProps {
  mission: Mission
  onSettings: () => void
  onComplete: () => void
}

function MissionCard({ mission: m, onSettings, onComplete }: MissionCardProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const drone = useMissionDrone(m)
  const count = turbineCount(m)
  const km = routeKm(m, lang)
  const preFlight = isPreFlight(m.status)

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-xl font-semibold text-gray-900" title={m.name}>
              {m.name}
            </h2>
            <StatusBadge status={m.status} />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {t(`mission.types.${m.type}`)} · {t('mission.card.createdAt', { date: formatDate(m.createdAt, lang) })}
            {m.completedAt && <> · {t('mission.card.completedAt', { date: formatDate(m.completedAt, lang) })}</>}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={onSettings}>
            {t('mission.card.settings')}
          </Button>
          {preFlight && (
            <Button size="sm" onClick={onComplete}>
              {t('mission.card.complete')}
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-gray-100 pt-4 sm:grid-cols-3 lg:grid-cols-5">
        <Fact label={t('mission.card.drone')} value={drone ? droneDisplayName(drone, t) : '…'} />
        <Fact label={t('mission.card.flightAltitude')} value={t('mission.units.meters', { value: formatValue(m.flightAltitudeM, lang) })} />
        <Fact
          label={t('mission.card.turbines')}
          value={count !== null ? String(count) : null}
          empty={t('mission.card.noFarm')}
        />
        <Fact
          label={t('mission.card.route')}
          value={km !== null ? t('mission.units.km', { value: km }) : null}
          empty={t('mission.card.noRoute')}
        />
        <Fact
          label={t('mission.card.departure')}
          value={m.departureTime ? formatLocalHour(m.departureTime, lang) : null}
          empty={t('mission.card.noDeparture')}
          sub={m.departureTime ? t('mission.card.farmTime') : undefined}
          title={m.weather?.timezone}
        />
      </dl>
    </Card>
  )
}

interface FactProps {
  label: string
  value: string | null
  empty?: string
  sub?: string
  title?: string
}

function Fact({ label, value, empty, sub, title }: FactProps) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 min-w-0" title={title ?? value ?? undefined}>
        {value !== null ? (
          <span className="block truncate text-sm font-medium text-gray-900">{value}</span>
        ) : (
          // «Не рассчитан» — состояние миссии, а не декор: контраст не ниже 4,5:1, на солнце его тоже читают
          <span className="block truncate text-sm text-gray-600">{empty ?? '—'}</span>
        )}
        {sub && <span className="block text-xs text-gray-500">{sub}</span>}
      </dd>
    </div>
  )
}
