import type { LocalPoint } from '@/lib/geo'
import { makeTurnEvaluator, makeTurnRule, type TurnRule } from './turns'

// Точка 0 - взлёт, 1..n - турбины. visit - только турбины по порядку,
// path - с взлётом в начале (и в конце для closed), длина n + 1 или n + 2

export interface RouteModel {
  // Число турбин
  n: number
  // n + 1 (со взлётом), сторона матрицы
  size: number
  closed: boolean
  pathSize: number
  points: LocalPoint[]
  // Метры, dist[i * size + j]
  dist: Float64Array
  rule: TurnRule
  // Штраф за поворот в b на пути a -> b -> c и нарушение ли это
  turnPenalty(a: number, b: number, c: number): number
  turnViolates(a: number, b: number, c: number): boolean
}

export function buildDistanceMatrix(points: LocalPoint[]): Float64Array {
  const size = points.length
  const dist = new Float64Array(size * size)
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const d = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y)
      dist[i * size + j] = d
      dist[j * size + i] = d
    }
  }
  return dist
}

export function createRouteModel(points: LocalPoint[], closed: boolean, thetaMaxDeg: number): RouteModel {
  const size = points.length
  const n = size - 1
  const dist = buildDistanceMatrix(points)
  let maxDistM = 0
  for (let k = 0; k < dist.length; k++) if (dist[k] > maxDistM) maxDistM = dist[k]
  const rule = makeTurnRule(thetaMaxDeg, maxDistM)
  const turns = makeTurnEvaluator(points, dist, rule)
  return {
    n,
    size,
    closed,
    pathSize: n + 1 + (closed && n > 0 ? 1 : 0),
    points,
    dist,
    rule,
    turnPenalty: turns.penalty,
    turnViolates: turns.violates,
  }
}

export function pathFromVisit(model: RouteModel, visit: ArrayLike<number>): Int32Array {
  const path = new Int32Array(model.pathSize)
  for (let k = 0; k < visit.length; k++) path[k + 1] = visit[k]
  // Взлёт по краям = 0, Int32Array и так в нулях
  return path
}

export function visitFromPath(model: RouteModel, path: Int32Array): number[] {
  return Array.from(path.subarray(1, model.n + 1))
}

// Длина взлёт -> турбины -> (взлёт)
export function visitLengthM(model: RouteModel, visit: ArrayLike<number>): number {
  const { dist, size } = model
  let total = 0
  let cur = 0
  for (let k = 0; k < visit.length; k++) {
    total += dist[cur * size + visit[k]]
    cur = visit[k]
  }
  if (model.closed) total += dist[cur * size]
  return total
}

// Длина + штрафы за крутые повороты
export function visitCost(model: RouteModel, visit: ArrayLike<number>): number {
  if (!model.rule.limited) return visitLengthM(model, visit)
  const { dist, size } = model
  let total = 0
  let prev = -1
  let cur = 0
  for (let k = 0; k <= visit.length; k++) {
    if (k === visit.length && !model.closed) break
    const next = k < visit.length ? visit[k] : 0
    total += dist[cur * size + next]
    if (prev >= 0) total += model.turnPenalty(prev, cur, next)
    prev = cur
    cur = next
  }
  return total
}

export function pathCost(model: RouteModel, path: Int32Array): number {
  const { dist, size } = model
  let total = 0
  for (let q = 1; q < path.length; q++) {
    total += dist[path[q - 1] * size + path[q]]
    if (q < path.length - 1) total += model.turnPenalty(path[q - 1], path[q], path[q + 1])
  }
  return total
}
