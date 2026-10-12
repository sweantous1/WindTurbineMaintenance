import { solveRoute, type SolveInput, type SolveProgress, type SolveResult } from '@/domain/route'

// Отдельный поток: на сотне турбин ACO и GA считают секунды

export interface RouteWorkerRequest {
  type: 'solve'
  input: SolveInput
}

export type RouteWorkerResponse =
  | { type: 'progress'; progress: SolveProgress }
  | { type: 'result'; result: SolveResult }
  | { type: 'error'; message: string }

// Отдельно от self, чтобы тестировать без воркера
export function handleRouteMessage(data: unknown, post: (msg: RouteWorkerResponse) => void): void {
  const request = data as Partial<RouteWorkerRequest> | null
  if (request?.type !== 'solve' || !request.input) {
    post({ type: 'error', message: 'Воркер маршрута получил неизвестное сообщение' })
    return
  }
  try {
    const result = solveRoute(request.input, (progress) => post({ type: 'progress', progress }))
    post({ type: 'result', result })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

// В tsconfig нет lib WebWorker, описываем нужное сами
interface RouteWorkerScope {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: RouteWorkerResponse): void
}

// Только внутри воркера: в Node (тесты) нет self, в основном потоке есть document
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const scope = self as unknown as RouteWorkerScope
  scope.onmessage = (event) => handleRouteMessage(event.data, (msg) => scope.postMessage(msg))
}
