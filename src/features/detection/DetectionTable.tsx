import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFECT_COLORS, type Detection, type PhotoAnalysis, type Severity } from '@/domain/detection'
import { SEVERITIES, isHighSeverity } from './detectionView'
import { formatConfidence } from './format'

interface DetectionTableProps {
  analysis: PhotoAnalysis | undefined
  // Видимые находки фото, самые уверенные первыми
  detections: readonly Detection[]
  // Все сохранённые находки фото (от 0,1)
  total: number
  selectedId: string | null
  onSelect: (id: string) => void
  readOnly: boolean
  onSeverity: (id: string, severity: Severity) => void
  onReviewed: (id: string, reviewed: boolean) => void
}

export default function DetectionTable({ analysis, detections, total, selectedId, onSelect, readOnly, onSeverity, onReviewed }: DetectionTableProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLTableSectionElement>(null)

  // Докручиваем до выбранной строки только саму таблицу, чтобы страница не уезжала от снимка
  useEffect(() => {
    const box = scrollRef.current
    const row = Array.from(bodyRef.current?.rows ?? []).find((r) => r.dataset.detectionId === selectedId)
    if (!box || !row) return
    const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const b = box.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    if (r.top < b.top + head) box.scrollTop -= b.top + head - r.top
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
  }, [selectedId])

  if (!analysis) return <Empty text={t('defects.table.notAnalyzed')} />
  // У архивной миссии нет кнопки повтора
  if (analysis.status === 'failed') return <Empty text={readOnly ? t('defects.table.failedReadOnly') : t('defects.table.failed')} />
  if (total === 0) return <Empty text={t('defects.table.noneFound')} />

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">{t('defects.table.shown', { shown: detections.length, total })}</p>
      {detections.length === 0 ? (
        <Empty text={t('defects.table.empty')} />
      ) : (
        // relative, иначе sr-only подписи растягивают страницу; max-h чтобы шапка оставалась на виду
        <div ref={scrollRef} className="relative max-h-[26rem] overflow-auto rounded-lg border border-gray-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr className="whitespace-nowrap text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="w-10 py-2 pl-4 pr-2 font-medium">{t('defects.table.columns.index')}</th>
                <th className="px-2 py-2 font-medium">{t('defects.table.columns.class')}</th>
                <th className="px-2 py-2 font-medium">{t('defects.table.columns.modelClass')}</th>
                <th className="px-2 py-2 text-right font-medium">{t('defects.table.columns.confidence')}</th>
                <th className="px-2 py-2 font-medium">{t('defects.table.columns.severity')}</th>
                <th className="py-2 pl-2 pr-3 text-center font-medium">{t('defects.table.columns.reviewed')}</th>
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {detections.map((d, i) => {
                const index = i + 1
                const selected = d.id === selectedId
                const high = isHighSeverity(d.severity)
                return (
                  <tr
                    key={d.id}
                    data-detection-id={d.id}
                    onClick={() => onSelect(d.id)}
                    className={`cursor-pointer border-t border-gray-100 ${
                      selected ? 'bg-blue-50' : high ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className={`border-l-4 py-2 pl-2 pr-2 ${high ? 'border-l-red-500' : 'border-l-transparent'}`}>
                      {/* Кнопка, чтобы выбирать и с клавиатуры */}
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={t('defects.table.showLabel', { index })}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(d.id)
                        }}
                        className={`rounded px-1 tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                          selected ? 'font-semibold text-blue-700' : 'text-gray-500 hover:text-gray-900'
                        }`}
                      >
                        {index}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: DEFECT_COLORS[d.defectClass] }} aria-hidden="true" />
                        <span className="font-medium text-gray-900">{t(`defects.classes.${d.defectClass}`)}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <code className="text-xs text-gray-500">{d.modelClass}</code>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatConfidence(d.confidence, lang)}</td>
                    <td className="px-2 py-2">
                      <select
                        value={d.severity}
                        disabled={readOnly}
                        aria-label={t('defects.table.severityLabel', { index })}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onSeverity(d.id, Number(e.target.value) as Severity)}
                        className={`rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70 ${
                          high ? 'border-red-300 bg-red-50 font-semibold text-red-800' : 'border-gray-300 bg-white text-gray-800'
                        }`}
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {t(`defects.severity.${s}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pl-2 pr-3 text-center">
                      <input
                        type="checkbox"
                        checked={d.reviewed}
                        disabled={readOnly}
                        aria-label={t('defects.table.reviewedLabel', { index })}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onReviewed(d.id, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 accent-blue-600 disabled:cursor-not-allowed"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-gray-500">{text}</p>
}
