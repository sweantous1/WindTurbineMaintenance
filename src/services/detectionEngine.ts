import type { ModelManifest } from '@/domain/detection'
import type { RawDetection } from '@/domain/detectionPipeline'
import type { DetectBackend, DetectWorkerErrorCode, DetectWorkerRequest, DetectWorkerResponse } from '@/workers/detect.worker'

export type { RawDetection } from '@/domain/detectionPipeline'
export type { DetectBackend } from '@/workers/detect.worker'

// Файлов модели нет (или вместо них заглушка) — интерфейс честно пишет «модель не установлена»
export class ModelMissingError extends Error {
  constructor(detail?: string) {
    super(detail ?? 'Модель детекции не установлена')
    this.name = 'ModelMissingError'
  }
}

// Отмена пользователем — не ошибка, показывать её не нужно
export class DetectCancelledError extends Error {
  constructor() {
    super('Детекция отменена')
    this.name = 'DetectCancelledError'
  }
}

// Остальные сбои. code — для переведённого сообщения в интерфейсе, message — техническая подробность
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

// Та часть Worker, которой пользуется движок; в тестах её подменяет объект без настоящего потока
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
  // Сколько ждать подтверждения отмены, прежде чем остановить воркер принудительно
  cancelGraceMs?: number
}

// Один фрагмент на wasm считается секунды; дольше этого воркер считаем зависшим
const CANCEL_GRACE_MS = 30_000

function createModuleWorker(): DetectWorkerPort {
  // Не inline: сборка ORT ищет свой .wasm рядом с файлом воркера через new URL(..., import.meta.url)
  return new Worker(new URL('../workers/detect.worker.ts', import.meta.url), { type: 'module' })
}

function defaultModelUrls() {
  // Относительно документа: одинаково работает на dev-сервере, в веб-сборке и под app://bundle в Electron
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
  // Запросы детекции идут строго по очереди: воркер один и держит в памяти один кадр
  private tail: Promise<void> = Promise.resolve()
  // Отмена всех незавершённых запросов — для dispose
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

  // Останавливает воркер; все, кто ждал от него ответа, получают reason.
  // Следующий запрос поднимет новый воркер и заново загрузит модель
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
                // Модели в этом воркере нет, терять нечего. ONNX Runtime запоминает неудачную инициализацию
                // бэкенда до конца жизни потока, поэтому повторная попытка идёт в новом воркере
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
    // Неудачу не запоминаем: после установки модели следующий вызов попробует снова
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
      // Воркер уже считает: просим остановиться между фрагментами, а если не ответит — останавливаем сами
      if (activeId !== null) {
        try {
          this.worker?.postMessage({ type: 'cancel', id: activeId })
        } catch {
          // Воркер уже недоступен — сработает сторож ниже
        }
        armWatchdog?.()
      }
    }

    const run = async (): Promise<void> => {
      if (cancelRequested) return
      try {
        await this.load()
        // Воркер мог остановиться уже после загрузки (упал или отменён сторожем) — новому нужна своя модель
        if (!this.loading) await this.load()
      } catch (err) {
        fail(asEngineError(err))
        return
      }
      if (cancelRequested) return
      // Следующий запрос ждёт, пока воркер закончит с этим: результатом, ошибкой, подтверждением отмены или остановкой
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

// Один воркер на приложение: модель (50 МБ) грузится один раз, запросы идут последовательно
export function getDetectionEngine(): DetectionEngine {
  shared ??= createDetectionEngine()
  return shared
}

// При горячей замене модуля в dev старый воркер с моделью иначе остался бы висеть в памяти
import.meta.hot?.dispose(() => {
  shared?.dispose()
  shared = null
})
