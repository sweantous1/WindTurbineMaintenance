import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import { DEFECT_COLORS, type AppDefectClass } from '@/domain/detection'
import { THRESHOLD_MAX, THRESHOLD_MIN, THRESHOLD_STEP, clampThreshold } from './detectionView'
import { formatConfidence } from './format'

interface DetectionFiltersProps {
  threshold: number
  defaultThreshold: number
  onThreshold: (value: number | null) => void
  options: readonly AppDefectClass[]
  hidden: ReadonlySet<AppDefectClass>
  onToggleClass: (cls: AppDefectClass, visible: boolean) => void
  // Находок каждого класса выше порога по всей миссии — подсказка, что прячет фильтр
  counts: Record<AppDefectClass, number>
}

export default function DetectionFilters({ threshold, defaultThreshold, onThreshold, options, hidden, onToggleClass, counts }: DetectionFiltersProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const sliderId = useId()
  const hintId = useId()

  return (
    <Card title={t('defects.filters.title')}>
      <div className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={sliderId} className="text-sm font-medium text-gray-700">
              {t('defects.filters.threshold')}
            </label>
            <output htmlFor={sliderId} className="text-sm font-semibold tabular-nums text-gray-900">
              {formatConfidence(threshold, lang)}
            </output>
          </div>
          <input
            id={sliderId}
            type="range"
            min={THRESHOLD_MIN}
            max={THRESHOLD_MAX}
            step={THRESHOLD_STEP}
            value={threshold}
            onChange={(e) => onThreshold(clampThreshold(Number(e.target.value)))}
            aria-describedby={hintId}
            className="mt-2 w-full accent-blue-600"
          />
          <div className="flex justify-between text-[11px] tabular-nums text-gray-400" aria-hidden="true">
            <span>{formatConfidence(THRESHOLD_MIN, lang)}</span>
            <span>{formatConfidence(THRESHOLD_MAX, lang)}</span>
          </div>
          <p id={hintId} className="mt-1.5 text-xs text-gray-500">
            {t('defects.filters.thresholdHint')}
          </p>
          {Math.abs(threshold - defaultThreshold) > 1e-9 && (
            <button
              type="button"
              onClick={() => onThreshold(null)}
              className="mt-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              {t('defects.filters.reset', { value: formatConfidence(defaultThreshold, lang) })}
            </button>
          )}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-gray-700">{t('defects.filters.classes')}</legend>
          {options.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">{t('defects.filters.noClasses')}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {options.map((cls) => (
                <li key={cls}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-gray-800 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={!hidden.has(cls)}
                      onChange={(e) => onToggleClass(cls, e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                    />
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: DEFECT_COLORS[cls] }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t(`defects.classes.${cls}`)}</span>
                    <span className="text-xs tabular-nums text-gray-400">{counts[cls]}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </div>
    </Card>
  )
}
