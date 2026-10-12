import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Card from '@/components/common/Card'
import { isPreFlight, missionSteps, type MissionStep, type MissionStepKey } from '@/domain/missionStatus'
import type { Mission } from '@/domain/types'
import { formatDate } from '@/utils'
import { formatLocalHour, formatValue, routeKm, turbineCount } from './missionView'

interface MissionStepperProps {
  // undefined - миссии нет: шаги как план работы, доступно только создание
  mission: Mission | undefined
  onCreate: () => void
  // Нужны только при миссии
  onOpenSettings?: () => void
  onComplete?: () => void
}

const STEP_PATHS: Partial<Record<MissionStepKey, string>> = {
  farm: '/router',
  route: '/router',
  weather: '/weather',
  simulation: '/simulation',
  detection: '/detection',
  history: '/history',
}

export default function MissionStepper({ mission, onCreate, onOpenSettings, onComplete }: MissionStepperProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const navigate = useNavigate()
  const steps = missionSteps(mission)
  // Текущий - первый невыполненный обязательный шаг (3D-облёт можно пропустить)
  const current = mission ? steps.find((s) => !s.done && !s.optional)?.key : 'mission'
  const hasRoute = !!mission?.route && mission.route.order.length > 0

  const actionFor = (s: MissionStep): (() => void) | undefined => {
    // Без маршрута в 3D показывать нечего
    if (s.key === 'simulation' && !hasRoute) return undefined
    if (s.key === 'mission') return mission ? onOpenSettings : onCreate
    if (!mission) return s.key === 'history' ? () => navigate('/history') : undefined
    if (s.key === 'complete') return isPreFlight(mission.status) ? onComplete : undefined
    const path = STEP_PATHS[s.key]
    return path ? () => navigate(path) : undefined
  }

  const detailFor = (s: MissionStep): string => {
    const hint = t(`mission.steps.${s.key}.hint`)
    if (!mission) return hint
    switch (s.key) {
      case 'mission':
        return `${t(`mission.types.${mission.type}`)} · ${t('mission.units.meters', { value: formatValue(mission.flightAltitudeM, lang) })}`
      case 'farm': {
        const count = turbineCount(mission)
        return count ? t('mission.turbineCount', { count }) : hint
      }
      case 'route': {
        const km = routeKm(mission, lang)
        return km ? t('mission.units.km', { value: km }) : hint
      }
      case 'weather':
        if (mission.departureTime) return t('mission.steps.weather.departure', { time: formatLocalHour(mission.departureTime, lang) })
        return mission.weather ? t('mission.steps.weather.noHour') : hint
      case 'complete':
        return mission.completedAt ? t('mission.steps.complete.doneAt', { date: formatDate(mission.completedAt, lang) }) : hint
      default:
        return hint
    }
  }

  // Выбранный час ещё не допуск к полёту, вердикт в карточке прогноза под шагами,
  // поэтому рядом с галочкой подсказка
  const noteFor = (s: MissionStep): string | null =>
    mission && s.key === 'weather' && s.done ? t('mission.steps.weather.verdictHint') : null

  const captionFor = (s: MissionStep): ReactNode => {
    if (s.done) return <span className="text-green-700">{t('mission.steps.caption.done')}</span>
    if (s.optional) return <span className="text-gray-600">{t('mission.steps.caption.optional')}</span>
    if (s.key === current) return <span className="text-blue-700">{t('mission.steps.caption.current')}</span>
    if (s.key === 'detection') return <span className="text-amber-700">{t('mission.steps.caption.afterFlight')}</span>
    return null
  }

  return (
    <Card title={t('mission.steps.title')} subtitle={mission ? undefined : t('mission.steps.previewSubtitle')}>
      <ol className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {steps.map((s, i) => {
          const action = actionFor(s)
          const isCurrent = s.key === current
          const note = noteFor(s)
          const tone = s.done
            ? 'border-green-200 bg-green-50/60'
            : isCurrent
              ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-400'
              : 'border-gray-200 bg-white'
          const content = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    s.done ? 'bg-green-600 text-white' : isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                  aria-hidden="true"
                >
                  {s.done ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="truncate text-xs font-medium">{captionFor(s)}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{t(`mission.steps.${s.key}.title`)}</p>
              <p className="mt-0.5 text-xs text-gray-500 line-clamp-2 break-words">{detailFor(s)}</p>
              {note && <p className="mt-1 text-xs font-medium text-blue-700 break-words">{note}</p>}
            </>
          )
          return (
            <li key={s.key} className="min-w-0">
              {action ? (
                <button
                  type="button"
                  onClick={action}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`h-full w-full rounded-lg border p-3 text-left transition hover:border-blue-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tone}`}
                >
                  {content}
                </button>
              ) : (
                // Без opacity: полупрозрачный серый не дотягивает до 4,5:1, неактивность и так видна по рамке
                <div aria-current={isCurrent ? 'step' : undefined} className={`h-full rounded-lg border p-3 ${tone}`}>
                  {content}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
