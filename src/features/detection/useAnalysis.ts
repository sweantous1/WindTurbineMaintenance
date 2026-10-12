import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ModelManifest } from '@/domain/detection'
import { DetectCancelledError, ModelMissingError, getDetectionEngine, type DetectBackend } from '@/services/detectionEngine'
import { photos } from '@/storage/photos'
import { createAnalysisRunner, errorCode, type AnalysisErrorCode, type RunnerSnapshot } from './analysisRunner'

// Одна очередь на приложение, как и движок; при уходе с экрана её гасит useCancelAnalysisOnLeave
export const analysisRunner = createAnalysisRunner({
  engine: getDetectionEngine,
  getImage: async (photoId) => (await photos.getBlob(photoId))?.blob,
  saveAnalysis: (photoId, analysis, found) => photos.saveAnalysis(photoId, analysis, found),
  now: () => new Date().toISOString(),
})

// HMR: чтобы старая очередь не продолжала писать в базу
import.meta.hot?.dispose(() => analysisRunner.cancel())

export function useAnalysisRunner(): RunnerSnapshot {
  return useSyncExternalStore(analysisRunner.subscribe, analysisRunner.getSnapshot)
}

// Анализ идёт, только пока открыт экран миссии, чтобы не писать в базу втихую (в т.ч. в архивную)
export function useCancelAnalysisOnLeave(missionId: string): void {
  useEffect(
    () => () => {
      if (analysisRunner.getSnapshot().run?.missionId === missionId) analysisRunner.cancel()
    },
    [missionId],
  )
}

export type EngineStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; backend: DetectBackend; manifest: ModelManifest }
  | { kind: 'missing' }
  | { kind: 'failed'; code: AnalysisErrorCode }

export function engineStatusFromError(error: unknown): EngineStatus {
  if (error instanceof ModelMissingError) return { kind: 'missing' }
  // Загрузку оборвал HMR - это сбой воркера, а не модели
  if (error instanceof DetectCancelledError) return { kind: 'failed', code: 'workerFailed' }
  return { kind: 'failed', code: errorCode(error) }
}

// Помним последнее состояние, чтобы при возврате на экран не мигала загрузка
let lastStatus: EngineStatus = { kind: 'loading' }

// Грузим модель при открытии экрана; движок её держит, повторный load() отвечает сразу.
// recheck - по кнопке, с индикатором; refresh - тихо, после анализа
export function useEngineStatus(): { status: EngineStatus; recheck: () => void; refresh: () => void } {
  const [status, setStatus] = useState<EngineStatus>(lastStatus)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    getDetectionEngine()
      .load()
      .then(
        ({ backend, manifest }): EngineStatus => ({ kind: 'ready', backend, manifest }),
        (error: unknown) => {
          if (!(error instanceof ModelMissingError)) console.warn('Модель детекции не загрузилась:', error)
          return engineStatusFromError(error)
        },
      )
      .then((next) => {
        lastStatus = next
        if (alive) setStatus(next)
      })
    return () => {
      alive = false
    }
  }, [attempt])

  const recheck = useCallback(() => {
    lastStatus = { kind: 'loading' }
    setStatus(lastStatus)
    setAttempt((n) => n + 1)
  }, [])

  const refresh = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, recheck, refresh }
}
