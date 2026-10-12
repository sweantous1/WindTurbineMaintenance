import type { ModelManifest } from '@/domain/detection'
import type { RawDetection } from '@/domain/detectionPipeline'
import type { DetectBackend, DetectWorkerErrorCode, DetectWorkerRequest, DetectWorkerResponse } from '@/workers/detect.worker'

export type { RawDetection } from '@/domain/detectionPipeline'
export type { DetectBackend } from '@/workers/detect.worker'

// Файлов модели нет или вместо них заглушка
export class ModelMissingError extends Error {
  constructor(detail?: string) {
    super(detail ?? 'Модель детекции не установлена')
    this.name = 'ModelMissingError'
  }
}

// Отмена пользователем, как ошибку не показываем
export class DetectCancelledError extends Error {
  constructor() {
    super('Детекция отменена')
    this.name = 'DetectCancelledError'
  }
}

// code - для перевода в UI, message - техническая подробность
export type DetectFailureCode = 'loadFailed' | 'decodeFailed' | 'inferenceFailed' | 'workerFailed'

export class DetectFailedError extends Error {
  readonly code: DetectFailureCode
  constructor(code: DetectFailureCode, message: string) {
    super(message)
    this.name = 'DetectFailedError'
    this.code = code
  }
}

export interface DetectOptions {
  confidence: number
  iou: number
}

export interface DetectProgress {
  tile: number
  tiles: number
}

export interface DetectResult {
  detections: RawDetection[]
  tiles: number
  durationMs: number
  backend: DetectBackend
}

export interface DetectHandle {
  promise: Promise<DetectResult>
  cancel(): void
}

export interface DetectionEngine {
  load(): Promise<{ backend: DetectBackend; manifest: ModelManifest }>
  detect(image: Blob, opts: DetectOptions, onProgress?: (p: DetectProgress) => void): DetectHandle
  dispose(): void
}

// Часть Worker, нужная движку; в тестах подменяется заглушкой
export interface DetectWorkerPort {
  postMessage(message: DetectWorkerRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<DetectWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}

export interface DetectionEngineConfig {
  createWorker?: () => DetectWorkerPort
  modelUrls?: () => { modelUrl: string; manifestUrl: string }
  // Сколько ждать подтверждения отмены до terminate()
  cancelGraceMs?: number
}

// Фрагмент на wasm считается секунды, дольше - воркер завис
const CANCEL_GRACE_MS = 30_000

function createModuleWorker(): DetectWorkerPort {
  // Не inline: ORT ищет свой .wasm рядом с файлом воркера через import.meta.url
  return new Worker(new URL('../workers/detect.worker.ts', import.meta.url), { type: 'module' })
}

function defaultModelUrls() {
  // Относительно документа, чтобы работало и на dev-сервере, и под app://bundle в Electron
  const base = document.baseURI
  return {
    modelUrl: new URL('models/defects/model.onnx', base).href,
    manifestUrl: new URL('models/defects/manifest.json', base).href,
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function workerError(code: DetectWorkerErrorCode, message: string): Error {
  switch (code) {
    case 'modelMissing':
      return new ModelMissingError(message)
    case 'badRequest':
      return new DetectFailedError('workerFailed', message)
    default:
      return new DetectFailedError(code, message)
  }
}

function asEngineError(err: unknown): Error {
  if (err instanceof ModelMissingError || err instanceof DetectCancelledError || err instanceof DetectFailedError) return err
  return new DetectFailedError('workerFailed', errorText(err))
}

function validOptions(o: DetectOptions): boolean {
  return Number.isFinite(o.confidence) && o.confidence >= 0 && o.confidence < 1 && Number.isFinite(o.iou) && o.iou > 0 && o.iou <= 1
}

interface PendingRequest {
  onMessage(msg: DetectWorkerResponse): void
  // Воркер остановлен или упал, ответа уже не будет
  onStop(reason: Error): void
}

type LoadResult = Awaited<ReturnType<DetectionEngine['load']>>

class WorkerDetectionEngine implements DetectionEngine {
  private readonly createWorker: () => DetectWorkerPort
  private readonly modelUrls: () => { modelUrl: string; manifestUrl: string }
  private readonly cancelGraceMs: number
  private worker: DetectWorkerPort | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private loading: Promise<LoadResult> | null = null
  // Строго по очереди, воркер держит в памяти один кадр
  private tail: Promise<void> = Promise.resolve()
  // Отмена незавершённых запросов для dispose
  private readonly unsettled = new Set<() => void>()

  constructor(config: DetectionEngineConfig) {
    this.createWorker = config.createWorker ?? createModuleWorker
    this.modelUrls = config.modelUrls ?? defaultModelUrls
    this.cancelGraceMs = config.cancelGraceMs ?? CANCEL_GRACE_MS
  }

  private port(): DetectWorkerPort {
    if (this.worker) return this.worker
    let worker: DetectWorkerPort
    try {
      worker = this.createWorker()
    } catch (err) {
      throw new DetectFailedError('workerFailed', errorText(err))
    }
    worker.onmessage = (event) => {
      if (worker !== this.worker) return
      const msg = event.data
      this.pending.get(msg.id)?.onMessage(msg)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      if (worker !== this.worker) return
      this.stop(new DetectFailedError('workerFailed', event.message || 'Воркер детекции завершился с ошибкой'))
    }
    worker.onmessageerror = () => {
      if (worker !== this.worker) return
      this.stop(new DetectFailedError('workerFailed', 'Воркер детекции прислал нечитаемое сообщение'))
    }
    this.worker = worker
    return worker
  }

  // Ожидающие получают reason, следующий запрос поднимет новый воркер
  private stop(reason: Error): void {
    const waiting = [...this.pending.values()]
    this.pending.clear()
    this.worker?.terminate()
    this.worker = null
    this.loading = null
    for (const request of waiting) request.onStop(reason)
  }

  private send(message: DetectWorkerRequest, request: PendingRequest): void {
    const worker = this.port()
    this.pending.set(message.id, request)
    try {
      worker.postMessage(message)
    } catch (err) {
      this.pending.delete(message.id)
      throw err
    }
  }

  load(): Promise<LoadResult> {
    if (this.loading) return this.loading
    const attempt = new Promise<LoadResult>((resolve, reject) => {
      const id = this.nextId++
      try {
        const { modelUrl, manifestUrl } = this.modelUrls()
        this.send(
          { type: 'load', id, modelUrl, manifestUrl },
          {
            onMessage: (msg) => {
              if (msg.type === 'loaded') {
                this.pending.delete(id)
                resolve({ backend: msg.backend, manifest: msg.manifest })
              } else if (msg.type === 'failed') {
                this.pending.delete(id)
                const err = workerError(msg.code, msg.message)
                reject(err)
                // ORT запоминает неудачную инициализацию бэкенда до конца жизни потока,
                // поэтому повторяем в новом воркере
                this.stop(err)
              }
            },
            onStop: reject,
          },
        )
      } catch (err) {
        reject(asEngineError(err))
      }
    })
    this.loading = attempt
    // Неудачу не кешируем, чтобы после установки модели попробовать снова
    attempt.catch(() => {
      if (this.loading === attempt) this.loading = null
    })
    return attempt
  }

  detect(image: Blob, opts: DetectOptions, onProgress?: (p: DetectProgress) => void): DetectHandle {
    let settled = false
    let cancelRequested = false
    let activeId: number | null = null
    let armWatchdog: (() => void) | null = null
    let resolveJob: (result: DetectResult) => void = () => {}
    let rejectJob: (err: Error) => void = () => {}
    const promise = new Promise<DetectResult>((resolve, reject) => {
      resolveJob = resolve
      rejectJob = reject
    })

    const settle = (apply: () => void) => {
      if (settled) return
      settled = true
      this.unsettled.delete(cancel)
      apply()
    }
    const succeed = (result: DetectResult) => settle(() => resolveJob(result))
    const fail = (err: Error) => settle(() => rejectJob(err))

    const cancel = () => {
      if (settled) return
      cancelRequested = true
      fail(new DetectCancelledError())
      // Просим остановиться между фрагментами, не ответит - убьём по таймеру
      if (activeId !== null) {
        try {
          this.worker?.postMessage({ type: 'cancel', id: activeId })
        } catch {
          // Воркер недоступен, сработает сторож
        }
        armWatchdog?.()
      }
    }

    const run = async (): Promise<void> => {
      if (cancelRequested) return
      try {
        await this.load()
        // Воркер мог умереть уже после загрузки, новому нужна своя модель
        if (!this.loading) await this.load()
      } catch (err) {
        fail(asEngineError(err))
        return
      }
      if (cancelRequested) return
      // Следующий запрос ждёт, пока воркер закончит с этим, чем бы ни закончилось
      await new Promise<void>((release) => {
        const id = this.nextId++
        let watchdog: ReturnType<typeof setTimeout> | undefined
        const finish = () => {
          this.pending.delete(id)
          clearTimeout(watchdog)
          activeId = null
          armWatchdog = null
          release()
        }
        armWatchdog = () => {
          watchdog ??= setTimeout(() => this.stop(new DetectCancelledError()), this.cancelGraceMs)
        }
        const request: PendingRequest = {
          onMessage: (msg) => {
            switch (msg.type) {
              case 'progress':
                if (!settled) onProgress?.({ tile: msg.tile, tiles: msg.tiles })
                return
              case 'result':
                finish()
                succeed({ detections: msg.detections, tiles: msg.tiles, durationMs: msg.durationMs, backend: msg.backend })
                return
              case 'cancelled':
                finish()
                fail(new DetectCancelledError())
                return
              case 'failed':
                finish()
                fail(workerError(msg.code, msg.message))
                return
            }
          },
          onStop: (reason) => {
            finish()
            fail(reason)
          },
        }
        try {
          activeId = id
          this.send({ type: 'detect', id, image, options: { confidence: opts.confidence, iou: opts.iou } }, request)
        } catch (err) {
          finish()
          fail(asEngineError(err))
        }
      })
    }

    this.unsettled.add(cancel)
    if (!validOptions(opts)) {
      fail(new RangeError(`Некорректные параметры детекции: confidence ${opts.confidence}, iou ${opts.iou}`))
      return { promise, cancel }
    }
    const job = this.tail.then(run)
    this.tail = job.catch(() => undefined)
    return { promise, cancel }
  }

  dispose(): void {
    for (const cancel of [...this.unsettled]) cancel()
    this.stop(new DetectCancelledError())
  }
}

export function createDetectionEngine(config: DetectionEngineConfig = {}): DetectionEngine {
  return new WorkerDetectionEngine(config)
}

let shared: DetectionEngine | null = null

// Один воркер на приложение, модель (50 МБ) грузится один раз
export function getDetectionEngine(): DetectionEngine {
  shared ??= createDetectionEngine()
  return shared
}

// HMR: чтобы старый воркер с моделью не висел в памяти
import.meta.hot?.dispose(() => {
  shared?.dispose()
  shared = null
})
