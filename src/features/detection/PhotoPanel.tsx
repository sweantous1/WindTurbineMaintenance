import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/components/common/Button'
import type { Detection, PhotoRecord } from '@/domain/detection'
import type { Farm } from '@/domain/types'
import { parseAnalysisError } from './analysisRunner'
import { durationParts, formatDecimal, formatMegabytes } from './format'
import PhotoViewer from './PhotoViewer'
import { sortedTurbines, type TurbineRef } from './turbineMatch'

interface PhotoPanelProps {
  photo: PhotoRecord
  farm: Farm | undefined
  turbine: TurbineRef
  detections: readonly Detection[]
  selectedDetectionId: string | null
  onSelectDetection: (id: string | null) => void
  labelText: (d: Detection) => string
  ariaLabel: (d: Detection) => string
  readOnly: boolean
  // Причина, по которой анализ сейчас недоступен (модели нет, идёт другой анализ); undefined — можно
  analyzeBlocked: string | undefined
  // Фото сейчас в очереди анализа
  inRun: boolean
  onAnalyze: () => void
  onTurbine: (turbineId: string | undefined) => void
  exportingPng: boolean
  onExportPng: () => void
  onExportJson: () => void
  onDelete: () => void
}

export default function PhotoPanel(props: PhotoPanelProps) {
  const { photo, farm, turbine, detections, selectedDetectionId, readOnly, analyzeBlocked, inRun } = props
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const [zoomed, setZoomed] = useState(false)
  const selectedVisible = !!selectedDetectionId && detections.some((d) => d.id === selectedDetectionId)
  const analyzed = !!photo.analysis
  const meta = [
    t('defects.viewer.size', { width: photo.width, height: photo.height, mb: formatMegabytes(photo.sizeBytes, lang) }),
    photo.takenAt ? t('defects.viewer.takenAt', { date: formatDateTime(photo.takenAt, lang) }) : null,
  ].filter(Boolean)

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm" aria-label={photo.fileName}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-gray-900" title={photo.fileName}>
            {photo.fileName}
          </h2>
          <p className="mt-0.5 truncate text-xs text-gray-500">{meta.join(' · ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <Button
              size="sm"
              variant={analyzed ? 'secondary' : 'primary'}
              onClick={props.onAnalyze}
              disabled={!!analyzeBlocked || inRun}
              title={analyzeBlocked}
            >
              {analyzed ? t('defects.actions.retry') : t('defects.actions.analyze')}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={props.onExportPng} isLoading={props.exportingPng} title={t('defects.actions.exportPngHint')}>
            {t('defects.actions.exportPng')}
          </Button>
          <Button size="sm" variant="secondary" onClick={props.onExportJson} title={t('defects.actions.exportHint')}>
            {t('defects.actions.exportJson')}
          </Button>
          {!readOnly && (
            <IconButton label={t('defects.actions.deletePhoto')} onClick={props.onDelete} disabled={inRun}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </IconButton>
          )}
        </div>
      </div>

      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TurbineField farm={farm} turbine={turbine} readOnly={readOnly} onChange={props.onTurbine} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoomed((z) => !z)}
            disabled={!selectedVisible && !zoomed}
            aria-pressed={zoomed}
            title={selectedVisible ? undefined : t('defects.viewer.zoomHint')}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={zoomed ? 'm21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM13.5 10.5h-6' : 'm21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6'}
              />
            </svg>
            {zoomed ? t('defects.viewer.zoomOut') : t('defects.viewer.zoomIn')}
          </Button>
        </div>

        <PhotoViewer
          photo={photo}
          detections={detections}
          selectedId={selectedDetectionId}
          onSelect={props.onSelectDetection}
          labelText={props.labelText}
          ariaLabel={props.ariaLabel}
          zoomed={zoomed}
        />

        <AnalysisLine photo={photo} />
      </div>
    </section>
  )
}

function AnalysisLine({ photo }: { photo: PhotoRecord }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const a = photo.analysis
  if (!a) return <p className="text-xs text-gray-500">{t('defects.viewer.notAnalyzed')}</p>
  if (a.status === 'failed') {
    const { code, detail } = parseAnalysisError(a.error)
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" title={detail || undefined}>
        {t('defects.viewer.failed', { reason: t(`defects.errors.${code}`) })}
      </p>
    )
  }
  const d = durationParts(a.durationMs)
  const seconds = formatDecimal(d.seconds, lang, 1)
  const duration = d.minutes > 0 ? t('defects.duration.minutes', { minutes: d.minutes, seconds }) : t('defects.duration.seconds', { seconds })
  return (
    <p className="text-xs text-gray-500" title={`${a.modelName} ${a.modelVersion}`}>
      {t('defects.viewer.analyzed', {
        date: formatDateTime(a.analyzedAt, lang),
        backend: a.backend ? t(`defects.engine.backend.${a.backend}`) : '—',
        tiles: a.tiles,
        duration,
      })}
    </p>
  )
}

function TurbineField({
  farm,
  turbine,
  readOnly,
  onChange,
}: {
  farm: Farm | undefined
  turbine: TurbineRef
  readOnly: boolean
  onChange: (turbineId: string | undefined) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const turbines = farm ? sortedTurbines(farm.turbines) : []
  const noFarm = turbines.length === 0
  const suggestion = turbine.kind === 'suggested' ? turbine.suggestion : undefined
  const value = turbine.kind === 'assigned' ? turbine.turbine.id : turbine.kind === 'missing' ? turbine.turbineId : ''

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {t('defects.turbine.label')}
      </label>
      <select
        id={id}
        value={value}
        disabled={readOnly || noFarm}
        title={noFarm ? t('defects.turbine.noFarm') : undefined}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="max-w-[14rem] rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
      >
        <option value="">{noFarm ? t('defects.turbine.noFarm') : t('defects.turbine.none')}</option>
        {turbine.kind === 'missing' && <option value={turbine.turbineId}>{t('defects.turbine.missing')}</option>}
        {turbines.map((tb) => (
          <option key={tb.id} value={tb.id}>
            {suggestion?.turbine.id === tb.id ? t('defects.turbine.option', { name: tb.name, distance: Math.round(suggestion.distanceM) }) : tb.name}
          </option>
        ))}
      </select>
      {suggestion && !readOnly && (
        <button
          type="button"
          onClick={() => onChange(suggestion.turbine.id)}
          title={t('defects.turbine.acceptHint', { distance: Math.round(suggestion.distanceM) })}
          className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {t('defects.turbine.accept', { name: suggestion.turbine.name })}
          <span className="rounded bg-blue-100 px-1 text-[10px] uppercase tracking-wide text-blue-800">{t('defects.turbine.byGps')}</span>
        </button>
      )}
    </div>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg className="h-[1.125rem] w-[1.125rem]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

function formatDateTime(iso: string, lang: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' })
}
