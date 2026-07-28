import { useTranslation } from 'react-i18next'
import type { Defect } from '@/types'
import StatusBadge from '@/components/common/StatusBadge'

interface AnalysisResultProps {
  defects: Defect[]
}

export default function AnalysisResult({ defects }: AnalysisResultProps) {
  const { t } = useTranslation()

  if (defects.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-5xl mb-3">-</div>
        <p className="font-medium">{t('detection.noDefects')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">
          {t('detection.found')} {defects.length} {defects.length > 1 ? t('detection.defects') : t('detection.defect')}
        </p>
      </div>
      <div className="space-y-2">
        {defects.map((defect) => (
          <div key={defect.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <div>
                <p className="text-sm font-medium text-gray-900">{t(`detection.defectTypes.${defect.type}`)}</p>
                <p className="text-xs text-gray-500">{t('detection.confidence')}: {(defect.confidence * 100).toFixed(1)}%</p>
              </div>
            </div>
            <StatusBadge status={defect.severity} />
          </div>
        ))}
      </div>
    </div>
  )
}
