import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import manifestText from '../../../public/models/defects/manifest.json?raw'

// Настоящего ONNX Runtime в тестах нет: модуль подменяется, проверяется только наша обвязка вокруг него
const ortMock = vi.hoisted(() => ({
  env: { wasm: {} as Record<string, unknown>, webgpu: {} as Record<string, unknown> },
  create: vi.fn(),
}))

vi.mock('onnxruntime-web/webgpu', () => ({
  env: ortMock.env,
  InferenceSession: { create: ortMock.create },
  Tensor: class {
    type: string
    data: Float32Array
    dims: number[]
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type
      this.data = data
      this.dims = dims
    }
  },
}))

const {
  createDetectWorkerHandler,
  createOrtRunner,
  createOrtSession,
  DetectWorkerFailure,
  openBitmapSource,
} = await import('@/workers/detect.worker')
const { createDetectionEngine, getDetectionEngine, DetectCancelledError, DetectFailedError, ModelMissingError } = await import('@/services/detectionEngine')
const { letterbox } = await import('@/domain/detectionPipeline')

type WorkerModule = typeof import('@/workers/detect.worker')
type DetectWorkerDeps = Parameters<WorkerModule['createDetectWorkerHandler']>[0]
type DetectWorkerResponse = import('@/workers/detect.worker').DetectWorkerResponse
type DetectWorkerRequest = import('@/workers/detect.worker').DetectWorkerRequest
type InferenceRunner = import('@/workers/detect.worker').InferenceRunner
type TileSource = import('@/workers/detect.worker').TileSource
type DetectWorkerPort = import('@/services/detectionEngine').DetectWorkerPort

const MANIFEST_URL = 'app://bundle/models/defects/manifest.json'
const MODEL_URL = 'app://bundle/models/defects/model.onnx'
const manifest = JSON.parse(manifestText)
const OPTIONS = { confidence: 0.25, iou: 0.7 }

// Выход [1, 11, 8] с одной рамкой класса 3 (surface_eye) во входных пикселях 100..140
function modelOutput(): { data: Float32Array; dims: number[] } {
  const anchors = 8
  const data = new Float32Array(11 * anchors)
  data[0] = 120
  data[anchors] = 120
  data[2 * anchors] = 40
  data[3 * anchors] = 40
  data[(4 + 3) * anchors] = 0.5
  return { data, dims: [1, 11, anchors] }
}

function fakeRunner(backend: 'webgpu' | 'wasm' = 'wasm') {
  const out = modelOutput()
  const runner = { backend, run: vi.fn(async (_input: Float32Array) => out) }
  return runner satisfies InferenceRunner
}

function fakeSource(width: number, height: number) {
  const buffer = new Float32Array(3 * 640 * 640)
  const source = {
    width,
    height,
    readTile: vi.fn(() => buffer),
    close: vi.fn(),
  }
  return source satisfies TileSource
}

const manifestResponse = () => new Response(manifestText, { headers: { 'content-type': 'application/json' } })
const modelResponse = () => new Response(new Uint8Array([8, 7, 18, 4, 1, 2, 3, 4]), { headers: { 'content-type': 'application/octet-stream' } })

function fakeFetch(files: Record<string, () => Response | Promise<Response>> = { [MANIFEST_URL]: manifestResponse, [MODEL_URL]: modelResponse }) {
  return vi.fn(async (url: string) => {
    const file = files[url]
    return file ? file() : new Response('Not found', { status: 404 })
  })
}

function makeDeps(overrides: Partial<DetectWorkerDeps> = {}) {
  const runner = fakeRunner()
  const source = fakeSource(2000, 1000)
  let clock = 0
  const deps = {
    fetch: fakeFetch(),
    createRunner: vi.fn(async () => runner as InferenceRunner),
    openImage: vi.fn(async () => source as TileSource),
    now: () => (clock += 5),
    ...overrides,
  }
  return { deps, runner, source }
}

function startHandler(deps: DetectWorkerDeps) {
  const posted: DetectWorkerResponse[] = []
  const handle = createDetectWorkerHandler(deps, (msg) => posted.push(msg))
  return { posted, handle }
}

const image = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
const load = (id = 1): DetectWorkerRequest => ({ type: 'load', id, modelUrl: MODEL_URL, manifestUrl: MANIFEST_URL })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('воркер детекции: обработчик сообщений', () => {
  it('ORT настроен на однопоточный wasm без прокси-воркера', () => {
    expect(ortMock.env.wasm.numThreads).toBe(1)
    expect(ortMock.env.wasm.proxy).toBe(false)
  })

  it('load: манифест и модель по переданным адресам, ответ с фактическим backend; повторный load модель не перечитывает', async () => {
    const { deps } = makeDeps()
    const { posted, handle } = startHandler(deps)
    handle(load(1))
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ type: 'loaded', id: 1, backend: 'wasm', manifest: { name: manifest.name, imgsz: 640 } })
    expect(vi.mocked(deps.fetch).mock.calls.map((c) => c[0])).toEqual([MANIFEST_URL, MODEL_URL])
    expect(deps.createRunner).toHaveBeenCalledTimes(1)
    const [bytes, parsed] = vi.mocked(deps.createRunner).mock.calls[0]
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(parsed.classes).toHaveLength(7)

    handle(load(2))
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ type: 'loaded', id: 2 })
    expect(deps.fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['404', { [MANIFEST_URL]: () => new Response('nope', { status: 404 }) }, 'modelMissing'],
    ['страница dev-сервера вместо файла', { [MANIFEST_URL]: () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) }, 'modelMissing'],
    ['сетевая ошибка под app:// (файла нет в сборке)', { [MANIFEST_URL]: () => Promise.reject(new TypeError('Failed to fetch')) }, 'modelMissing'],
    ['указатель Git LFS вместо весов', { [MANIFEST_URL]: manifestResponse, [MODEL_URL]: () => new Response('version https://git-lfs.github.com/spec/v1\noid sha256:0') }, 'modelMissing'],
    ['манифест не JSON', { [MANIFEST_URL]: () => new Response('{', { headers: { 'content-type': 'application/json' } }) }, 'loadFailed'],
    ['чужой манифест', { [MANIFEST_URL]: () => Response.json({ ...manifest, format: 'other' }) }, 'loadFailed'],
    ['HTTP 500', { [MANIFEST_URL]: () => new Response('boom', { status: 500 }) }, 'loadFailed'],
  ])('load: %s → %s', async (_name, files, code) => {
    const { deps } = makeDeps({ fetch: fakeFetch(files) })
    const { posted, handle } = startHandler(deps)
    handle(load())
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ type: 'failed', id: 1, code })
    expect(deps.createRunner).not.toHaveBeenCalled()
  })

  it('load: сетевая ошибка на http — это сбой загрузки, а не отсутствие модели', async () => {
    const url = 'http://localhost:5173/models/defects/manifest.json'
    const { deps } = makeDeps({ fetch: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) })
    const { posted, handle } = startHandler(deps)
    handle({ type: 'load', id: 1, modelUrl: MODEL_URL, manifestUrl: url })
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ type: 'failed', code: 'loadFailed' })
  })

  it('load: сессия ORT не создалась — loadFailed, следующая попытка загружает заново', async () => {
    const runner = fakeRunner('webgpu')
    const createRunner = vi.fn().mockRejectedValueOnce(new Error('bad model')).mockResolvedValueOnce(runner)
    const { deps } = makeDeps({ createRunner })
    const { posted, handle } = startHandler(deps)
    handle(load(1))
    handle(load(2))
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[0]).toMatchObject({ type: 'failed', id: 1, code: 'loadFailed', message: 'bad model' })
    expect(posted[1]).toMatchObject({ type: 'loaded', id: 2, backend: 'webgpu' })
  })

  it('detect до загрузки модели — ошибка', async () => {
    const { deps } = makeDeps()
    const { posted, handle } = startHandler(deps)
    handle({ type: 'detect', id: 5, image: image(), options: OPTIONS })
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ type: 'failed', id: 5, code: 'loadFailed' })
  })

  it('detect: кадр 2000×1000 → 8 фрагментов по очереди, прогресс, находки в долях кадра, кадр закрыт', async () => {
    const { deps, runner, source } = makeDeps()
    const { posted, handle } = startHandler(deps)
    handle(load())
    handle({ type: 'detect', id: 2, image: image(), options: OPTIONS })
    await vi.waitFor(() => expect(posted.at(-1)?.type).toBe('result'))
    expect(deps.openImage).toHaveBeenCalledWith(expect.any(Blob), 640)
    const progress = posted.filter((m) => m.type === 'progress').map((m) => (m.type === 'progress' ? m.tile : -1))
    expect(progress).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(runner.run).toHaveBeenCalledTimes(8)
    expect(source.readTile).toHaveBeenCalledTimes(8)
    expect(source.readTile.mock.calls[1]).toEqual([
      { x: 512, y: 0, w: 640, h: 640 },
      expect.objectContaining({ scale: 1, padX: 0, padY: 0 }),
    ])
    const result = posted.at(-1)
    if (result?.type !== 'result') throw new Error('нет результата')
    expect(result).toMatchObject({ id: 2, tiles: 8, backend: 'wasm' })
    expect(result.durationMs).toBeGreaterThan(0)
    // Рамка 100..140 во входе каждого фрагмента: 8 разных мест кадра, все класса surface_eye
    expect(result.detections).toHaveLength(8)
    expect(new Set(result.detections.map((d) => d.modelClass))).toEqual(new Set(['surface_eye']))
    const first = result.detections.find((d) => d.x < 0.1 && d.y < 0.2)
    expect(first).toMatchObject({ classIndex: 3, confidence: 0.5 })
    expect(first?.x).toBeCloseTo(100 / 2000, 12)
    expect(first?.w).toBeCloseTo(40 / 2000, 12)
    expect(first?.h).toBeCloseTo(40 / 1000, 12)
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it('cancel: остановка между фрагментами, кадр закрывается', async () => {
    const out = modelOutput()
    const gates: (() => void)[] = []
    const runner: InferenceRunner = {
      backend: 'wasm',
      run: vi.fn(() => new Promise<typeof out>((resolve) => gates.push(() => resolve(out)))),
    }
    const { deps, source } = makeDeps({ createRunner: vi.fn(async () => runner) })
    const { posted, handle } = startHandler(deps)
    handle(load())
    handle({ type: 'detect', id: 2, image: image(), options: OPTIONS })
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    handle({ type: 'cancel', id: 2 })
    gates[0]()
    await vi.waitFor(() => expect(posted.at(-1)).toEqual({ type: 'cancelled', id: 2 }))
    expect(runner.run).toHaveBeenCalledTimes(1)
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it('cancel запроса в очереди: до декодирования дело не доходит', async () => {
    const { deps } = makeDeps()
    const { posted, handle } = startHandler(deps)
    handle(load())
    handle({ type: 'detect', id: 2, image: image(), options: OPTIONS })
    handle({ type: 'cancel', id: 2 })
    await vi.waitFor(() => expect(posted.at(-1)).toEqual({ type: 'cancelled', id: 2 }))
    expect(deps.openImage).not.toHaveBeenCalled()
  })

  it('битое изображение — decodeFailed, сбой прогона — inferenceFailed с номером фрагмента', async () => {
    const broken = makeDeps({ openImage: vi.fn(() => Promise.reject(new Error('InvalidStateError'))) })
    const a = startHandler(broken.deps)
    a.handle(load())
    a.handle({ type: 'detect', id: 2, image: image(), options: OPTIONS })
    await vi.waitFor(() => expect(a.posted.at(-1)?.type).toBe('failed'))
    expect(a.posted.at(-1)).toMatchObject({ code: 'decodeFailed', id: 2 })

    const runner: InferenceRunner = { backend: 'wasm', run: vi.fn().mockResolvedValueOnce(modelOutput()).mockRejectedValue(new Error('OOM')) }
    const failing = makeDeps({ createRunner: vi.fn(async () => runner) })
    const b = startHandler(failing.deps)
    b.handle(load())
    b.handle({ type: 'detect', id: 3, image: image(), options: OPTIONS })
    await vi.waitFor(() => expect(b.posted.at(-1)?.type).toBe('failed'))
    expect(b.posted.at(-1)).toMatchObject({ code: 'inferenceFailed', id: 3, message: 'Фрагмент 2 из 8: OOM' })
    expect(failing.source.close).toHaveBeenCalledTimes(1)
  })

  it('выход модели не совпадает с манифестом — inferenceFailed', async () => {
    const runner: InferenceRunner = { backend: 'wasm', run: vi.fn(async () => ({ data: new Float32Array(9 * 8), dims: [1, 9, 8] })) }
    const { deps } = makeDeps({ createRunner: vi.fn(async () => runner) })
    const { posted, handle } = startHandler(deps)
    handle(load())
    handle({ type: 'detect', id: 2, image: image(), options: OPTIONS })
    await vi.waitFor(() => expect(posted.at(-1)?.type).toBe('failed'))
    expect(posted.at(-1)).toMatchObject({ code: 'inferenceFailed' })
  })

  it('некорректное сообщение — badRequest', () => {
    const { deps } = makeDeps()
    const { posted, handle } = startHandler(deps)
    handle({ type: 'detect', id: 9, image: 'not a blob', options: OPTIONS })
    handle({ type: 'detect', id: 10, image: image(), options: { confidence: 2, iou: 0.7 } })
    handle({ type: 'explode' })
    handle(null)
    expect(posted.map((m) => (m.type === 'failed' ? [m.id, m.code] : m.type))).toEqual([
      [9, 'badRequest'],
      [10, 'badRequest'],
      [-1, 'badRequest'],
      [-1, 'badRequest'],
    ])
  })
})

describe('воркер детекции: сессия ONNX Runtime', () => {
  const model = new Uint8Array([1, 2, 3])

  function fakeSession() {
    return {
      inputNames: ['images'],
      outputNames: ['output0'],
      run: vi.fn(async (_feeds: Record<string, { dims: number[] }>) => ({ output0: { data: new Float32Array(11 * 8400), dims: [1, 11, 8400] } })),
      release: vi.fn(async () => {}),
    }
  }

  beforeEach(() => {
    ortMock.create.mockReset()
    delete ortMock.env.webgpu.device
  })

  it('без WebGPU — сразу wasm', async () => {
    vi.stubGlobal('navigator', {})
    ortMock.create.mockResolvedValue(fakeSession())
    const { backend } = await createOrtSession(model)
    expect(backend).toBe('wasm')
    expect(ortMock.create.mock.calls.map((c) => c[1])).toEqual([{ executionProviders: ['wasm'] }])
  })

  it('WebGPU есть и поднялся — webgpu', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } })
    ortMock.create.mockImplementation(async () => {
      ortMock.env.webgpu.device = {}
      return fakeSession()
    })
    const { backend } = await createOrtSession(model)
    expect(backend).toBe('webgpu')
    expect(ortMock.create.mock.calls.map((c) => c[1])).toEqual([{ executionProviders: ['webgpu', 'wasm'] }])
  })

  it('адаптер есть, но ORT молча откатился на wasm — честно wasm', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } })
    ortMock.create.mockResolvedValue(fakeSession())
    expect((await createOrtSession(model)).backend).toBe('wasm')
  })

  it('WebGPU упал на создании сессии — пересоздаётся только с wasm', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    ortMock.create.mockRejectedValueOnce(new Error('webgpu: shader compile')).mockResolvedValueOnce(fakeSession())
    const { backend } = await createOrtSession(model)
    expect(backend).toBe('wasm')
    expect(ortMock.create.mock.calls.map((c) => c[1])).toEqual([{ executionProviders: ['webgpu', 'wasm'] }, { executionProviders: ['wasm'] }])
  })

  it('адаптера нет — wasm без попытки webgpu', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } })
    ortMock.create.mockResolvedValue(fakeSession())
    expect((await createOrtSession(model)).backend).toBe('wasm')
    expect(ortMock.create).toHaveBeenCalledTimes(1)
  })

  it('прогон: вход [1, 3, 640, 640] под именем из манифеста, выход по имени', async () => {
    vi.stubGlobal('navigator', {})
    const session = fakeSession()
    ortMock.create.mockResolvedValue(session)
    const runner = await createOrtRunner(model, manifest)
    const out = await runner.run(new Float32Array(3 * 640 * 640))
    expect(out.dims).toEqual([1, 11, 8400])
    const feeds = session.run.mock.calls[0][0]
    expect(Object.keys(feeds)).toEqual(['images'])
    expect(feeds.images.dims).toEqual([1, 3, 640, 640])
  })

  it('прогон на WebGPU упал — один раз переходим на wasm и повторяем фрагмент', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gpuSession = fakeSession()
    gpuSession.run.mockRejectedValue(new Error('device lost'))
    const cpuSession = fakeSession()
    ortMock.create
      .mockImplementationOnce(async () => {
        ortMock.env.webgpu.device = {}
        return gpuSession
      })
      .mockResolvedValueOnce(cpuSession)
    const runner = await createOrtRunner(model, manifest)
    expect(runner.backend).toBe('webgpu')
    await runner.run(new Float32Array(3 * 640 * 640))
    expect(runner.backend).toBe('wasm')
    expect(gpuSession.release).toHaveBeenCalled()
    expect(ortMock.create.mock.calls[1]).toEqual([model, { executionProviders: ['wasm'] }])
    expect(cpuSession.run).toHaveBeenCalledTimes(1)
  })

  it('имена входа и выхода не совпали с манифестом — loadFailed', async () => {
    vi.stubGlobal('navigator', {})
    const session = { ...fakeSession(), inputNames: ['input'] }
    ortMock.create.mockResolvedValue(session)
    const err = await createOrtRunner(model, manifest).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DetectWorkerFailure)
    expect(err).toMatchObject({ code: 'loadFailed' })
    expect(session.release).toHaveBeenCalled()
  })
})

describe('воркер детекции: фрагменты из изображения', () => {
  function stubCanvas() {
    const ops: unknown[][] = []
    const ctx = {
      fillStyle: '',
      fillRect: vi.fn((...args: number[]) => {
        ops.push(['fillRect', ctx.fillStyle, ...args])
      }),
      drawImage: vi.fn((_image: unknown, ...args: number[]) => {
        ops.push(['drawImage', ...args])
      }),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(114) })),
    }
    const canvases: { width: number; height: number; contextArgs: unknown[] }[] = []
    class FakeOffscreenCanvas {
      width: number
      height: number
      contextArgs: unknown[] = []
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
        canvases.push(this)
      }
      getContext(...args: unknown[]) {
        this.contextArgs = args
        return ctx
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    return { ctx, ops, canvases }
  }

  it('фрагмент вырезается из кадра на холсте 640×640 до создания тензора; кадр и холст освобождаются', async () => {
    const { ctx, ops, canvases } = stubCanvas()
    const bitmap = { width: 8192, height: 5460, close: vi.fn() }
    const decode = vi.fn(async () => bitmap)
    vi.stubGlobal('createImageBitmap', decode)
    const blob = image()
    const source = await openBitmapSource(blob, 640)
    // Поворот из EXIF — как в photoIngest, иначе доли рамок разойдутся с сохранёнными размерами фото
    expect(decode).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'none' })
    expect([source.width, source.height]).toEqual([8192, 5460])
    expect(canvases).toHaveLength(1)
    expect(canvases[0]).toMatchObject({ width: 640, height: 640, contextArgs: ['2d', { willReadFrequently: true }] })

    const corner = source.readTile({ x: 7552, y: 4820, w: 640, h: 640 }, letterbox(640, 640))
    expect(ops).toEqual([
      ['fillRect', 'rgb(114, 114, 114)', 0, 0, 640, 640],
      ['drawImage', 7552, 4820, 640, 640, 0, 0, 640, 640],
    ])
    expect(ctx.drawImage.mock.calls[0][0]).toBe(bitmap)
    expect(ctx.getImageData).toHaveBeenLastCalledWith(0, 0, 640, 640)
    expect(corner).toHaveLength(3 * 640 * 640)
    expect(corner[0]).toBeCloseTo(114 / 255, 6)

    // Кадр целиком 1280×960: уменьшение вдвое в полосу 640×480 с полем 80 сверху
    ops.length = 0
    const whole = source.readTile({ x: 0, y: 0, w: 1280, h: 960 }, letterbox(1280, 960))
    expect(ops[1]).toEqual(['drawImage', 0, 0, 1280, 960, 0, 80, 640, 480])
    // Буфер входа один на все фрагменты: 176 прогонов не выделяют по 5 МБ
    expect(whole).toBe(corner)

    source.close()
    expect(bitmap.close).toHaveBeenCalledTimes(1)
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 })
  })

  it('холст недоступен — кадр закрывается сразу, ошибка уходит наверх', async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null
        }
      },
    )
    const bitmap = { width: 100, height: 100, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    await expect(openBitmapSource(image(), 640)).rejects.toThrow(/OffscreenCanvas/)
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it('на кадре 8192×5460 обработчик режет 176 фрагментов и каждый читает отдельно', async () => {
    const frame = fakeSource(8192, 5460)
    const { deps, runner } = makeDeps({ openImage: vi.fn(async () => frame as TileSource) })
    const { posted, handle } = startHandler(deps)
    handle(load())
    handle({ type: 'detect', id: 2, image: image(), options: OPTIONS })
    await vi.waitFor(() => expect(posted.at(-1)?.type).toBe('result'))
    expect(posted.at(-1)).toMatchObject({ type: 'result', tiles: 176 })
    expect(runner.run).toHaveBeenCalledTimes(176)
    expect(frame.readTile).toHaveBeenCalledTimes(176)
    expect(frame.readTile.mock.calls.at(-1)).toEqual([{ x: 7552, y: 4820, w: 640, h: 640 }, expect.objectContaining({ scale: 1 })])
    expect(posted.filter((m) => m.type === 'progress')).toHaveLength(177)
    expect(frame.close).toHaveBeenCalledTimes(1)
  })
})

// Подмена Worker. С deps — внутри крутится настоящий обработчик воркера (асинхронно, как поток),
// без deps — ответы шлёт сам тест через emit
class FakeWorker implements DetectWorkerPort {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<DetectWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  posted: DetectWorkerRequest[] = []
  terminated = 0
  private readonly handle: ((data: unknown) => void) | null

  constructor(deps?: DetectWorkerDeps) {
    FakeWorker.instances.push(this)
    this.handle = deps ? createDetectWorkerHandler(deps, (msg) => setTimeout(() => this.emit(msg))) : null
  }

  postMessage(message: DetectWorkerRequest): void {
    this.posted.push(message)
    const handle = this.handle
    if (handle) setTimeout(() => this.terminated === 0 && handle(message))
  }

  emit(msg: DetectWorkerResponse): void {
    if (this.terminated === 0) this.onmessage?.({ data: msg } as MessageEvent<DetectWorkerResponse>)
  }

  crash(message: string): void {
    this.onerror?.({ message, preventDefault() {} } as ErrorEvent)
  }

  terminate(): void {
    this.terminated++
  }

  last(): DetectWorkerRequest | undefined {
    return this.posted.at(-1)
  }
}

const urls = () => ({ modelUrl: MODEL_URL, manifestUrl: MANIFEST_URL })
const loaded = (id: number): DetectWorkerResponse => ({ type: 'loaded', id, backend: 'webgpu', manifest })

function manualEngine(cancelGraceMs = 30_000) {
  const engine = createDetectionEngine({ createWorker: () => new FakeWorker(), modelUrls: urls, cancelGraceMs })
  const worker = () => {
    const w = FakeWorker.instances.at(-1)
    if (!w) throw new Error('воркер не создан')
    return w
  }
  return { engine, worker }
}

// Модель начинает грузиться в очереди запросов, то есть не синхронно с вызовом detect
async function answerLoad(worker: () => FakeWorker): Promise<void> {
  await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'load' }))
  const w = worker()
  w.emit(loaded(w.last()?.id ?? -1))
}

async function settledState(promise: Promise<unknown>): Promise<'pending' | 'resolved' | 'rejected'> {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending'
  promise.then(
    () => (state = 'resolved'),
    () => (state = 'rejected'),
  )
  await new Promise((r) => setTimeout(r, 0))
  return state
}

describe('сервис детекции', () => {
  beforeEach(() => {
    FakeWorker.instances = []
  })

  it('load: один запрос к воркеру с адресами модели; повторный load его не повторяет', async () => {
    const { engine, worker } = manualEngine()
    const first = engine.load()
    const second = engine.load()
    expect(worker().posted).toEqual([{ type: 'load', id: 1, modelUrl: MODEL_URL, manifestUrl: MANIFEST_URL }])
    await answerLoad(worker)
    await expect(first).resolves.toEqual({ backend: 'webgpu', manifest })
    await expect(second).resolves.toEqual({ backend: 'webgpu', manifest })
    await engine.load()
    expect(worker().posted).toHaveLength(1)
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('модели нет — ModelMissingError; после установки следующий load пробует снова', async () => {
    const { engine, worker } = manualEngine()
    const first = engine.load()
    worker().emit({ type: 'failed', id: 1, code: 'modelMissing', message: 'Файл модели не найден' })
    await expect(first).rejects.toBeInstanceOf(ModelMissingError)
    const retry = engine.load()
    expect(worker().last()).toMatchObject({ type: 'load', id: 2 })
    worker().emit(loaded(2))
    await expect(retry).resolves.toMatchObject({ backend: 'webgpu' })
  })

  it('неудачная загрузка: воркер заменяется — ORT запоминает сбой инициализации до конца жизни потока', async () => {
    const { engine, worker } = manualEngine()
    const first = engine.load()
    const broken = worker()
    broken.emit({ type: 'failed', id: 1, code: 'loadFailed', message: 'no available backend found' })
    await expect(first).rejects.toMatchObject({ name: 'DetectFailedError', code: 'loadFailed' })
    expect(broken.terminated).toBe(1)
    const retry = engine.load()
    expect(FakeWorker.instances).toHaveLength(2)
    expect(worker().posted).toEqual([{ type: 'load', id: 2, modelUrl: MODEL_URL, manifestUrl: MANIFEST_URL }])
    worker().emit(loaded(2))
    await expect(retry).resolves.toMatchObject({ backend: 'webgpu' })
  })

  it('модель установили после ошибки — следующий detect её находит', async () => {
    let files: Record<string, () => Response> = {}
    const engine = createDetectionEngine({
      createWorker: () => new FakeWorker(makeDeps({ fetch: vi.fn(async (url: string) => files[url]?.() ?? new Response('', { status: 404 })) }).deps),
      modelUrls: urls,
    })
    await expect(engine.detect(image(), OPTIONS).promise).rejects.toBeInstanceOf(ModelMissingError)
    files = { [MANIFEST_URL]: manifestResponse, [MODEL_URL]: modelResponse }
    await expect(engine.detect(image(), OPTIONS).promise).resolves.toMatchObject({ tiles: 8, backend: 'wasm' })
  })

  it('по умолчанию: отдельный модульный воркер (не inline), адреса модели — от document.baseURI', async () => {
    const created: { url: string; options: unknown }[] = []
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: URL | string, options?: WorkerOptions) {
          super()
          created.push({ url: String(url), options })
        }
      },
    )
    // Electron: приложение открыто с app://bundle/index.html
    vi.stubGlobal('document', { baseURI: 'app://bundle/index.html' })
    const engine = createDetectionEngine()
    const loading = engine.load()
    expect(created).toHaveLength(1)
    expect(created[0].options).toEqual({ type: 'module' })
    expect(created[0].url).toMatch(/\/src\/workers\/detect\.worker\.ts/)
    expect(created[0].url).not.toMatch(/^(blob|data):|inline/)
    expect(FakeWorker.instances.at(-1)?.posted).toEqual([
      { type: 'load', id: 1, modelUrl: 'app://bundle/models/defects/model.onnx', manifestUrl: 'app://bundle/models/defects/manifest.json' },
    ])
    engine.dispose()
    await expect(loading).rejects.toBeInstanceOf(DetectCancelledError)
  })

  it('detect через настоящий обработчик воркера: прогресс по фрагментам и результат', async () => {
    const { deps } = makeDeps()
    const engine = createDetectionEngine({ createWorker: () => new FakeWorker(deps), modelUrls: urls })
    const progress: { tile: number; tiles: number }[] = []
    const { promise } = engine.detect(image(), OPTIONS, (p) => progress.push(p))
    const result = await promise
    expect(result.tiles).toBe(8)
    expect(result.backend).toBe('wasm')
    expect(result.detections).toHaveLength(8)
    expect(progress[0]).toEqual({ tile: 0, tiles: 8 })
    expect(progress.at(-1)).toEqual({ tile: 8, tiles: 8 })
    // Модель грузится один раз на все запросы
    await engine.detect(image(), OPTIONS).promise
    expect(deps.createRunner).toHaveBeenCalledTimes(1)
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('ошибка модели в detect — ModelMissingError, битый кадр — DetectFailedError с кодом', async () => {
    const missing = createDetectionEngine({ createWorker: () => new FakeWorker(makeDeps({ fetch: fakeFetch({}) }).deps), modelUrls: urls })
    await expect(missing.detect(image(), OPTIONS).promise).rejects.toBeInstanceOf(ModelMissingError)

    const broken = makeDeps({ openImage: vi.fn(() => Promise.reject(new Error('bad jpeg'))) })
    const engine = createDetectionEngine({ createWorker: () => new FakeWorker(broken.deps), modelUrls: urls })
    const err = await engine.detect(image(), OPTIONS).promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DetectFailedError)
    expect(err).toMatchObject({ code: 'decodeFailed' })
  })

  it('запросы идут последовательно: следующий уходит в воркер после ответа на предыдущий', async () => {
    const { engine, worker } = manualEngine()
    const a = engine.detect(image(), OPTIONS)
    const b = engine.detect(image(), OPTIONS)
    await answerLoad(worker)
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect', id: 2 }))
    expect(worker().posted.filter((m) => m.type === 'detect')).toHaveLength(1)
    worker().emit({ type: 'result', id: 2, detections: [], tiles: 1, durationMs: 10, backend: 'webgpu' })
    await expect(a.promise).resolves.toEqual({ detections: [], tiles: 1, durationMs: 10, backend: 'webgpu' })
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect', id: 3 }))
    worker().emit({ type: 'failed', id: 3, code: 'inferenceFailed', message: 'OOM' })
    await expect(b.promise).rejects.toMatchObject({ name: 'DetectFailedError', code: 'inferenceFailed', message: 'OOM' })
  })

  it('отмена идущего запроса: промис отклоняется сразу, воркер получает cancel, очередь ждёт подтверждения', async () => {
    const { engine, worker } = manualEngine()
    const progress = vi.fn()
    const a = engine.detect(image(), OPTIONS, progress)
    const b = engine.detect(image(), OPTIONS)
    await answerLoad(worker)
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect', id: 2 }))
    a.cancel()
    await expect(a.promise).rejects.toBeInstanceOf(DetectCancelledError)
    expect(worker().last()).toEqual({ type: 'cancel', id: 2 })
    // Прогресс отменённого запроса больше не доходит до интерфейса
    worker().emit({ type: 'progress', id: 2, tile: 3, tiles: 176 })
    expect(progress).not.toHaveBeenCalled()
    expect(await settledState(b.promise)).toBe('pending')
    expect(worker().posted.filter((m) => m.type === 'detect')).toHaveLength(1)
    worker().emit({ type: 'cancelled', id: 2 })
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect', id: 3 }))
    expect(worker().terminated).toBe(0)
    a.cancel()
  })

  it('воркер не подтвердил отмену — через паузу он останавливается, следующий запрос поднимает новый', async () => {
    const { engine, worker } = manualEngine(20)
    const a = engine.detect(image(), OPTIONS)
    const b = engine.detect(image(), OPTIONS)
    await answerLoad(worker)
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect' }))
    const stuck = worker()
    a.cancel()
    await expect(a.promise).rejects.toBeInstanceOf(DetectCancelledError)
    await vi.waitFor(() => expect(stuck.terminated).toBe(1))
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    expect(worker().posted[0]).toMatchObject({ type: 'load' })
    worker().emit(loaded(worker().posted[0].id))
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect' }))
    const req = worker().last()
    worker().emit({ type: 'result', id: req?.id ?? -1, detections: [], tiles: 1, durationMs: 1, backend: 'wasm' })
    await expect(b.promise).resolves.toMatchObject({ backend: 'wasm' })
  })

  it('отмена запроса из очереди — до воркера он не доходит', async () => {
    const { engine, worker } = manualEngine()
    const a = engine.detect(image(), OPTIONS)
    const b = engine.detect(image(), OPTIONS)
    b.cancel()
    await expect(b.promise).rejects.toBeInstanceOf(DetectCancelledError)
    await answerLoad(worker)
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect' }))
    worker().emit({ type: 'result', id: 2, detections: [], tiles: 1, durationMs: 1, backend: 'webgpu' })
    await a.promise
    await new Promise((r) => setTimeout(r, 0))
    expect(worker().posted.filter((m) => m.type === 'detect')).toHaveLength(1)
  })

  it('воркер упал — все ожидающие получают workerFailed, следующий запрос поднимает новый воркер', async () => {
    const { engine, worker } = manualEngine()
    const a = engine.detect(image(), OPTIONS)
    await answerLoad(worker)
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect' }))
    const dead = worker()
    dead.crash('Out of memory')
    await expect(a.promise).rejects.toMatchObject({ name: 'DetectFailedError', code: 'workerFailed', message: 'Out of memory' })
    expect(dead.terminated).toBe(1)
    const next = engine.load()
    expect(FakeWorker.instances).toHaveLength(2)
    worker().emit(loaded(worker().posted[0].id))
    await expect(next).resolves.toMatchObject({ backend: 'webgpu' })
  })

  it('воркер не создаётся — DetectFailedError workerFailed', async () => {
    const engine = createDetectionEngine({
      createWorker: () => {
        throw new Error('Worker is not supported')
      },
      modelUrls: urls,
    })
    await expect(engine.load()).rejects.toMatchObject({ code: 'workerFailed' })
    await expect(engine.detect(image(), OPTIONS).promise).rejects.toMatchObject({ code: 'workerFailed' })
  })

  it('некорректные параметры — RangeError без обращения к воркеру', async () => {
    const { engine } = manualEngine()
    await expect(engine.detect(image(), { confidence: 0.25, iou: 0 }).promise).rejects.toBeInstanceOf(RangeError)
    await expect(engine.detect(image(), { confidence: Number.NaN, iou: 0.7 }).promise).rejects.toBeInstanceOf(RangeError)
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('dispose: идущие и ждущие запросы отменяются, воркер останавливается; потом движок можно поднять снова', async () => {
    const { engine, worker } = manualEngine()
    const a = engine.detect(image(), OPTIONS)
    const b = engine.detect(image(), OPTIONS)
    await answerLoad(worker)
    await vi.waitFor(() => expect(worker().last()).toMatchObject({ type: 'detect' }))
    const first = worker()
    engine.dispose()
    await expect(a.promise).rejects.toBeInstanceOf(DetectCancelledError)
    await expect(b.promise).rejects.toBeInstanceOf(DetectCancelledError)
    expect(first.terminated).toBe(1)
    await new Promise((r) => setTimeout(r, 0))
    expect(FakeWorker.instances).toHaveLength(1)
    const again = engine.load()
    expect(FakeWorker.instances).toHaveLength(2)
    worker().emit(loaded(worker().posted[0].id))
    await expect(again).resolves.toMatchObject({ backend: 'webgpu' })
  })

  it('getDetectionEngine — один экземпляр на приложение, воркер создаётся только по запросу', () => {
    vi.stubGlobal('Worker', FakeWorker)
    expect(getDetectionEngine()).toBe(getDetectionEngine())
    expect(FakeWorker.instances).toHaveLength(0)
  })
})
