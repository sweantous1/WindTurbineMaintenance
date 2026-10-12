import type { RouteModel } from './matrix'
import { fillPathTurnPenalties } from './turns'
import { IMPROVE_EPS_M } from './twoOpt'

// Or-opt: переносим цепочку из 1-3 турбин в другое место (можно развёрнутой).
// 2-opt так не умеет, он разворачивает всё между
export const OR_OPT_MAX_SEGMENT = 3

export function orOptPass(model: RouteModel, path: Int32Array, shouldStop?: () => boolean): boolean {
  const m = path.length
  // Последняя позиция и для переноса, и для вставки после неё
  const last = model.closed ? m - 2 : m - 1
  if (last < 2) return false
  const { dist, size } = model
  const pen = model.rule.limited ? new Float64Array(m) : null
  if (pen) fillPathTurnPenalties(model, path, pen)

  // Текущий ход: path[s..e] встаёт между p и p + 1
  let s = 0
  let e = 0
  let len = 0
  let p = 0
  let rev = false
  const seg = (idx: number) => (rev ? path[e - idx] : path[s + idx])
  // Узел на позиции k после хода
  const at = (k: number) => {
    if (p > e) {
      if (k < s || k > p) return path[k]
      return k <= p - len ? path[k + len] : seg(k - (p - len + 1))
    }
    if (k <= p || k > e) return path[k]
    return k <= p + len ? seg(k - p - 1) : path[k - len]
  }
  // Куда переедет узел с позиции q
  const newPos = (q: number) => {
    if (p > e) {
      if (q < s || q > p) return q
      return q <= e ? p - len + 1 + (rev ? e - q : q - s) : q - len
    }
    if (q <= p || q > e) return q
    return q < s ? q + len : p + 1 + (rev ? e - q : q - s)
  }
  const turnAt = (k: number) => (k > 0 && k < m - 1 ? model.turnPenalty(at(k - 1), at(k), at(k + 1)) : 0)

  // Позиции, у которых меняются соседи
  const touched = new Int32Array(6)
  let touchedCount = 0
  const touch = (q: number) => {
    if (q >= m) return
    for (let k = 0; k < touchedCount; k++) if (touched[k] === q) return
    touched[touchedCount++] = q
  }

  let improved = false
  outer: for (let si = 1; si <= last; si++) {
    if (shouldStop?.()) break
    for (let l = 1; l <= OR_OPT_MAX_SEGMENT; l++) {
      const ei = si + l - 1
      if (ei > last) break
      const a = path[si - 1]
      const first = path[si]
      const lastNode = path[ei]
      const hasB = ei + 1 < m
      const b = hasB ? path[ei + 1] : -1
      const removeGain = dist[a * size + first] + (hasB ? dist[lastNode * size + b] - dist[a * size + b] : 0)

      for (let pi = 0; pi <= last; pi++) {
        if (pi >= si - 1 && pi <= ei) continue
        const c = path[pi]
        const hasD = pi + 1 < m
        const d = hasD ? path[pi + 1] : -1
        for (let r = 0; r < (l > 1 ? 2 : 1); r++) {
          const head = r === 0 ? first : lastNode
          const tail = r === 0 ? lastNode : first
          let delta = dist[c * size + head] + (hasD ? dist[tail * size + d] - dist[c * size + d] : 0) - removeGain
          if (pen) {
            // Грубая верхняя оценка (позиции могут повторяться), если даже она не окупает ход - пропускаем
            const upperPen = pen[si - 1] + pen[si] + pen[ei] + (hasB ? pen[ei + 1] : 0) + pen[pi] + (hasD ? pen[pi + 1] : 0)
            if (delta - upperPen >= -IMPROVE_EPS_M) continue
            s = si
            e = ei
            len = l
            p = pi
            rev = r === 1
            touchedCount = 0
            touch(si - 1)
            touch(si)
            touch(ei)
            touch(ei + 1)
            touch(pi)
            touch(pi + 1)
            let oldPen = 0
            for (let k = 0; k < touchedCount; k++) oldPen += pen[touched[k]]
            if (delta - oldPen >= -IMPROVE_EPS_M) continue
            // Новые штрафы только растут, считаем пока ход окупается
            delta -= oldPen
            for (let k = 0; k < touchedCount && delta < -IMPROVE_EPS_M; k++) delta += turnAt(newPos(touched[k]))
          }
          if (delta < -IMPROVE_EPS_M) {
            moveSegment(path, si, ei, pi, r === 1)
            improved = true
            if (pen) fillPathTurnPenalties(model, path, pen)
            continue outer
          }
        }
      }
    }
  }
  return improved
}

export function orOpt(model: RouteModel, path: Int32Array, shouldStop?: () => boolean): boolean {
  let improved = false
  while (orOptPass(model, path, shouldStop)) {
    improved = true
    if (shouldStop?.()) break
  }
  return improved
}

// path[s..e] встаёт между прежними p и p + 1
export function moveSegment(path: Int32Array, s: number, e: number, p: number, reversed: boolean): void {
  const len = e - s + 1
  const buf = path.slice(s, e + 1)
  if (reversed) buf.reverse()
  if (p > e) {
    for (let k = s; k <= p - len; k++) path[k] = path[k + len]
    path.set(buf, p - len + 1)
  } else {
    for (let k = e; k >= p + len + 1; k--) path[k] = path[k - len]
    path.set(buf, p + 1)
  }
}
