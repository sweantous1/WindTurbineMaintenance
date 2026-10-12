import { describe, expect, it, vi } from 'vitest'
import type { PhotoAnalysis } from '@/domain/detection'
import {
  DetectCancelledError,
  DetectFailedError,
  ModelMissingError,
  type DetectHandle,
  type DetectProgress,
  type DetectResult,
  type DetectionEngine,
} from '@/services/detectionEngine'
import type { NewDetection } from '@/storage/photos'
import {
  createAnalysisRunner,
  currentTile,
  formatAnalysisError,
  parseAnalysisError,
  runFraction,
  toNewDetections,
  type AnalysisRunnerDeps,
  type RunnerSnapshot,
} from '../analysisRunner'
import { MANIFEST } from './helpers'

vi.spyOn(console, 'warn').mockImplementation(() => {})

const blob = (name: string) => new Blob([name], { type: 'image/jpeg' })

const result = (over: Partial<DetectResult> = {}): DetectResult => ({
  detections: [{ modelClass: 'hide_craze', classIndex: 2, confidence: 0.42, x: 0.1, y: 0.2, w: 0.03, h: 0.04 }],
  tiles: 4,
  durationMs: 1234,
  backend: 'wasm',
  ...over,
})

type Step = { result: DetectResult } | { error: Error } | { manual: true }

// Движок без воркера: ответы по кадрам заданы заранее, manual ждёт отмены
function fakeEngine(steps: Record<string, Step>, load: () => Promise<{ backend: 'wasm' | 'webgpu'; manifest: typeof MANIFEST }> = async () => ({ backend: 'wasm', manifest: MANIFEST })) {
  const calls: { image: string; confidence: number; iou: number }[] = []
  const engine: Pick<DetectionEngine, 'load' | 'detect'> = {
    load,
    detect(image, opts, onProgress?: (p: DetectProgress) => void): DetectHandle {
      const name = (image as Blob & { name?: string }).name ?? ''
      calls.push({ image: name, confidence: opts.confidence, iou: opts.iou })
      const step = steps[name]
      let reject: (e: Error) => void = () => {}
      const promise = new Promise<DetectResult>((res, rej) => {
        reject = rej
        onProgress?.({ tile: 0, tiles: 4 })
        onProgress?.({ tile: 2, tiles: 4 })
        if ('result' in step) res(step.result)
        else if ('error' in step) rej(step.error)
      })
      return { promise, cancel: () => reject(new DetectCancelledError()) }
    },
  }
  return { engine, calls }
}

function makeDeps(engine: Pick<DetectionEngine, 'load' | 'detect'>, images: Record<string, Blob | undefined>) {
  const saved: { photoId: string; analysis: PhotoAnalysis; found: NewDetection[] }[] = []
  const deps: AnalysisRunnerDeps = {
    engine: () => engine,
    getImage: async (id) => {
      const b = images[id]
      if (b) Object.assign(b, { name: id })
      return b
    },
    saveAnalysis: async (photoId, analysis, found) => {
      if (photoId === 'deleted') throw new Error('Фото не найдено')
      saved.push({ photoId, analysis, found })
    },
    now: () => '2026-09-24T20:00:00.000Z',
  }
  return { deps, saved }
}

describe('очередь анализа', () => {
  it('сохраняет все находки от 0,1 с классом приложения, опасностью по классу и reviewed=false', async () => {
    const { engine, calls } = fakeEngine({ a: { result: result() } })
    const { deps, saved } = makeDeps(engine, { a: blob('a') })
    const outcome = await createAnalysisRunner(deps).start('m1', ['a'])
    expect(outcome).toEqual({ kind: 'finished', done: 1, failed: 0, skipped: 0 })
    expect(calls).toEqual([{ image: 'a', confidence: 0.1, iou: 0.7 }])
    expect(saved[0].analysis).toEqual({
      status: 'done',
      modelName: MANIFEST.name,
      modelVersion: MANIFEST.version,
      backend: 'wasm',
      analyzedAt: '2026-09-24T20:00:00.000Z',
      minConfidence: 0.1,
      iou: 0.7,
      tiles: 4,
      durationMs: 1234,
    })
    expect(saved[0].found).toEqual([
      { modelClass: 'hide_craze', defectClass: 'crack', confidence: 0.42, x: 0.1, y: 0.2, w: 0.03, h: 0.04, severity: 3, reviewed: false },
    ])
  })

  it('ошибка одного фото сохраняется как failed с кодом, остальные продолжаются', async () => {
    const { engine } = fakeEngine({
      a: { error: new DetectFailedError('decodeFailed', 'битый JPEG') },
      b: { result: result({ detections: [] }) },
    })
    const { deps, saved } = makeDeps(engine, { a: blob('a'), b: blob('b') })
    const outcome = await createAnalysisRunner(deps).start('m1', ['a', 'b'])
    expect(outcome).toEqual({ kind: 'finished', done: 1, failed: 1, skipped: 0 })
    expect(saved.map((s) => [s.photoId, s.analysis.status])).toEqual([
      ['a', 'failed'],
      ['b', 'done'],
    ])
    expect(saved[0].analysis.error).toBe('decodeFailed: битый JPEG')
    expect(saved[0].found).toEqual([])
    expect(parseAnalysisError(saved[0].analysis.error)).toEqual({ code: 'decodeFailed', detail: 'битый JPEG' })
  })

  it('нет изображения в базе — failed с кодом imageMissing; удалённое во время анализа фото пропускается', async () => {
    const { engine } = fakeEngine({ c: { result: result() }, deleted: { result: result() } })
    const { deps, saved } = makeDeps(engine, { a: undefined, c: blob('c'), deleted: blob('deleted') })
    const outcome = await createAnalysisRunner(deps).start('m1', ['a', 'deleted', 'c'])
    expect(outcome).toEqual({ kind: 'finished', done: 1, failed: 1, skipped: 1 })
    expect(saved.map((s) => s.photoId)).toEqual(['a', 'c'])
    expect(parseAnalysisError(saved[0].analysis.error).code).toBe('imageMissing')
  })

  it('модели нет — анализ не начинается, фото не помечаются ошибкой', async () => {
    const { engine, calls } = fakeEngine({}, () => Promise.reject(new ModelMissingError()))
    const { deps, saved } = makeDeps(engine, { a: blob('a') })
    expect(await createAnalysisRunner(deps).start('m1', ['a'])).toEqual({ kind: 'modelMissing' })
    expect(calls).toEqual([])
    expect(saved).toEqual([])
  })

  it('сбой загрузки модели — остановка с кодом, без отметок на фото', async () => {
    const { engine } = fakeEngine({}, () => Promise.reject(new DetectFailedError('loadFailed', 'нет wasm')))
    const { deps, saved } = makeDeps(engine, { a: blob('a') })
    expect(await createAnalysisRunner(deps).start('m1', ['a'])).toEqual({ kind: 'loadFailed', code: 'loadFailed' })
    expect(saved).toEqual([])
  })

  it('модель перестала грузиться посреди очереди — остальные фото не трогаются', async () => {
    const { engine } = fakeEngine({ a: { error: new DetectFailedError('loadFailed', 'x') }, b: { result: result() } })
    const { deps, saved } = makeDeps(engine, { a: blob('a'), b: blob('b') })
    expect(await createAnalysisRunner(deps).start('m1', ['a', 'b'])).toEqual({ kind: 'loadFailed', code: 'loadFailed' })
    expect(saved).toEqual([])
  })

  it('отмена останавливает текущий кадр и очередь; прогресс виден в снимке состояния', async () => {
    const { engine } = fakeEngine({ a: { result: result() }, b: { manual: true }, c: { result: result() } })
    const { deps, saved } = makeDeps(engine, { a: blob('a'), b: blob('b'), c: blob('c') })
    const runner = createAnalysisRunner(deps)
    const seen: RunnerSnapshot[] = []
    runner.subscribe(() => seen.push(runner.getSnapshot()))
    const started = runner.start('m1', ['a', 'b', 'c'])
    await vi.waitFor(() => expect(runner.getSnapshot().run).toMatchObject({ index: 1, tile: 2, tiles: 4, done: 1 }))
    expect(await runner.start('m1', ['c'])).toEqual({ kind: 'busy' })
    runner.cancel()
    expect(runner.getSnapshot().run?.cancelling).toBe(true)
    expect(await started).toEqual({ kind: 'cancelled', done: 1, failed: 0 })
    expect(saved.map((s) => s.photoId)).toEqual(['a'])
    expect(runner.getSnapshot()).toEqual({ run: null, lastBackend: 'wasm' })
    expect(seen.some((s) => s.run?.photoIds.length === 3)).toBe(true)
  })

  it('отмена во время загрузки модели не ждёт её конца', async () => {
    const { engine, calls } = fakeEngine({ a: { result: result() } }, () => new Promise(() => {}))
    const { deps, saved } = makeDeps(engine, { a: blob('a') })
    const runner = createAnalysisRunner(deps)
    const started = runner.start('m1', ['a'])
    expect(runner.getSnapshot().run).toMatchObject({ index: 0, tiles: 0 })
    runner.cancel()
    expect(await started).toEqual({ kind: 'cancelled', done: 0, failed: 0 })
    expect(calls).toEqual([])
    expect(saved).toEqual([])
    expect(runner.getSnapshot().run).toBeNull()
  })

  it('повторы в очереди убираются, пустая очередь завершается сразу', async () => {
    const { engine, calls } = fakeEngine({ a: { result: result() } })
    const { deps } = makeDeps(engine, { a: blob('a') })
    const runner = createAnalysisRunner(deps)
    expect(await runner.start('m1', [])).toEqual({ kind: 'finished', done: 0, failed: 0, skipped: 0 })
    await runner.start('m1', ['a', 'a'])
    expect(calls).toHaveLength(1)
  })

  it('backend последнего кадра запоминается: после перехода WebGPU → WASM', async () => {
    const { engine } = fakeEngine({ a: { result: result({ backend: 'webgpu' }) }, b: { result: result({ backend: 'wasm' }) } })
    const { deps } = makeDeps(engine, { a: blob('a'), b: blob('b') })
    const runner = createAnalysisRunner(deps)
    await runner.start('m1', ['a', 'b'])
    expect(runner.getSnapshot().lastBackend).toBe('wasm')
  })
})

describe('код ошибки в PhotoAnalysis.error', () => {
  it('код и подробность разбираются обратно', () => {
    expect(parseAnalysisError(formatAnalysisError('workerFailed', 'Воркер упал: out of memory'))).toEqual({
      code: 'workerFailed',
      detail: 'Воркер упал: out of memory',
    })
    expect(parseAnalysisError('imageMissing')).toEqual({ code: 'imageMissing', detail: '' })
  })

  it('чужой текст — неизвестная ошибка с текстом как подробностью', () => {
    expect(parseAnalysisError('Что-то пошло не так')).toEqual({ code: 'unknown', detail: 'Что-то пошло не так' })
    expect(parseAnalysisError('boom: x')).toEqual({ code: 'unknown', detail: 'boom: x' })
    expect(parseAnalysisError(undefined)).toEqual({ code: 'unknown', detail: '' })
  })

  it('незнакомый класс модели становится «other»', () => {
    expect(toNewDetections([{ modelClass: 'mystery', classIndex: 9, confidence: 0.5, x: 0, y: 0, w: 1, h: 1 }], MANIFEST)[0]).toMatchObject({
      defectClass: 'other',
      severity: 2,
    })
  })
})

describe('номер фрагмента в прогрессе', () => {
  it('воркер присылает число готовых фрагментов, показываем номер текущего', () => {
    expect(currentTile(0, 176)).toBe(1)
    expect(currentTile(41, 176)).toBe(42)
    expect(currentTile(176, 176)).toBe(176)
    expect(currentTile(0, 0)).toBe(0)
  })
})

describe('доля выполненного', () => {
  it('целые фото плюс доля фрагментов текущего', () => {
    expect(runFraction({ photoIds: ['a', 'b'], index: 1, tile: 2, tiles: 4 })).toBe(0.75)
    expect(runFraction({ photoIds: ['a', 'b'], index: 0, tile: 0, tiles: 0 })).toBe(0)
    expect(runFraction({ photoIds: [], index: 0, tile: 0, tiles: 0 })).toBe(0)
  })
})
