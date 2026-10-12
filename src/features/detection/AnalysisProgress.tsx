import { useTranslation } from 'react-i18next'
import Button from '@/components/common/Button'
import { currentTile, runFraction, type RunProgress } from './analysisRunner'

interface AnalysisProgressProps {
  run: RunProgress
  // Анализ идёт по другой миссии: движок занят, но остановить можно
  otherMission: boolean
  onCancel: () => void
}

export default function AnalysisProgress({ run, otherMission, onCancel }: AnalysisProgressProps) {
  const { t } = useTranslation()
  const percent = Math.round(runFraction(run) * 100)
  const photoText = t('defects.progress.photo', { index: run.index + 1, total: run.photoIds.length })
  const tileText = run.tiles > 0 ? t('defects.progress.tile', { tile: currentTile(run.tile, run.tiles), tiles: run.tiles }) : t('defects.progress.preparing')

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-blue-900">
          {/* Озвучиваем только смену фото, фрагменты меняются слишком часто */}
          {otherMission ? (
            <span className="font-medium" role="status">
              {t('defects.progress.otherMission')}
            </span>
          ) : (
            <>
              <span className="font-medium" role="status">
                {photoText}
              </span>
              <span className="text-blue-800"> · {tileText}</span>
            </>
          )}
        </p>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={run.cancelling}>
          {run.cancelling ? t('defects.progress.cancelling') : t('defects.progress.cancel')}
        </Button>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={photoText}
      >
        <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
