import type { SolveInput, SolveProgress, SolveResult } from '@/domain/route'
import type { RouteWorkerRequest, RouteWorkerResponse } from '@/workers/route.worker'
// inline (blob), т.к. под app:// в Electron отдельный файл воркера не всегда находится
import RouteWorker from '@/workers/route.worker?worker&inline'

// Отмена пользователем, как ошибку не показываем
export class SolveCancelledError extends Error {
  constructor() {
    super('Расчёт маршрута отменён')
    this.name = 'SolveCancelledError'
  }
}

// Сбой воркера или плохие входные данные; message - техническая подробность
export class SolveFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SolveFailedError'
  }
}

export interface SolveHandle {
  promise: Promise<SolveResult>
  cancel(): void
}

export function solveInWorker(input: SolveInput, onProgress?: (p: SolveProgress) => void): SolveHandle {
  let settled = false
  let rejectPromise: (reason: Error) => void = () => {}
  let worker: Worker | null = null

  const finish = () => {
    settled = true
    worker?.terminate()
    worker = null
  }

  const promise = new Promise<SolveResult>((resolve, reject) => {
    rejectPromise = reject
    try {
      worker = new RouteWorker()
    } catch (err) {
      finish()
      reject(new SolveFailedError(err instanceof Error ? err.message : String(err)))
      return
    }
    worker.onmessage = (event: MessageEvent<RouteWorkerResponse>) => {
      if (settled) return
      const msg = event.data
      if (msg.type === 'progress') {
        onProgress?.(msg.progress)
      } else if (msg.type === 'result') {
        finish()
        resolve(msg.result)
      } else {
        finish()
        reject(new SolveFailedError(msg.message))
      }
    }
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault()
      if (settled) return
      finish()
      reject(new SolveFailedError(event.message || 'Воркер маршрута завершился с ошибкой'))
    }
    worker.onmessageerror = () => {
      if (settled) return
      finish()
      reject(new SolveFailedError('Воркер маршрута прислал нечитаемое сообщение'))
    }
    const request: RouteWorkerRequest = { type: 'solve', input }
    worker.postMessage(request)
  })

  return {
    promise,
    cancel() {
      if (settled) return
      finish()
      rejectPromise(new SolveCancelledError())
    },
  }
}
