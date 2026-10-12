import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/common/Button'
import { batteryUsedPct, type Trajectory } from '@/domain/flightPath'
import { isPreFlight } from '@/domain/missionStatus'
import type { DroneProfile, Mission } from '@/domain/types'
import { formatNumber } from '@/features/mission/missionView'
import { formatDate } from '@/utils'
import type { SimClock } from './simClock'
import { formatClock } from './simView'

interface FlightEndCardProps {
  trajectory: Trajectory
  mission: Mission
  drone: DroneProfile
  clock: SimClock
  // Только для миссии до полёта: открыть диалог завершения
  onComplete: () => void
}

// Итоги поверх сцены, когда проигрывание дошло до конца
export default function FlightEndCard({ trajectory, mission, drone, clock, onComplete }: FlightEndCardProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const navigate = useNavigate()
  const preFlight = isPreFlight(mission.status)
  const used = batteryUsedPct(trajectory.durationS, drone.enduranceMin)

  const replay = () => {
    clock.restart()
    clock.play()
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center p-4">
      <section
        aria-labelledby="sim-end-title"
        className="pointer-events-auto w-full max-w-sm rounded-xl border border-gray-200 bg-white/95 p-5 shadow-xl backdrop-blur"
      >
        <h2 id="sim-end-title" className="text-lg font-semibold text-gray-900">
          {t('sim.end.title')}
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-gray-600">{t('sim.end.turbines')}</dt>
            <dd className="font-medium tabular-nums text-gray-900">{trajectory.visits.length}</dd>
          </div>
          <div>
            <dt className="text-gray-600">{t('sim.end.distance')}</dt>
            <dd className="font-medium tabular-nums text-gray-900">{t('sim.end.km', { value: formatNumber(trajectory.lengthM / 1000, lang, 1) })}</dd>
          </div>
          <div>
            <dt className="text-gray-600">{t('sim.end.time')}</dt>
            <dd className="font-medium tabular-nums text-gray-900">{formatClock(trajectory.durationS)}</dd>
          </div>
          <div>
            <dt className="text-gray-600">{t('sim.end.battery')}</dt>
            <dd className={`font-medium tabular-nums ${used > 100 ? 'text-red-700' : 'text-gray-900'}`}>
              {Number.isFinite(used) ? t('sim.now.percent', { value: formatNumber(used, lang, 0) }) : '—'}
            </dd>
          </div>
        </dl>
        {!preFlight && (
          <p className="mt-3 text-sm text-gray-600">
            {mission.completedAt ? t('sim.end.alreadyFlown', { date: formatDate(mission.completedAt, lang) }) : t('sim.end.alreadyFlownNoDate')}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={replay}>
            {t('sim.end.again')}
          </Button>
          {preFlight && (
            <Button type="button" variant="secondary" onClick={onComplete}>
              {t('sim.completeFlight')}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => navigate('/')}>
            {t('sim.end.home')}
          </Button>
        </div>
      </section>
    </div>
  )
}
