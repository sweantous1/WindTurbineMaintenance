import type { RouteModel } from './matrix'

// Хелд-Карп, точный оптимум. Только для тестов, растёт как 2^n
export const HELD_KARP_MAX_N = 12

export interface ExactSolution {
  visit: number[]
  cost: number
}

// Оптимум длины + штрафов. С ограничением угла в состоянии ещё и предпоследняя точка (штраф зависит от тройки)
export function heldKarp(model: RouteModel): ExactSolution {
  const { n } = model
  if (n > HELD_KARP_MAX_N) throw new Error(`Точный перебор поддерживает до ${HELD_KARP_MAX_N} турбин, получено ${n}`)
  if (n === 0) return { visit: [], cost: 0 }
  return model.rule.limited ? withTurns(model) : plain(model)
}

function plain(model: RouteModel): ExactSolution {
  const { n, size, dist } = model
  const full = (1 << n) - 1
  // dp[mask * size + last] - лучший путь от взлёта через mask с концом в last
  const dp = new Float64Array((full + 1) * size).fill(Infinity)
  const parent = new Int8Array((full + 1) * size).fill(-1)
  for (let k = 1; k <= n; k++) dp[(1 << (k - 1)) * size + k] = dist[k]
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 1; last <= n; last++) {
      const cur = dp[mask * size + last]
      if (cur === Infinity) continue
      for (let j = 1; j <= n; j++) {
        const bit = 1 << (j - 1)
        if (mask & bit) continue
        const idx = (mask | bit) * size + j
        const cost = cur + dist[last * size + j]
        if (cost < dp[idx]) {
          dp[idx] = cost
          parent[idx] = last
        }
      }
    }
  }
  let best = Infinity
  let bestLast = 1
  for (let last = 1; last <= n; last++) {
    const cost = dp[full * size + last] + (model.closed ? dist[last * size] : 0)
    if (cost < best) {
      best = cost
      bestLast = last
    }
  }
  const visit: number[] = []
  let mask = full
  let last = bestLast
  while (last > 0) {
    visit.push(last)
    const prev = parent[mask * size + last]
    mask &= ~(1 << (last - 1))
    last = prev
  }
  return { visit: visit.reverse(), cost: best }
}

function withTurns(model: RouteModel): ExactSolution {
  const { n, size, dist } = model
  const full = (1 << n) - 1
  // (mask, last, prev), prev = 0 - до last летели прямо со взлёта
  const index = (mask: number, last: number, prev: number) => (mask * size + last) * size + prev
  const dp = new Float64Array((full + 1) * size * size).fill(Infinity)
  const parent = new Int8Array((full + 1) * size * size).fill(-1)
  for (let k = 1; k <= n; k++) dp[index(1 << (k - 1), k, 0)] = dist[k]
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 1; last <= n; last++) {
      if (!(mask & (1 << (last - 1)))) continue
      for (let prev = 0; prev <= n; prev++) {
        const cur = dp[index(mask, last, prev)]
        if (cur === Infinity) continue
        for (let j = 1; j <= n; j++) {
          const bit = 1 << (j - 1)
          if (mask & bit) continue
          const idx = index(mask | bit, j, last)
          const cost = cur + dist[last * size + j] + model.turnPenalty(prev, last, j)
          if (cost < dp[idx]) {
            dp[idx] = cost
            parent[idx] = prev
          }
        }
      }
    }
  }
  let best = Infinity
  let bestLast = 1
  let bestPrev = 0
  for (let last = 1; last <= n; last++) {
    for (let prev = 0; prev <= n; prev++) {
      const base = dp[index(full, last, prev)]
      if (base === Infinity) continue
      const cost = model.closed ? base + dist[last * size] + model.turnPenalty(prev, last, 0) : base
      if (cost < best) {
        best = cost
        bestLast = last
        bestPrev = prev
      }
    }
  }
  const visit: number[] = []
  let mask = full
  let last = bestLast
  let prev = bestPrev
  while (last > 0) {
    visit.push(last)
    const pp = parent[index(mask, last, prev)]
    mask &= ~(1 << (last - 1))
    last = prev
    prev = pp
  }
  return { visit: visit.reverse(), cost: best }
}
