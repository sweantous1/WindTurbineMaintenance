import type { RouteModel } from './matrix'
import { fillPathTurnPenalties } from './turns'

// Ход принимается, только если выигрыш больше этого порога: иначе ошибки округления
// могут зациклить поиск на равноценных ходах
export const IMPROVE_EPS_M = 1e-7

// 2-opt по полному пути (см. matrix.ts): разворот участка path[i..j].
// Взлёт в начале (и в конце для замкнутого маршрута) не двигается; у открытого
// маршрута разрешён разворот «хвоста» — так меняется последняя турбина.
// Углы внутри развёрнутого участка не меняются, пересчитываются только стыки
export function twoOptPass(model: RouteModel, path: Int32Array, shouldStop?: () => boolean): boolean {
  const m = path.length
  const last = model.closed ? m - 2 : m - 1
  if (last < 2) return false
  const { dist, size } = model
  const pen = model.rule.limited ? new Float64Array(m) : null
  if (pen) fillPathTurnPenalties(model, path, pen)

  // Узел на позиции k после разворота [i..j]
  let ri = 0
  let rj = 0
  const at = (k: number) => (k >= ri && k <= rj ? path[ri + rj - k] : path[k])
  const turnAt = (k: number) => (k > 0 && k < m - 1 ? model.turnPenalty(at(k - 1), at(k), at(k + 1)) : 0)

  let improved = false
  for (let i = 1; i < last; i++) {
    if (shouldStop?.()) break
    for (let j = i + 1; j <= last; j++) {
      const a = path[i - 1]
      const b = path[i]
      const c = path[j]
      let delta = dist[a * size + c] - dist[a * size + b]
      const hasNext = j + 1 < m
      if (hasNext) {
        const d = path[j + 1]
        delta += dist[b * size + d] - dist[c * size + d]
      }
      if (pen) {
        const oldPen = pen[i - 1] + pen[i] + pen[j] + (hasNext ? pen[j + 1] : 0)
        // Новые штрафы неотрицательны: если даже их обнуление не окупает ход, углы не считаем
        if (delta - oldPen >= -IMPROVE_EPS_M) continue
        ri = i
        rj = j
        // Новые штрафы только добавляются: как только ход перестал окупаться, дальше не считаем
        delta -= oldPen
        if (delta < -IMPROVE_EPS_M) delta += turnAt(i - 1)
        if (delta < -IMPROVE_EPS_M) delta += turnAt(i)
        if (delta < -IMPROVE_EPS_M) delta += turnAt(j)
        if (delta < -IMPROVE_EPS_M && hasNext) delta += turnAt(j + 1)
      }
      if (delta < -IMPROVE_EPS_M) {
        reverseRange(path, i, j)
        improved = true
        if (pen) fillPathTurnPenalties(model, path, pen)
      }
    }
  }
  return improved
}

export function twoOpt(model: RouteModel, path: Int32Array, shouldStop?: () => boolean): boolean {
  let improved = false
  while (twoOptPass(model, path, shouldStop)) {
    improved = true
    if (shouldStop?.()) break
  }
  return improved
}

export function reverseRange(arr: Int32Array, i: number, j: number): void {
  while (i < j) {
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
    i++
    j--
  }
}
