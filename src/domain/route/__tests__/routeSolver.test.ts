import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolveInput, SolveProgress } from '../index'
import { handleRouteMessage, type RouteWorkerResponse } from '@/workers/route.worker'

// В Node нет Web Worker, подменяем объектом, который асинхронно гоняет настоящий обработчик и решатель
class FakeWorker {
  static instances: FakeWorker[] = []
  static failToStart = false
  // false - тест сам отвечает за воркер через emit
  static autoRun = true
  onmessage: ((event: MessageEvent<RouteWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: unknown[] = []
  terminated = 0

  constructor() {
    if (FakeWorker.failToStart) throw new Error('Worker is not supported')
    FakeWorker.instances.push(this)
  }

  postMessage(data: unknown): void {
    this.posted.push(data)
    if (!FakeWorker.autoRun) return
    setTimeout(() => handleRouteMessage(structuredClone(data), (msg) => this.emit(msg)))
  }

  emit(msg: RouteWorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<RouteWorkerResponse>)
  }

  terminate(): void {
    this.terminated++
  }
}

vi.mock('@/workers/route.worker?worker&inline', () => ({ default: FakeWorker }))

const { solveInWorker, SolveCancelledError, SolveFailedError } = await import('@/services/routeSolver')

const row: SolveInput = {
  points: [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ],
  closed: false,
  algorithm: 'auto',
  thetaMaxDeg: 180,
}

beforeEach(() => {
  FakeWorker.instances = []
  FakeWorker.failToStart = false
  FakeWorker.autoRun = true
})

describe('расчёт маршрута в воркере', () => {
  it('отправляет запрос, передаёт прогресс и отдаёт результат; воркер после этого закрывается', async () => {
    const progress: SolveProgress[] = []
    const handle = solveInWorker(row, (p) => progress.push(p))
    const result = await handle.promise
    expect(result.visit).toEqual([2, 3, 1])
    expect(result.lengthM).toBeCloseTo(300, 9)
    expect(progress.length).toBeGreaterThan(0)
    const [worker] = FakeWorker.instances
    expect(worker.posted).toEqual([{ type: 'solve', input: row }])
    expect(worker.terminated).toBe(1)
    // Отмена после результата ничего не ломает
    handle.cancel()
    expect(worker.terminated).toBe(1)
  })

  it('ошибка решателя — SolveFailedError с причиной', async () => {
    const handle = solveInWorker({ ...row, points: [] })
    await expect(handle.promise).rejects.toBeInstanceOf(SolveFailedError)
    await expect(handle.promise).rejects.toThrow(/взлёта/)
    expect(FakeWorker.instances[0].terminated).toBe(1)
  })

  it('отмена: воркер останавливается, обещание отклоняется SolveCancelledError, поздние сообщения игнорируются', async () => {
    FakeWorker.autoRun = false
    const progress: SolveProgress[] = []
    const handle = solveInWorker(row, (p) => progress.push(p))
    const [worker] = FakeWorker.instances
    worker.emit({ type: 'progress', progress: { iteration: 1, total: 5, bestLengthM: 700 } })
    handle.cancel()
    handle.cancel()
    await expect(handle.promise).rejects.toBeInstanceOf(SolveCancelledError)
    expect(worker.terminated).toBe(1)
    worker.emit({ type: 'progress', progress: { iteration: 2, total: 5, bestLengthM: 500 } })
    worker.emit({ type: 'result', result: { visit: [2, 3, 1], lengthM: 300, turnViolations: 0, iterations: 5, algorithm: 'auto' } })
    expect(progress).toEqual([{ iteration: 1, total: 5, bestLengthM: 700 }])
  })

  it('сбой воркера и нечитаемое сообщение — SolveFailedError', async () => {
    FakeWorker.autoRun = false
    const crashed = solveInWorker(row)
    const preventDefault = vi.fn()
    FakeWorker.instances[0].onerror?.({ message: 'out of memory', preventDefault } as unknown as ErrorEvent)
    await expect(crashed.promise).rejects.toThrow('out of memory')
    await expect(crashed.promise).rejects.toBeInstanceOf(SolveFailedError)
    expect(preventDefault).toHaveBeenCalled()
    expect(FakeWorker.instances[0].terminated).toBe(1)

    const garbled = solveInWorker(row)
    FakeWorker.instances[1].onmessageerror?.()
    await expect(garbled.promise).rejects.toBeInstanceOf(SolveFailedError)
    expect(FakeWorker.instances[1].terminated).toBe(1)
  })

  it('воркер не запустился — SolveFailedError, а не исключение из solveInWorker', async () => {
    FakeWorker.failToStart = true
    const handle = solveInWorker(row)
    await expect(handle.promise).rejects.toBeInstanceOf(SolveFailedError)
    expect(() => handle.cancel()).not.toThrow()
  })
})
