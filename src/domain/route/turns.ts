import type { LocalPoint } from '@/lib/geo'
import type { RouteModel } from './matrix'

// Отрезки короче миллиметра считаем точкой: направление у них не определено, поворота нет
const MIN_LEG_M = 1e-3
// Допуск в косинусах: поворот ровно на предельный угол (прямые углы сетки и т. п.)
// нарушением не считается, несмотря на ошибки округления
const COS_TOLERANCE = 1e-12
const DEG = 180 / Math.PI
// До стольких точек штрафы всех троек считаются заранее: 65³ чисел — около 2 МБ
const TURN_TABLE_MAX_SIZE = 65

// Штраф за нарушение — порядка поперечника фермы: объезд ради допустимого поворота выгоден,
// пока он не длиннее самой фермы; при равном числе нарушений выигрывает более пологий поворот
export const TURN_PENALTY_FACTOR = 1

// Отклонение от прямой в вершине b при полёте a → b → c: 0 — прямо, 180 — разворот назад
export function turnAngleDeg(a: LocalPoint, b: LocalPoint, c: LocalPoint): number {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const wx = c.x - b.x
  const wy = c.y - b.y
  if (Math.hypot(ux, uy) < MIN_LEG_M || Math.hypot(wx, wy) < MIN_LEG_M) return 0
  return Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)) * DEG
}

export interface TurnRule {
  // Есть ли ограничение вообще: при 180° любой поворот допустим, и углы не считаются
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
  // Штраф за поворот в вершине b на пути a → b → c (индексы точек): 0, если он не круче
  // предела, иначе база плюс доля за каждый лишний градус
  penalty(a: number, b: number, c: number): number
  violates(a: number, b: number, c: number): boolean
}

// Поворот проверяется тысячи раз за поиск, поэтому единичные векторы всех рёбер считаются
// заранее: проверка сводится к скалярному произведению, арккосинус — только при нарушении
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
  // Косинус угла отклонения; NaN — поворота нет (одно из плеч нулевое)
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

  // На небольших фермах все тройки помещаются в таблицу — поиск ускоряется в разы
  const table = new Float64Array(size * size * size)
  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      for (let c = 0; c < size; c++) table[(a * size + b) * size + c] = penalty(a, b, c)
    }
  }
  return { penalty: (a, b, c) => table[(a * size + b) * size + c], violates }
}

// Число нарушений на маршруте взлёт → visit → (взлёт). В точке взлёта и в конце пути поворота нет
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

// Штрафы во всех позициях пути (на концах — 0); локальный поиск держит их под рукой,
// чтобы быстро отбрасывать ходы, которые заведомо не окупаются
export function fillPathTurnPenalties(model: RouteModel, path: Int32Array, out: Float64Array): void {
  const m = path.length
  out[0] = 0
  out[m - 1] = 0
  for (let q = 1; q < m - 1; q++) out[q] = model.turnPenalty(path[q - 1], path[q], path[q + 1])
}
