import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import Button from '@/components/common/Button'
import Card from '@/components/common/Card'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import RequireMission from '@/components/mission/RequireMission'
import { isPreFlight } from '@/domain/missionStatus'
import type { DroneProfile, Mission } from '@/domain/types'
import { useMissionDrone } from '@/hooks/useMissions'
import CompleteMissionDialog from '@/features/mission/CompleteMissionDialog'
import FlightEndCard from '@/features/simulation/FlightEndCard'
import SimControls from '@/features/simulation/SimControls'
import SimPanel from '@/features/simulation/SimPanel'
import { createSimClock, type SimClock } from '@/features/simulation/simClock'
import { useSimData, type SimGap, type SimReady } from '@/features/simulation/simData'
import type { CameraMode } from '@/features/simulation/simView'
import { useSimSnapshot } from '@/features/simulation/useSimClock'
import { formatDate } from '@/utils'
import { readLocal, writeLocal } from '@/utils/storage'

// Сцена с three.js - отдельный ленивый чанк: панель и управление работают, пока он грузится, и без WebGL
const SimulationCanvas = lazy(() => import('@/features/simulation/scene/SimulationCanvas'))

const GROUND_MAP_KEY = 'wtm_sim_ground_map'

const GAP_LINKS: Record<SimGap, string> = {
  farm: '/router',
  route: '/router',
  speed: '/settings',
}

export default function Simulation() {
  // Диалог завершения вне RequireMission: после записи активная миссия сбрасывается,
  // а окно должно остаться до нажатия "Закрыть"
  const [completing, setCompleting] = useState<Mission | null>(null)
  return (
    <>
      <RequireMission>{(mission) => <SimulationScreen key={mission.id} mission={mission} onComplete={() => setCompleting(mission)} />}</RequireMission>
      <CompleteMissionDialog mission={completing} onClose={() => setCompleting(null)} />
    </>
  )
}

function SimulationScreen({ mission, onComplete }: { mission: Mission; onComplete: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const drone = useMissionDrone(mission)
  const data = useSimData(mission, drone)
  const preFlight = isPreFlight(mission.status)

  let body: ReactNode
  if (!drone || !data) body = <p className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</p>
  else if (data.kind === 'gap') body = <GapCard gap={data.gap} preFlight={preFlight} />
  else body = <SimulationView data={data} mission={mission} drone={drone} onComplete={onComplete} />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{t('sim.title')}</h1>
          <p className="mt-1 truncate text-gray-500">{t('sim.mission', { name: mission.name })}</p>
        </div>
        {preFlight && (
          <Button variant="secondary" onClick={onComplete}>
            {t('sim.completeFlight')}
          </Button>
        )}
      </div>

      {!preFlight && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {mission.completedAt ? t('sim.flown', { date: formatDate(mission.completedAt, lang) }) : t('sim.flownNoDate')}
        </div>
      )}

      {body}
    </div>
  )
}

function GapCard({ gap, preFlight }: { gap: SimGap; preFlight: boolean }) {
  const { t } = useTranslation()
  return (
    <Card>
      <div className="mx-auto max-w-xl space-y-3 py-10 text-center">
        <p className="font-medium text-gray-800">{t(`sim.gaps.${gap}.title`)}</p>
        {/* После полёта данные миссии не меняются, ссылка на исправление не нужна */}
        <p className="text-sm text-gray-600">{t(preFlight ? `sim.gaps.${gap}.body` : 'sim.gaps.flownBody')}</p>
        {preFlight && (
          <Link to={GAP_LINKS[gap]} className="inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
            {t(`sim.gaps.${gap}.link`)} →
          </Link>
        )}
      </div>
    </Card>
  )
}

interface SimulationViewProps {
  data: SimReady
  mission: Mission
  drone: DroneProfile
  onComplete: () => void
}

function SimulationView({ data, mission, drone, onComplete }: SimulationViewProps) {
  const { t } = useTranslation()
  // Стартуем на паузе, скорость подобрана под облёт примерно за две минуты
  const [clock] = useState(() => createSimClock(data.trajectory.durationS))
  const durationS = data.trajectory.durationS
  // План могли поменять в другом окне - длительность подстраиваем, позиция сохраняется
  useEffect(() => clock.setDuration(durationS), [clock, durationS])
  const snap = useSimSnapshot(clock)
  const [cameraMode, setCameraMode] = useState<CameraMode>('follow')
  const [groundMap, setGroundMap] = useState(() => readLocal(GROUND_MAP_KEY) !== '0')

  const changeGroundMap = (on: boolean) => {
    setGroundMap(on)
    writeLocal(GROUND_MAP_KEY, on ? '1' : '0')
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 min-[960px]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        {/* isolate, чтобы подписи сцены (z-index до 40) не вылезали поверх шапки и окон */}
        <div className="relative isolate h-[calc(100vh-220px)] min-h-[420px] overflow-hidden rounded-xl border border-gray-200 bg-slate-200">
          <ErrorBoundary fallback={<SceneUnavailable clock={clock} />}>
            <Suspense fallback={<p className="flex h-full items-center justify-center text-sm text-gray-600">{t('sim.scene.loading')}</p>}>
              <SimulationCanvas data={data} clock={clock} cameraMode={cameraMode} groundMap={groundMap} />
            </Suspense>
          </ErrorBoundary>
          {groundMap && (
            <p className="absolute bottom-1 right-1 z-50 rounded bg-white/80 px-1.5 py-0.5 text-[11px] text-gray-700">
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="hover:underline">
                {t('sim.scene.osm')}
              </a>
            </p>
          )}
          {snap.ended && <FlightEndCard trajectory={data.trajectory} mission={mission} drone={drone} clock={clock} onComplete={onComplete} />}
        </div>
        <SimControls clock={clock} cameraMode={cameraMode} onCameraMode={setCameraMode} groundMap={groundMap} onGroundMap={changeGroundMap} />
      </div>
      <SimPanel data={data} mission={mission} drone={drone} clock={clock} />
    </div>
  )
}

// Без WebGL сцены нет, но часы должны идти - панель, шкала и итоги работают и без неё
function SceneUnavailable({ clock }: { clock: SimClock }) {
  const { t } = useTranslation()
  useEffect(() => {
    let last = performance.now()
    let id = requestAnimationFrame(function step(now) {
      clock.tick((now - last) / 1000)
      last = now
      id = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(id)
  }, [clock])
  return (
    <div role="alert" className="flex h-full items-center justify-center p-6">
      <div className="max-w-md space-y-2 rounded-xl border border-amber-200 bg-white p-5 text-center shadow-sm">
        <p className="font-medium text-gray-900">{t('sim.scene.unavailableTitle')}</p>
        <p className="text-sm text-gray-600">{t('sim.scene.unavailableBody')}</p>
      </div>
    </div>
  )
}
