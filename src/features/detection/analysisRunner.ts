import { defaultSeverity, toAppClass, type ModelManifest, type PhotoAnalysis } from '@/domain/detection'
import {
  DetectCancelledError,
  DetectFailedError,
  ModelMissingError,
  type DetectBackend,
  type DetectionEngine,
  type DetectResult,
} from '@/services/detectionEngine'
import type { NewDetection } from '@/storage/photos'
import { STORED_MIN_CONFIDENCE } from './detectionView'

// Очередь анализа фото — одна на приложение, как и движок. Экран останавливает её, когда его покидают

export type AnalysisErrorCode = 'loadFailed' | 'decodeFailed' | 'inferenceFailed' | 'workerFailed' | 'imageMissing' | 'unknown'

export const ANALYSIS_ERROR_CODES: readonly AnalysisErrorCode[] = [
  'loadFailed',
  'decodeFailed',
  'inferenceFailed',
  'workerFailed',
  'imageMissing',
  'unknown',
]

export function errorCode(err: unknown): AnalysisErrorCode {
  return err instanceof DetectFailedError ? err.code : 'unknown'
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// В PhotoAnalysis.error одна строка, поэтому код идёт первым: «decodeFailed: подробность».
// Интерфейс переводит по коду, а подробность показывает как техническую
export function formatAnalysisError(code: AnalysisErrorCode, detail: string): string {
  return detail ? `${code}: ${detail}` : code
}

export function parseAnalysisError(text: string | undefined): { code: AnalysisErrorCode; detail: string } {
  if (!text) return { code: 'unknown', detail: '' }
  const m = /^([A-Za-z]+)(?::\s*([\s\S]*))?$/.exec(text)
  const code = m && (ANALYSIS_ERROR_CODES as readonly string[]).includes(m[1]) ? (m[1] as AnalysisErrorCode) : undefined
  return code ? { code, detail: m?.[2] ?? '' } : { code: 'unknown', detail: text }
}

export function toNewDetections(found: DetectResult['detections'], manifest: Pick<ModelManifest, 'classMap'>): NewDetection[] {
  return found.map((d) => {
    const defectClass = toAppClass(manifest, d.modelClass)
    return {
      modelClass: d.modelClass,
      defectClass,
      confidence: d.confidence,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      severity: defaultSeverity(defectClass),
      reviewed: false,
    }
  })
}

export function doneAnalysis(manifest: Pick<ModelManifest, 'name' | 'version'>, result: Omit<DetectResult, 'detections'>, iou: number, analyzedAt: string): PhotoAnalysis {
  return {
    status: 'done',
    modelName: manifest.name,
    modelVersion: manifest.version,
    backend: result.backend,
    analyzedAt,
    minConfidence: STORED_MIN_CONFIDENCE,
    iou,
    tiles: result.tiles,
    durationMs: result.durationMs,
  }
}

export function failedAnalysis(manifest: Pick<ModelManifest, 'name' | 'version'>, code: AnalysisErrorCode, detail: string, iou: number, analyzedAt: string): PhotoAnalysis {
  return {
    status: 'failed',
    modelName: manifest.name,
    modelVersion: manifest.version,
    analyzedAt,
    minConfidence: STORED_MIN_CONFIDENCE,
    iou,
    tiles: 0,
    durationMs: 0,
    error: formatAnalysisError(code, detail),
  }
}

export interface RunProgress {
  missionId: string
  photoIds: readonly string[]
  // Номер текущего фото в очереди, с нуля
  index: number
  // Фрагменты текущего фото; 0 из 0 — модель ещё грузится или кадр декодируется
  tile: number
  tiles: number
  done: number
  failed: number
  cancelling: boolean
}

// Воркер сообщает, сколько фрагментов готово; человеку понятнее номер фрагмента, который считается сейчас
export function currentTile(tile: number, tiles: number): number {
  return tiles > 0 ? Math.min(tiles, Math.max(1, tile + 1)) : 0
}

// Доля выполненного: целые фото плюс доля фрагментов текущего
export function runFraction(run: Pick<RunProgress, 'photoIds' | 'index' | 'tile' | 'tiles'>): number {
  const total = run.photoIds.length
  if (total === 0) return 0
  const current = run.tiles > 0 ? Math.min(1, run.tile / run.tiles) : 0
  return Math.min(1, (run.index + current) / total)
}

export interface RunnerSnapshot {
  run: RunProgress | null
  // Где реально считался последний кадр: после сбоя WebGPU движок переходит на процессор
  lastBackend: DetectBackend | null
}

export type RunOutcome =
  | { kind: 'finished'; done: number; failed: number; skipped: number }
  | { kind: 'cancelled'; done: number; failed: number }
  | { kind: 'modelMissing' }
  | { kind: 'loadFailed'; code: AnalysisErrorCode }
  // Уже идёт другой анализ: движок один, запросы всё равно шли бы по очереди
  | { kind: 'busy' }

export interface AnalysisRunnerDeps {
  engine: () => Pick<DetectionEngine, 'load' | 'detect'>
  getImage: (photoId: string) => Promise<Blob | undefined>
  saveAnalysis: (photoId: string, analysis: PhotoAnalysis, found: NewDetection[]) => Promise<void>
  now: () => string
}

export interface AnalysisRunner {
  start(missionId: string, photoIds: readonly string[]): Promise<RunOutcome>
  cancel(): void
  getSnapshot(): RunnerSnapshot
  subscribe(listener: () => void): () => void
}

export function createAnalysisRunner(deps: AnalysisRunnerDeps): AnalysisRunner {
  let snapshot: RunnerSnapshot = { run: null, lastBackend: null }
  const listeners = new Set<() => void>()
  let cancelled = false
  let cancelCurrent: (() => void) | null = null
  // Загрузку модели в движке не прервать, но ждать её конца после отмены незачем
  let stopWaiting: (() => void) | null = null

  const publish = (next: RunnerSnapshot) => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const patchRun = (patch: Partial<RunProgress>) => {
    if (snapshot.run) publish({ ...snapshot, run: { ...snapshot.run, ...patch } })
  }

  // false — фото удалили во время анализа (или база не приняла запись): считать нечего
  async function trySave(photoId: string, analysis: PhotoAnalysis, found: NewDetection[]): Promise<boolean> {
    try {
      await deps.saveAnalysis(photoId, analysis, found)
      return true
    } catch (error) {
      console.warn(`Не удалось сохранить анализ фото ${photoId}:`, error)
      return false
    }
  }

  async function loop(photoIds: readonly string[]): Promise<RunOutcome> {
    const engine = deps.engine()
    let manifest: ModelManifest
    try {
      const stop = new Promise<null>((resolve) => {
        stopWaiting = () => resolve(null)
      })
      const loaded = await Promise.race([engine.load(), stop])
      if (!loaded || cancelled) return { kind: 'cancelled', done: 0, failed: 0 }
      manifest = loaded.manifest
    } catch (error) {
      if (cancelled || error instanceof DetectCancelledError) return { kind: 'cancelled', done: 0, failed: 0 }
      if (error instanceof ModelMissingError) return { kind: 'modelMissing' }
      return { kind: 'loadFailed', code: errorCode(error) }
    } finally {
      stopWaiting = null
    }
    const iou = manifest.defaults.iou
    let done = 0
    let failed = 0
    let skipped = 0

    for (let i = 0; i < photoIds.length; i++) {
      if (cancelled) return { kind: 'cancelled', done, failed }
      const photoId = photoIds[i]
      patchRun({ index: i, tile: 0, tiles: 0 })

      let image: Blob | undefined
      try {
        image = await deps.getImage(photoId)
      } catch (error) {
        console.warn(`Не удалось прочитать фото ${photoId}:`, error)
      }
      if (!image) {
        if (await trySave(photoId, failedAnalysis(manifest, 'imageMissing', '', iou, deps.now()), [])) failed++
        else skipped++
        patchRun({ done, failed })
        continue
      }
      if (cancelled) return { kind: 'cancelled', done, failed }

      const handle = engine.detect(image, { confidence: STORED_MIN_CONFIDENCE, iou }, (p) => patchRun({ tile: p.tile, tiles: p.tiles }))
      cancelCurrent = handle.cancel
      let result: DetectResult
      try {
        result = await handle.promise
      } catch (error) {
        if (error instanceof DetectCancelledError) return { kind: 'cancelled', done, failed }
        if (error instanceof ModelMissingError) return { kind: 'modelMissing' }
        const code = errorCode(error)
        // Модель перестала грузиться (воркер перезапустился) — дальше упадёт каждое фото, останавливаемся
        if (code === 'loadFailed') return { kind: 'loadFailed', code }
        console.warn(`Анализ фото ${photoId} не удался:`, error)
        if (await trySave(photoId, failedAnalysis(manifest, code, errorText(error), iou, deps.now()), [])) failed++
        else skipped++
        patchRun({ done, failed })
        continue
      } finally {
        cancelCurrent = null
      }

      if (result.backend !== snapshot.lastBackend) publish({ ...snapshot, lastBackend: result.backend })
      if (await trySave(photoId, doneAnalysis(manifest, result, iou, deps.now()), toNewDetections(result.detections, manifest))) done++
      else skipped++
      patchRun({ done, failed })
    }
    return { kind: 'finished', done, failed, skipped }
  }

  return {
    async start(missionId, photoIds) {
      if (snapshot.run) return { kind: 'busy' }
      const ids = [...new Set(photoIds)]
      if (ids.length === 0) return { kind: 'finished', done: 0, failed: 0, skipped: 0 }
      cancelled = false
      publish({ ...snapshot, run: { missionId, photoIds: ids, index: 0, tile: 0, tiles: 0, done: 0, failed: 0, cancelling: false } })
      try {
        return await loop(ids)
      } finally {
        cancelCurrent = null
        stopWaiting = null
        publish({ ...snapshot, run: null })
      }
    },

    cancel() {
      if (!snapshot.run || cancelled) return
      cancelled = true
      patchRun({ cancelling: true })
      stopWaiting?.()
      cancelCurrent?.()
    },

    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
