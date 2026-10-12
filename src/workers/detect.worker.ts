import * as ort from 'onnxruntime-web/webgpu'
import type { ModelManifest } from '@/domain/detection'
import {
  LETTERBOX_FILL_BYTE,
  letterbox,
  mergeTileDetections,
  parseManifest,
  planTiles,
  processTileOutput,
  rgbaToChw,
  tilingForModel,
  type FrameCandidate,
  type Letterbox,
  type RawDetection,
  type TileRect,
} from '@/domain/detectionPipeline'

// Без COOP/COEP нет SharedArrayBuffer, поэтому wasm однопоточный; proxy не нужен, мы и так в воркере
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false

export type DetectBackend = 'webgpu' | 'wasm'

export interface DetectWorkerOptions {
  confidence: number
  iou: number
}

export type DetectWorkerErrorCode = 'modelMissing' | 'loadFailed' | 'decodeFailed' | 'inferenceFailed' | 'badRequest'

export type DetectWorkerRequest =
  | { type: 'load'; id: number; modelUrl: string; manifestUrl: string }
  | { type: 'detect'; id: number; image: Blob; options: DetectWorkerOptions }
  | { type: 'cancel'; id: number }

export type DetectWorkerResponse =
  | { type: 'loaded'; id: number; backend: DetectBackend; manifest: ModelManifest }
  | { type: 'progress'; id: number; tile: number; tiles: number }
  | { type: 'result'; id: number; detections: RawDetection[]; tiles: number; durationMs: number; backend: DetectBackend }
  | { type: 'cancelled'; id: number }
  | { type: 'failed'; id: number; code: DetectWorkerErrorCode; message: string }

// Прогон модели по одному входу [1, 3, imgsz, imgsz]
export interface InferenceRunner {
  readonly backend: DetectBackend
  run(input: Float32Array): Promise<{ data: ArrayLike<number>; dims: readonly number[] }>
}

// Декодированный кадр, из которого по одному вырезаются фрагменты
export interface TileSource {
  readonly width: number
  readonly height: number
  // Фрагмент, вписанный во вход по lb, как CHW float32 RGB 0..1
  readTile(tile: TileRect, lb: Letterbox): Float32Array
  close(): void
}

// Всё браузерное и ORT снаружи, чтобы тестировать обработчик без них
export interface DetectWorkerDeps {
  fetch(url: string): Promise<Response>
  createRunner(model: Uint8Array, manifest: ModelManifest): Promise<InferenceRunner>
  openImage(image: Blob, imgsz: number): Promise<TileSource>
  now(): number
}

export class DetectWorkerFailure extends Error {
  readonly code: DetectWorkerErrorCode
  constructor(code: DetectWorkerErrorCode, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'DetectWorkerFailure'
    this.code = code
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const isHttpUrl = (url: string) => /^https?:/i.test(url)

async function fetchModelFile(deps: DetectWorkerDeps, url: string): Promise<Response> {
  let res: Response
  try {
    res = await deps.fetch(url)
  } catch (err) {
    // Под app:// в Electron отсутствующий файл даёт сетевую ошибку, а не 404
    if (!isHttpUrl(url)) throw new DetectWorkerFailure('modelMissing', `Файл модели не найден: ${url}`, err)
    throw new DetectWorkerFailure('loadFailed', `Не удалось загрузить ${url}: ${errorText(err)}`, err)
  }
  if (res.status === 404) throw new DetectWorkerFailure('modelMissing', `Файл модели не найден: ${url}`)
  if (!res.ok) throw new DetectWorkerFailure('loadFailed', `Не удалось загрузить ${url}: HTTP ${res.status}`)
  // Dev-сервер Vite на отсутствующий файл отвечает страницей приложения со статусом 200
  if (res.headers.get('content-type')?.includes('text/html')) {
    throw new DetectWorkerFailure('modelMissing', `Файл модели не найден: ${url}`)
  }
  return res
}

async function fetchManifest(deps: DetectWorkerDeps, url: string): Promise<ModelManifest> {
  const res = await fetchModelFile(deps, url)
  let raw: unknown
  try {
    raw = await res.json()
  } catch (err) {
    throw new DetectWorkerFailure('loadFailed', 'manifest.json не читается как JSON', err)
  }
  try {
    return parseManifest(raw)
  } catch (err) {
    throw new DetectWorkerFailure('loadFailed', errorText(err), err)
  }
}

const LFS_POINTER = 'version https://git-lfs'

async function fetchModel(deps: DetectWorkerDeps, url: string): Promise<Uint8Array> {
  const res = await fetchModelFile(deps, url)
  const bytes = new Uint8Array(await res.arrayBuffer())
  // Пустой файл или указатель Git LFS вместо весов
  const head = new TextDecoder().decode(bytes.subarray(0, LFS_POINTER.length))
  if (bytes.byteLength === 0 || head === LFS_POINTER) {
    throw new DetectWorkerFailure('modelMissing', `Вместо модели лежит пустой файл или указатель Git LFS: ${url}`)
  }
  return bytes
}

function validOptions(o: DetectWorkerOptions | undefined): o is DetectWorkerOptions {
  return !!o && Number.isFinite(o.confidence) && o.confidence >= 0 && o.confidence < 1 && Number.isFinite(o.iou) && o.iou > 0 && o.iou <= 1
}

export function createDetectWorkerHandler(deps: DetectWorkerDeps, post: (msg: DetectWorkerResponse) => void): (data: unknown) => void {
  let model: { runner: InferenceRunner; manifest: ModelManifest } | null = null
  // Строго по одному: модель одна, память под кадр тоже
  let chain: Promise<void> = Promise.resolve()
  const queued = new Set<number>()
  const cancelled = new Set<number>()

  // Задачи ловят ошибки сами, catch - чтобы очередь не встала, если упадёт сам post
  const enqueue = (task: () => Promise<void>) => {
    chain = chain.then(task).catch((err: unknown) => console.error('Воркер детекции:', err))
  }

  const fail = (id: number, err: unknown, fallback: DetectWorkerErrorCode) => {
    const code = err instanceof DetectWorkerFailure ? err.code : fallback
    post({ type: 'failed', id, code, message: errorText(err) })
  }

  async function load(req: Extract<DetectWorkerRequest, { type: 'load' }>): Promise<void> {
    try {
      if (!model) {
        const manifest = await fetchManifest(deps, req.manifestUrl)
        const bytes = await fetchModel(deps, req.modelUrl)
        model = { runner: await deps.createRunner(bytes, manifest), manifest }
      }
      post({ type: 'loaded', id: req.id, backend: model.runner.backend, manifest: model.manifest })
    } catch (err) {
      fail(req.id, err, 'loadFailed')
    }
  }

  async function detect(req: Extract<DetectWorkerRequest, { type: 'detect' }>): Promise<void> {
    const { id, options } = req
    try {
      if (cancelled.has(id)) {
        post({ type: 'cancelled', id })
        return
      }
      if (!model) throw new DetectWorkerFailure('loadFailed', 'Модель не загружена')
      const { runner, manifest } = model
      const started = deps.now()

      let source: TileSource
      try {
        source = await deps.openImage(req.image, manifest.imgsz)
      } catch (err) {
        throw new DetectWorkerFailure('decodeFailed', `Не удалось декодировать изображение: ${errorText(err)}`, err)
      }

      try {
        const frame = { width: source.width, height: source.height }
        const tiles = planTiles(frame.width, frame.height, tilingForModel(manifest.imgsz))
        post({ type: 'progress', id, tile: 0, tiles: tiles.length })
        const found: FrameCandidate[] = []
        for (let i = 0; i < tiles.length; i++) {
          // Отмену проверяем между фрагментами, начатый прогон не прервать
          if (cancelled.has(id)) {
            post({ type: 'cancelled', id })
            return
          }
          const tile = tiles[i]
          try {
            const lb = letterbox(tile.w, tile.h, manifest.imgsz)
            const out = await runner.run(source.readTile(tile, lb))
            const boxes = processTileOutput(out.data, out.dims, tile, lb, {
              confidence: options.confidence,
              iou: options.iou,
              frame,
              numClasses: manifest.classes.length,
            })
            for (const b of boxes) found.push(b)
          } catch (err) {
            throw new DetectWorkerFailure('inferenceFailed', `Фрагмент ${i + 1} из ${tiles.length}: ${errorText(err)}`, err)
          }
          post({ type: 'progress', id, tile: i + 1, tiles: tiles.length })
        }
        if (cancelled.has(id)) {
          post({ type: 'cancelled', id })
          return
        }
        const detections = mergeTileDetections(found, frame, manifest.classes, options.iou)
        post({ type: 'result', id, detections, tiles: tiles.length, durationMs: deps.now() - started, backend: runner.backend })
      } finally {
        source.close()
      }
    } catch (err) {
      fail(id, err, 'inferenceFailed')
    } finally {
      queued.delete(id)
      cancelled.delete(id)
    }
  }

  return (data: unknown) => {
    const req = data as DetectWorkerRequest | null
    const id = typeof req?.id === 'number' ? req.id : -1
    switch (req?.type) {
      case 'cancel':
        if (queued.has(id)) cancelled.add(id)
        return
      case 'load':
        if (typeof req.modelUrl === 'string' && typeof req.manifestUrl === 'string') {
          enqueue(() => load(req))
          return
        }
        break
      case 'detect':
        if (req.image instanceof Blob && validOptions(req.options)) {
          queued.add(id)
          enqueue(() => detect(req))
          return
        }
        break
    }
    post({ type: 'failed', id, code: 'badRequest', message: 'Воркер детекции получил некорректное сообщение' })
  }
}

// ---------- ONNX Runtime ----------

const WASM_ONLY: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] }

async function hasWebGpuAdapter(): Promise<boolean> {
  const gpu = (globalThis.navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) != null
  } catch {
    return false
  }
}

// ORT молча выкидывает недоступный webgpu из провайдеров; env.webgpu.device (1.30)
// появляется, только если сессия реально создана на WebGPU
function webGpuDeviceCreated(): boolean {
  return Reflect.get(ort.env.webgpu, 'device') != null
}

export async function createOrtSession(model: Uint8Array): Promise<{ session: ort.InferenceSession; backend: DetectBackend }> {
  if (await hasWebGpuAdapter()) {
    try {
      const session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu', 'wasm'] })
      return { session, backend: webGpuDeviceCreated() ? 'webgpu' : 'wasm' }
    } catch (err) {
      console.warn('WebGPU не поднялся, модель запускается на wasm:', err)
    }
  }
  return { session: await ort.InferenceSession.create(model, WASM_ONLY), backend: 'wasm' }
}

export async function createOrtRunner(model: Uint8Array, manifest: ModelManifest): Promise<InferenceRunner> {
  let { session, backend } = await createOrtSession(model)
  if (!session.inputNames.includes(manifest.input) || !session.outputNames.includes(manifest.output)) {
    const names = `входы ${session.inputNames.join(', ')}; выходы ${session.outputNames.join(', ')}`
    await session.release().catch(() => undefined)
    throw new DetectWorkerFailure('loadFailed', `У модели нет входа ${manifest.input} или выхода ${manifest.output} (${names})`)
  }
  // Держим байты модели на случай отката на wasm
  let spare: Uint8Array | null = backend === 'webgpu' ? model : null
  const size = manifest.imgsz

  const runOnce = async (input: Float32Array) => {
    const out = await session.run({ [manifest.input]: new ort.Tensor('float32', input, [1, 3, size, size]) })
    const tensor = out[manifest.output]
    if (!tensor || !(tensor.data instanceof Float32Array)) throw new Error(`Выход ${manifest.output} не float32`)
    return { data: tensor.data, dims: tensor.dims }
  }

  return {
    get backend() {
      return backend
    },
    async run(input) {
      try {
        return await runOnce(input)
      } catch (err) {
        if (backend !== 'webgpu' || !spare) throw err
        // WebGPU может упасть и на прогоне (потеря устройства, мало видеопамяти), один раз уходим на wasm
        console.warn('Прогон на WebGPU не удался, переход на wasm:', err)
        const bytes = spare
        spare = null
        await session.release().catch(() => undefined)
        session = await ort.InferenceSession.create(bytes, WASM_ONLY)
        backend = 'wasm'
        return runOnce(input)
      }
    },
  }
}

// ---------- Изображение ----------

export async function openBitmapSource(image: Blob, imgsz: number): Promise<TileSource> {
  // Поворот из EXIF как в photoIngest, чтобы рамки совпали с картинкой.
  // ICC не применяем, при обучении кадры читались без цветового преобразования
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image', colorSpaceConversion: 'none' })
  try {
    const canvas = new OffscreenCanvas(imgsz, imgsz)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('OffscreenCanvas 2D недоступен')
    const fill = `rgb(${LETTERBOX_FILL_BYTE}, ${LETTERBOX_FILL_BYTE}, ${LETTERBOX_FILL_BYTE})`
    const chw = new Float32Array(3 * imgsz * imgsz)
    return {
      width: bitmap.width,
      height: bitmap.height,
      readTile(tile, lb) {
        // В холст идёт только вырезанный фрагмент, а не весь кадр
        ctx.fillStyle = fill
        ctx.fillRect(0, 0, imgsz, imgsz)
        ctx.drawImage(bitmap, tile.x, tile.y, tile.w, tile.h, lb.padX, lb.padY, lb.newW, lb.newH)
        return rgbaToChw(ctx.getImageData(0, 0, imgsz, imgsz).data, imgsz, chw)
      },
      close() {
        bitmap.close()
        // Отпускаем буфер холста, не дожидаясь GC
        canvas.width = 0
        canvas.height = 0
      },
    }
  } catch (err) {
    bitmap.close()
    throw err
  }
}

// В tsconfig нет lib WebWorker, описываем нужное сами
interface DetectWorkerScope {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: DetectWorkerResponse): void
}

// Только внутри воркера: в Node (тесты) нет self, в основном потоке есть document
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const scope = self as unknown as DetectWorkerScope
  const handle = createDetectWorkerHandler(
    {
      fetch: (url) => fetch(url),
      createRunner: createOrtRunner,
      openImage: openBitmapSource,
      now: () => performance.now(),
    },
    (msg) => scope.postMessage(msg),
  )
  scope.onmessage = (event) => handle(event.data)
}
