import type { LocalPoint } from '@/lib/geo'
import type { RouteModel } from './matrix'

// Короче миллиметра считаем точкой, поворота нет
const MIN_LEG_M = 1e-3
// Чтобы поворот ровно на предельный угол (например прямые углы сетки) не считался нарушением из-за округления
const COS_TOLERANCE = 1e-12
const DEG = 180 / Math.PI
// До стольких точек считаем таблицу штрафов всех троек заранее, 65^3 чисел ~ 2 МБ
const TURN_TABLE_MAX_SIZE = 65

// Штраф ~ размер фермы: объезд выгоден, пока он не длиннее самой фермы.
// При равном числе нарушений выигрывает более пологий поворот
export const TURN_PENALTY_FACTOR = 1

// Отклонение в b на пути a -> b -> c: 0 прямо, 180 разворот
export function turnAngleDeg(a: LocalPoint, b: LocalPoint, c: LocalPoint): number {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const wx = c.x - b.x
  const wy = c.y - b.y
  if (Math.hypot(ux, uy) < MIN_LEG_M || Math.hypot(wx, wy) < MIN_LEG_M) return 0
  return Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)) * DEG
}

export interface TurnRule {
  // false при 180, тогда углы не считаем
  limited: boolean
  thetaMaxDeg: number
  penaltyPerViolationM: number
}

export function makeTurnRule(thetaMaxDeg: number, scaleM: number): TurnRule {
  const theta = Math.min(180, Math.max(0, thetaMaxDeg))
  return {
    limited: theta < 180,
    thetaMaxDeg: theta,
    penaltyPerViolationM: TURN_PENALTY_FACTOR * scaleM,
  }
}

export interface TurnEvaluator {
  // 0 если не круче предела, иначе база + доля за каждый лишний градус
  penalty(a: number, b: number, c: number): number
  violates(a: number, b: number, c: number): boolean
}

// Единичные векторы рёбер считаем заранее: проверка = скалярное произведение, acos только при нарушении
export function makeTurnEvaluator(points: LocalPoint[], dist: Float64Array, rule: TurnRule): TurnEvaluator {
  if (!rule.limited) return { penalty: () => 0, violates: () => false }
  const size = points.length
  const ux = new Float64Array(size * size)
  const uy = new Float64Array(size * size)
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const d = dist[i * size + j]
      if (d < MIN_LEG_M) continue
      ux[i * size + j] = (points[j].x - points[i].x) / d
      uy[i * size + j] = (points[j].y - points[i].y) / d
    }
  }
  const cosLimit = Math.cos(rule.thetaMaxDeg / DEG) - COS_TOLERANCE
  // NaN - одно из плеч нулевое, поворота нет
  const cosAt = (a: number, b: number, c: number) => {
    const ab = a * size + b
    const bc = b * size + c
    if (dist[ab] < MIN_LEG_M || dist[bc] < MIN_LEG_M) return Number.NaN
    return ux[ab] * ux[bc] + uy[ab] * uy[bc]
  }
  const penalty = (a: number, b: number, c: number) => {
    const cos = cosAt(a, b, c)
    if (!(cos < cosLimit)) return 0
    const angleDeg = Math.acos(Math.max(-1, cos)) * DEG
    return rule.penaltyPerViolationM * (1 + Math.max(0, angleDeg - rule.thetaMaxDeg) / 180)
  }
  const violates = (a: number, b: number, c: number) => cosAt(a, b, c) < cosLimit
  if (size > TURN_TABLE_MAX_SIZE) return { penalty, violates }

  // Небольшая ферма - кладём все тройки в таблицу, так в разы быстрее
  const table = new Float64Array(size * size * size)
  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      for (let c = 0; c < size; c++) table[(a * size + b) * size + c] = penalty(a, b, c)
    }
  }
  return { penalty: (a, b, c) => table[(a * size + b) * size + c], violates }
}

// Нарушения на маршруте взлёт -> visit -> (взлёт), на взлёте и в конце поворота нет
export function countTurnViolations(model: RouteModel, visit: ArrayLike<number>): number {
  if (!model.rule.limited) return 0
  let count = 0
  let prev = -1
  let cur = 0
  const step = (next: number) => {
    if (prev >= 0 && model.turnViolates(prev, cur, next)) count++
    prev = cur
    cur = next
  }
  for (let k = 0; k < visit.length; k++) step(visit[k])
  if (model.closed && visit.length > 0) step(0)
  return count
}

// Штрафы по позициям пути (на концах 0), чтобы локальный поиск быстро отсеивал ходы
export function fillPathTurnPenalties(model: RouteModel, path: Int32Array, out: Float64Array): void {
  const m = path.length
  out[0] = 0
  out[m - 1] = 0
  for (let q = 1; q < m - 1; q++) out[q] = model.turnPenalty(path[q - 1], path[q], path[q + 1])
}
