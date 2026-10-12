import type { RouteModel } from './matrix'

// Ближайший сосед от взлёта, firstTurbine для мультистарта.
// Штраф за поворот учитываем сразу, иначе получаются зигзаги, которые потом плохо распутываются
export function nearestNeighborVisit(model: RouteModel, firstTurbine?: number): Int32Array {
  const { n, size, dist } = model
  const visit = new Int32Array(n)
  if (n === 0) return visit
  const used = new Uint8Array(size)
  used[0] = 1
  let prev = -1
  let cur = 0
  for (let k = 0; k < n; k++) {
    let next = -1
    if (k === 0 && firstTurbine !== undefined && firstTurbine >= 1 && firstTurbine <= n) {
      next = firstTurbine
    } else {
      let bestCost = Infinity
      for (let j = 1; j < size; j++) {
        if (used[j]) continue
        let cost = dist[cur * size + j]
        if (prev >= 0) cost += model.turnPenalty(prev, cur, j)
        if (cost < bestCost) {
          bestCost = cost
          next = j
        }
      }
    }
    visit[k] = next
    used[next] = 1
    prev = cur
    cur = next
  }
  return visit
}
