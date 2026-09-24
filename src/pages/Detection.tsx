import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Button from '@/components/common/Button'
import Card from '@/components/common/Card'
import RequireMission from '@/components/mission/RequireMission'
import type { AppDefectClass, Detection, DetectionPatch, PhotoRecord } from '@/domain/detection'
import type { Mission } from '@/domain/types'
import { useDetections, usePhotos } from '@/hooks/usePhotos'
import { PhotoIngestError, preparePhoto } from '@/services/photoIngest'
import { photos } from '@/storage/photos'
import { downloadText, localDateStamp } from '@/features/mission/missionView'
import FileDropArea from '@/features/route/FileDropArea'
import AnalysisProgress from '@/features/detection/AnalysisProgress'
import ConfirmDialog from '@/features/detection/ConfirmDialog'
import DetectionFilters from '@/features/detection/DetectionFilters'
import DetectionTable from '@/features/detection/DetectionTable'
import EngineStatusBar from '@/features/detection/EngineStatusBar'
import MissionSummary from '@/features/detection/MissionSummary'
import PhotoPanel from '@/features/detection/PhotoPanel'
import PhotoStrip, { type StripItem } from '@/features/detection/PhotoStrip'
import type { RunOutcome } from '@/features/detection/analysisRunner'
import { defectsExportJson, exportFileName, photoBaseName } from '@/features/detection/detectionExport'
import {
  FALLBACK_CONFIDENCE,
  classOptions,
  clampThreshold,
  countByClass,
  groupByPhoto,
  hasOperatorEdits,
  namesPreview,
  neighborAfterRemoval,
  pendingPhotoIds,
  photoStatus,
  sortPhotos,
  summarize,
  visibleDetections,
  type DetectionFilter,
} from '@/features/detection/detectionView'
import { formatConfidence } from '@/features/detection/format'
import { downloadBlob, renderDetectionsPng } from '@/features/detection/pngExport'
import { gpsAssignments, turbineRef } from '@/features/detection/turbineMatch'
import { analysisRunner, useAnalysisRunner, useCancelAnalysisOnLeave, useEngineStatus } from '@/features/detection/useAnalysis'

// Раньше здесь хранились фото в base64 — одно фото с дрона переполняло localStorage.
// Теперь фото и находки живут в IndexedDB; старый ключ освобождаем
try {
  localStorage.removeItem('wtm_detection_data')
} catch (error) {
  console.warn('Не удалось очистить старые данные детекции:', error)
}

type IngestCode = PhotoIngestError['code'] | 'saveFailed'
const INGEST_CODES: readonly IngestCode[] = ['notImage', 'tooLarge', 'decodeFailed', 'saveFailed']

type PendingAction = { kind: 'delete'; photo: PhotoRecord } | { kind: 'deleteAll' } | { kind: 'retry'; photo: PhotoRecord }

export default function Detection() {
  return <RequireMission>{(mission) => <DefectScreen key={mission.id} mission={mission} />}</RequireMission>
}

function DefectScreen({ mission }: { mission: Mission }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  // Фото можно добавлять и разбирать и после полёта; у архивной миссии — только просмотр
  const readOnly = mission.status === 'archived'
  const photoRows = usePhotos(mission.id)
  const detectionRows = useDetections(mission.id)
  const { status: engine, recheck, refresh } = useEngineStatus()
  const { run, lastBackend } = useAnalysisRunner()
  useCancelAnalysisOnLeave(mission.id)
  const manifest = engine.kind === 'ready' ? engine.manifest : undefined

  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null)
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null)
  // null — порог модели по умолчанию (manifest.defaults.confidence)
  const [threshold, setThreshold] = useState<number | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<AppDefectClass>>(() => new Set())
  const [ingest, setIngest] = useState<{ done: number; total: number } | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [exportingPng, setExportingPng] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // Флаг, а не только состояние: два броска файлов подряд успевают прийти до перерисовки
  const ingestBusy = useRef(false)

  const list = useMemo(() => sortPhotos(photoRows ?? []), [photoRows])
  const detections = useMemo(() => detectionRows ?? [], [detectionRows])
  const defaultThreshold = clampThreshold(manifest?.defaults.confidence ?? FALLBACK_CONFIDENCE)
  const minConfidence = threshold ?? defaultThreshold

  const filter = useMemo<DetectionFilter>(() => ({ minConfidence, hidden }), [minConfidence, hidden])
  const visible = useMemo(() => visibleDetections(detections, filter), [detections, filter])
  const visibleByPhoto = useMemo(() => groupByPhoto(visible), [visible])
  const allByPhoto = useMemo(() => groupByPhoto(detections), [detections])
  const summary = useMemo(() => summarize(list, visible), [list, visible])
  const options = useMemo(() => classOptions(manifest, detections), [manifest, detections])
  const classCounts = useMemo(() => countByClass(detections.filter((d) => d.confidence >= minConfidence)), [detections, minConfidence])
  const pendingIds = useMemo(() => pendingPhotoIds(list), [list])
  const gps = useMemo(() => (readOnly ? [] : gpsAssignments(list, mission.farm)), [readOnly, list, mission.farm])

  const selectedPhoto = list.find((p) => p.id === selectedPhotoId) ?? list[0]
  const selectedVisible = selectedPhoto ? (visibleByPhoto.get(selectedPhoto.id) ?? []) : []
  const selectedTotal = selectedPhoto ? (allByPhoto.get(selectedPhoto.id)?.length ?? 0) : 0

  const runHere = run?.missionId === mission.id ? run : null
  const analyzeBlocked = engine.kind === 'missing' ? t('defects.actions.modelMissingHint') : run ? t('defects.actions.busyHint') : undefined

  const stripItems = useMemo<StripItem[]>(
    () =>
      list.map((photo) => {
        let place: StripItem['run']
        const i = runHere ? runHere.photoIds.indexOf(photo.id) : -1
        if (runHere && i === runHere.index) place = { kind: 'running', tile: runHere.tile, tiles: runHere.tiles }
        else if (runHere && i > runHere.index) place = { kind: 'queued' }
        return { photo, status: photoStatus(photo, visibleByPhoto.get(photo.id) ?? []), run: place, turbine: turbineRef(photo, mission.farm) }
      }),
    [list, runHere, visibleByPhoto, mission.farm],
  )

  const classLabel = useCallback((d: Pick<Detection, 'defectClass'>) => t(`defects.classes.${d.defectClass}`), [t])
  const labelText = useCallback((d: Detection) => `${classLabel(d)} ${formatConfidence(d.confidence, lang)}`, [classLabel, lang])
  const ariaLabel = useCallback(
    (d: Detection) => t('defects.viewer.boxLabel', { cls: classLabel(d), confidence: formatConfidence(d.confidence, lang) }),
    [t, classLabel, lang],
  )

  const selectPhoto = (id: string | null) => {
    setSelectedPhotoId(id)
    setSelectedDetectionId(null)
  }

  // ---------- Добавление фото ----------

  const addFiles = async (files: FileList | File[]) => {
    const queue = Array.from(files)
    if (readOnly || queue.length === 0) return
    if (ingestBusy.current) {
      toast.info(t('defects.ingest.busy'))
      return
    }
    ingestBusy.current = true
    const failures = new Map<IngestCode, string[]>()
    let added = 0
    setIngest({ done: 0, total: queue.length })
    try {
      // По одному: декодирование снимка на 45 Мп занимает сотни мегабайт, параллельно память кончится
      for (const [i, file] of queue.entries()) {
        try {
          const prepared = await preparePhoto(file)
          await photos.add(mission.id, [prepared])
          added++
        } catch (error) {
          const code: IngestCode = error instanceof PhotoIngestError ? error.code : 'saveFailed'
          // Нечитаемый снимок — проблема файла, а не приложения; сбой записи в базу — наша ошибка
          if (code === 'saveFailed') console.error(`Не удалось сохранить фото ${file.name}:`, error)
          else if (code === 'decodeFailed') console.warn(`Не удалось прочитать фото ${file.name}:`, error)
          failures.set(code, [...(failures.get(code) ?? []), file.name])
        }
        setIngest({ done: i + 1, total: queue.length })
      }
    } finally {
      ingestBusy.current = false
      setIngest(null)
    }
    if (added > 0) toast.success(t('defects.ingest.added', { count: added }))
    for (const code of INGEST_CODES) {
      const names = failures.get(code)
      if (!names) continue
      const { shown, more } = namesPreview(names)
      toast.error(t(`defects.ingest.errors.${code}`, { names: more > 0 ? t('defects.ingest.more', { names: shown, count: more }) : shown }))
    }
  }

  const pickFiles = () => fileInput.current?.click()

  // ---------- Анализ ----------

  const reportOutcome = (outcome: RunOutcome) => {
    switch (outcome.kind) {
      case 'finished':
        if (outcome.failed > 0) toast.warn(t('defects.result.withFailures', { done: outcome.done, failed: outcome.failed }))
        else if (outcome.done > 0) toast.success(t('defects.result.finished', { done: outcome.done }))
        if (outcome.skipped > 0) toast.warn(t('defects.result.skipped', { count: outcome.skipped }))
        // Модель могла загрузиться только сейчас (раньше был сбой) — обновляем строку состояния
        refresh()
        return
      case 'cancelled':
        toast.info(t('defects.result.cancelled', { done: outcome.done }))
        return
      case 'modelMissing':
        toast.error(t('defects.result.modelMissing'))
        refresh()
        return
      case 'loadFailed':
        toast.error(t('defects.result.loadFailed', { reason: t(`defects.errors.${outcome.code}`) }))
        refresh()
        return
      case 'busy':
        toast.info(t('defects.actions.busyHint'))
        return
    }
  }

  const startAnalysis = async (ids: string[]) => {
    try {
      reportOutcome(await analysisRunner.start(mission.id, ids))
    } catch (error) {
      console.error('Анализ фото прервался:', error)
      toast.error(t('defects.result.crashed'))
    }
  }

  // Повторный анализ заменяет находки: если оператор их уже проверял, сначала спрашиваем
  const requestAnalyze = (photo: PhotoRecord) => {
    if (hasOperatorEdits(allByPhoto.get(photo.id) ?? [])) setPending({ kind: 'retry', photo })
    else void startAnalysis([photo.id])
  }

  // ---------- Правки ----------

  const reportSaveError = (error: unknown) => {
    console.error('Не удалось сохранить изменение:', error)
    toast.error(t('defects.errors.saveFailed'))
  }

  const setTurbine = (photoId: string, turbineId: string | undefined) => {
    photos.setTurbine(photoId, turbineId).catch(reportSaveError)
  }

  const assignByGps = async () => {
    let assigned = 0
    for (const a of gps) {
      try {
        await photos.setTurbine(a.photoId, a.turbineId)
        assigned++
      } catch (error) {
        reportSaveError(error)
        break
      }
    }
    if (assigned > 0) toast.success(t('defects.toast.gpsAssigned', { count: assigned }))
  }

  const updateDetection = (id: string, patch: DetectionPatch) => {
    photos.updateDetection(id, patch).catch(reportSaveError)
  }

  const confirmPending = async () => {
    if (!pending || confirmBusy) return
    if (pending.kind === 'retry') {
      const { photo } = pending
      setPending(null)
      void startAnalysis([photo.id])
      return
    }
    setConfirmBusy(true)
    try {
      if (pending.kind === 'delete') {
        const next = neighborAfterRemoval(
          list.map((p) => p.id),
          pending.photo.id,
        )
        await photos.remove(pending.photo.id)
        if (selectedPhoto?.id === pending.photo.id) selectPhoto(next)
        toast.success(t('defects.toast.deleted'))
      } else {
        await photos.removeAllOfMission(mission.id)
        selectPhoto(null)
        toast.success(t('defects.toast.deletedAll'))
      }
      setPending(null)
    } catch (error) {
      console.error('Не удалось удалить фото:', error)
      toast.error(t('defects.errors.deleteFailed'))
    } finally {
      setConfirmBusy(false)
    }
  }

  // ---------- Выгрузка ----------

  const exportJson = (scope: 'photo' | 'mission') => {
    const one = scope === 'photo' ? selectedPhoto : undefined
    if (scope === 'photo' && !one) return
    try {
      const json = defectsExportJson({ mission, photos: one ? [one] : list, detections, filter, exportedAt: new Date().toISOString() })
      const base = one ? `${photoBaseName(one.fileName)}-defects` : `defects-${mission.name}-${localDateStamp()}`
      downloadText(json, exportFileName(base, 'json'), 'application/json')
    } catch (error) {
      console.error('Не удалось выгрузить находки:', error)
      toast.error(t('defects.errors.exportFailed'))
    }
  }

  const exportPng = async () => {
    const photo = selectedPhoto
    if (!photo || exportingPng) return
    setExportingPng(true)
    try {
      const rec = await photos.getBlob(photo.id)
      if (!rec) throw new Error(`Нет изображения фото ${photo.id}`)
      const png = await renderDetectionsPng(rec.blob, { width: photo.width, height: photo.height }, selectedVisible, labelText)
      downloadBlob(png, exportFileName(`${photoBaseName(photo.fileName)}-defects`, 'png'))
    } catch (error) {
      console.error('Не удалось выгрузить PNG:', error)
      toast.error(t('defects.errors.exportFailed'))
    } finally {
      setExportingPng(false)
    }
  }

  // ---------- Разметка ----------

  const photoCount = list.length
  // Пока находки не прочитаны из базы, разобранное фото выглядело бы как «модель ничего не нашла»
  const loading = photoRows === undefined || detectionRows === undefined
  const subtitle =
    photoCount > 0
      ? [mission.name, t('defects.photos', { count: photoCount }), t('defects.findings', { count: summary.total })].join(' · ')
      : t('defects.subtitle')

  const confirmTexts = (() => {
    switch (pending?.kind) {
      case 'delete':
        return { title: t('defects.confirm.deleteTitle'), body: t('defects.confirm.deleteBody', { name: pending.photo.fileName }), label: t('defects.confirm.delete'), danger: true }
      case 'deleteAll':
        return { title: t('defects.confirm.deleteAllTitle'), body: t('defects.confirm.deleteAllBody', { name: mission.name }), label: t('defects.confirm.deleteAll'), danger: true }
      case 'retry':
        return { title: t('defects.confirm.retryTitle'), body: t('defects.confirm.retryBody', { name: pending.photo.fileName }), label: t('defects.confirm.retry'), danger: false }
      default:
        return { title: '', body: '', label: '', danger: false }
    }
  })()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{t('defects.title')}</h1>
          <p className="mt-1 truncate text-gray-500" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <>
              <Button variant="secondary" onClick={pickFiles} isLoading={!!ingest}>
                {ingest ? t('defects.actions.adding', { done: ingest.done, total: ingest.total }) : t('defects.actions.addPhotos')}
              </Button>
              <Button
                onClick={() => void startAnalysis(pendingIds)}
                disabled={!!analyzeBlocked || pendingIds.length === 0}
                title={analyzeBlocked ?? (pendingIds.length === 0 ? t('defects.actions.nothingToAnalyze') : t('defects.actions.analyzeAllHint'))}
              >
                {t('defects.actions.analyzeAll', { count: pendingIds.length })}
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={() => exportJson('mission')} disabled={photoCount === 0} title={t('defects.actions.exportHint')}>
            {t('defects.actions.exportMission')}
          </Button>
        </div>
      </div>

      <EngineStatusBar status={engine} lastBackend={lastBackend} onRecheck={recheck} />

      {readOnly && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{t('defects.archived')}</div>}

      {run && <AnalysisProgress run={run} otherMission={!runHere} onCancel={() => analysisRunner.cancel()} />}

      <FileDropArea enabled={!readOnly} onFiles={(f) => void addFiles(f)} overlayText={t('defects.drop.overlay')}>
        <Card
          title={t('defects.strip.title')}
          subtitle={photoCount > 0 ? t('defects.strip.stats', { analyzed: summary.photos.analyzed, total: photoCount }) : undefined}
          actions={
            !readOnly && (gps.length > 0 || photoCount > 0) ? (
              <>
                {gps.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => void assignByGps()} title={t('defects.actions.gpsAssignHint')}>
                    {t('defects.actions.gpsAssign', { count: gps.length })}
                  </Button>
                )}
                {photoCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setPending({ kind: 'deleteAll' })}
                    disabled={!!runHere}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('defects.actions.deleteAll')}
                  </button>
                )}
              </>
            ) : undefined
          }
        >
          {loading ? (
            <p className="py-8 text-center text-sm text-gray-400">{t('common.loading')}</p>
          ) : photoCount === 0 ? (
            readOnly ? (
              <p className="py-8 text-center text-sm text-gray-500">{t('defects.drop.readOnlyEmpty')}</p>
            ) : (
              <EmptyDrop onPick={pickFiles} busy={!!ingest} />
            )
          ) : (
            <PhotoStrip items={stripItems} selectedId={selectedPhoto?.id} onSelect={selectPhoto} />
          )}
        </Card>
      </FileDropArea>

      {!loading && selectedPhoto && (
        <div className="grid grid-cols-1 items-start gap-5 min-[960px]:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-5">
            <PhotoPanel
              key={selectedPhoto.id}
              photo={selectedPhoto}
              farm={mission.farm}
              turbine={turbineRef(selectedPhoto, mission.farm)}
              detections={selectedVisible}
              selectedDetectionId={selectedDetectionId}
              onSelectDetection={setSelectedDetectionId}
              labelText={labelText}
              ariaLabel={ariaLabel}
              readOnly={readOnly}
              analyzeBlocked={analyzeBlocked}
              inRun={!!runHere?.photoIds.slice(runHere.index).includes(selectedPhoto.id)}
              onAnalyze={() => requestAnalyze(selectedPhoto)}
              onTurbine={(turbineId) => setTurbine(selectedPhoto.id, turbineId)}
              exportingPng={exportingPng}
              onExportPng={() => void exportPng()}
              onExportJson={() => exportJson('photo')}
              onDelete={() => setPending({ kind: 'delete', photo: selectedPhoto })}
            />
            <Card title={t('defects.table.title')}>
              <DetectionTable
                analysis={selectedPhoto.analysis}
                detections={selectedVisible}
                total={selectedTotal}
                selectedId={selectedDetectionId}
                onSelect={setSelectedDetectionId}
                readOnly={readOnly}
                onSeverity={(id, severity) => updateDetection(id, { severity })}
                onReviewed={(id, reviewed) => updateDetection(id, { reviewed })}
              />
            </Card>
          </div>
          <div className="space-y-5">
            <DetectionFilters
              threshold={minConfidence}
              defaultThreshold={defaultThreshold}
              onThreshold={setThreshold}
              options={options}
              hidden={hidden}
              onToggleClass={(cls, show) =>
                setHidden((prev) => {
                  const next = new Set(prev)
                  if (show) next.delete(cls)
                  else next.add(cls)
                  return next
                })
              }
              counts={classCounts}
            />
            <MissionSummary summary={summary} threshold={minConfidence} />
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : []
          e.target.value = ''
          void addFiles(files)
        }}
      />

      <ConfirmDialog
        isOpen={pending !== null}
        title={confirmTexts.title}
        body={confirmTexts.body}
        confirmLabel={confirmTexts.label}
        danger={confirmTexts.danger}
        busy={confirmBusy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}

function EmptyDrop({ onPick, busy }: { onPick: () => void; busy: boolean }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-6 py-10 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait"
    >
      <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
        />
      </svg>
      <span className="font-medium text-gray-800">{t('defects.drop.title')}</span>
      <span className="text-sm text-gray-500">{t('defects.drop.hint')}</span>
    </button>
  )
}
