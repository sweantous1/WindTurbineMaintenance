import { useTranslation } from 'react-i18next'
import Button from '@/components/common/Button'
import type { DetectBackend } from '@/services/detectionEngine'
import type { EngineStatus } from './useAnalysis'

interface EngineStatusBarProps {
  status: EngineStatus
  // Где считался последний кадр, после сбоя WebGPU движок уходит на CPU
  lastBackend: DetectBackend | null
  onRecheck: () => void
}

export default function EngineStatusBar({ status, lastBackend, onRecheck }: EngineStatusBarProps) {
  const { t } = useTranslation()

  if (status.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600" role="status">
        <svg className="h-4 w-4 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {t('defects.engine.loading')}
      </div>
    )
  }

  if (status.kind === 'missing' || status.kind === 'failed') {
    const missing = status.kind === 'missing'
    return (
      <div
        role="alert"
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
          missing ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {missing ? t('defects.engine.missingTitle') : t('defects.engine.failedTitle', { reason: t(`defects.errors.${status.code}`) })}
          </p>
          <p className="mt-0.5 opacity-90">{missing ? t('defects.engine.missingHint') : t('defects.engine.failedHint')}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onRecheck}>
          {t('defects.engine.recheck')}
        </Button>
      </div>
    )
  }

  const { manifest } = status
  const backend = lastBackend ?? status.backend

  return (
    <div className="rounded-xl border border-gray-200 bg-white text-sm">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-2.5">
        <p className="min-w-0">
          <span className="text-gray-500">{t('defects.engine.model')}: </span>
          <span className="font-medium text-gray-900 break-all">{manifest.name}</span>
          <span className="text-gray-500"> · {t('defects.engine.version', { version: manifest.version })}</span>
        </p>
        <p>
          <span className="text-gray-500">{t('defects.engine.device')}: </span>
          <span className="font-medium text-gray-900">{t(`defects.engine.backend.${backend}`)}</span>
        </p>
      </div>
    </div>
  )
}
