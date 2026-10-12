import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { SPEED_OPTIONS, type SimClock } from './simClock'
import { CAMERA_MODES, formatClock, nextCameraMode, nextSpeed, type CameraMode } from './simView'
import { useSimSnapshot } from './useSimClock'
import { useSimKeyboard } from './useSimKeyboard'

interface SimControlsProps {
  clock: SimClock
  cameraMode: CameraMode
  onCameraMode: (mode: CameraMode) => void
  groundMap: boolean
  onGroundMap: (on: boolean) => void
}

const iconButton =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'

export default function SimControls({ clock, cameraMode, onCameraMode, groundMap, onGroundMap }: SimControlsProps) {
  const { t } = useTranslation()
  const id = useId()
  const snap = useSimSnapshot(clock)
  const elapsed = formatClock(snap.timeS)
  const total = formatClock(snap.durationS)
  const timeText = t('sim.controls.timeValue', { elapsed, total })

  useSimKeyboard({
    toggle: clock.toggle,
    restart: clock.restart,
    slower: () => clock.setSpeed(nextSpeed(clock.getSnapshot().speed, -1)),
    faster: () => clock.setSpeed(nextSpeed(clock.getSnapshot().speed, 1)),
    nextCamera: () => onCameraMode(nextCameraMode(cameraMode)),
  })

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm" role="group" aria-label={t('sim.controls.label')}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={clock.toggle}
          aria-label={snap.playing ? t('sim.controls.pause') : t('sim.controls.play')}
          title={snap.playing ? t('sim.controls.pause') : t('sim.controls.play')}
          aria-keyshortcuts="Space"
          className={iconButton}
        >
          {snap.playing ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 4.5v15l12.5-7.5z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={clock.restart}
          aria-label={t('sim.controls.restart')}
          title={t('sim.controls.restart')}
          aria-keyshortcuts="R"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5 5h2.5v14H5zM19 5v14L8.5 12z" />
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={Math.ceil(snap.durationS)}
          step={1}
          value={Math.min(Math.round(snap.timeS), Math.ceil(snap.durationS))}
          onChange={(e) => clock.seek(Number(e.target.value))}
          aria-label={t('sim.controls.timeline')}
          aria-valuetext={timeText}
          className="h-2 min-w-0 flex-1 cursor-pointer accent-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        />
        <span className="shrink-0 text-sm tabular-nums text-gray-700" aria-hidden="true">
          {elapsed} / {total}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-speed`} className="text-sm text-gray-600">
            {t('sim.controls.speed')}
          </label>
          <select
            id={`${id}-speed`}
            value={snap.speed}
            onChange={(e) => clock.setSpeed(Number(e.target.value))}
            aria-keyshortcuts="[ ]"
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {/* Скорость не из списка (задана кодом) тоже должна отображаться */}
            {(SPEED_OPTIONS.includes(snap.speed) ? SPEED_OPTIONS : [...SPEED_OPTIONS, snap.speed].sort((a, b) => a - b)).map((s) => (
              <option key={s} value={s}>
                {t('sim.controls.speedOption', { value: s })}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span id={`${id}-camera`} className="text-sm text-gray-600">
            {t('sim.controls.camera')}
          </span>
          <div role="group" aria-labelledby={`${id}-camera`} className="inline-flex rounded-lg bg-gray-100 p-1">
            {CAMERA_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={cameraMode === mode}
                aria-keyshortcuts="C"
                onClick={() => onCameraMode(mode)}
                className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  cameraMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t(`sim.controls.cameraModes.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={groundMap}
            onChange={(e) => onGroundMap(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          {t('sim.controls.groundMap')}
        </label>
      </div>

      <p className="text-xs text-gray-500">{t('sim.controls.hint')}</p>
    </div>
  )
}
