import { useTranslation } from 'react-i18next'
import type { Defect, DefectType } from '@/types'

interface AnalysisResultProps {
  defects: Defect[]
}

const defectTypes: DefectType[] = ['crack', 'corrosion', 'delamination', 'erosion', 'lightning']

const defectColors: Record<DefectType, string> = {
  crack: '#ef4444',
  corrosion: '#f97316',
  delamination: '#8b5cf6',
  erosion: '#eab308',
  lightning: '#22d3ee',
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

  const counts: Record<DefectType, number> = {
    crack: 0,
    corrosion: 0,
    delamination: 0,
    erosion: 0,
    lightning: 0,
  }
  defects.forEach((d) => { counts[d.type]++ })

  return (
    <div className="space-y-2">
      {defectTypes.filter((type) => counts[type] > 0).map((type) => (
        <div key={type} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: defectColors[type] }}></span>
            <span className="text-sm font-medium text-gray-900">
              {t(`detection.defectTypes.${type}`)}
            </span>
          </div>
          <span className="text-sm text-gray-500">{counts[type]}</span>
        </div>
      ))}
    </div>
  )
}
