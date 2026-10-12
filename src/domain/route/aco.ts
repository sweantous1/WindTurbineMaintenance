import { visitCost, type RouteModel } from './matrix'
import { nearestNeighborVisit } from './nearestNeighbor'
import { mulberry32 } from './random'

// Ant System с элитным муравьём: вес перехода i->j = tau^alpha * eta^beta, eta = 1/dist.
// При ограничении угла к dist добавляем штраф за поворот, иначе получаются зигзаги

export type AcoParams = {
  iterations: number
  ants: number
  alpha: number
  beta: number
  rho: number
  q: number
  seed: number
}

export const DEFAULT_ACO_PARAMS: Readonly<AcoParams> = {
  iterations: 200,
  ants: 50,
  alpha: 1,
  beta: 2,
  rho: 0.1,
  q: 100,
  seed: 1,
}

export interface SearchHooks {
  shouldStop(): boolean
  onIteration(iteration: number, total: number, bestVisit: Int32Array): void
}

export interface SearchOutcome {
  visit: Int32Array
  cost: number
  iterations: number
  stopped: boolean
}

// 1 см, чтобы совпадающие точки не давали eta = Infinity
const MIN_DIST_M = 0.01
// Пол для феромона, иначе за тысячи итераций он уходит в ноль
const TAU_FLOOR_FRACTION = 1e-12

export function runAco(model: RouteModel, params: AcoParams, hooks: SearchHooks): SearchOutcome {
  const { n, size, dist } = model
  const rng = mulberry32(params.seed)

  let best = nearestNeighborVisit(model)
  let bestCost = visitCost(model, best)

  // Старт как будто все муравьи прошли маршрут ближайшего соседа
  const tau0 = bestCost > 0 ? (params.ants * params.q) / bestCost : 1
  const tauFloor = tau0 * TAU_FLOOR_FRACTION
  const tau = new Float64Array(size * size).fill(tau0)
  const etaBeta = new Float64Array(size * size)
  for (let k = 0; k < etaBeta.length; k++) etaBeta[k] = Math.pow(1 / Math.max(dist[k], MIN_DIST_M), params.beta)
  const tauAlpha = new Float64Array(size * size)
  const weight = new Float64Array(size * size)
  const stepWeight = new Float64Array(size)
  const limited = model.rule.limited

  const tours = new Int32Array(params.ants * n)
  const costs = new Float64Array(params.ants)
  const used = new Uint8Array(size)

  const deposit = (tour: Int32Array, amount: number) => {
    let cur = 0
    for (let k = 0; k < tour.length; k++) {
      const next = tour[k]
      tau[cur * size + next] += amount
      tau[next * size + cur] += amount
      cur = next
    }
    if (model.closed) {
      tau[cur * size] += amount
      tau[cur] += amount
    }
  }

  let iterations = 0
  let stopped = false
  for (let it = 0; it < params.iterations; it++) {
    if (hooks.shouldStop()) {
      stopped = true
      break
    }
    for (let k = 0; k < weight.length; k++) {
      tauAlpha[k] = params.alpha === 1 ? tau[k] : Math.pow(tau[k], params.alpha)
      weight[k] = tauAlpha[k] * etaBeta[k]
    }

    for (let ant = 0; ant < params.ants; ant++) {
      const tour = tours.subarray(ant * n, (ant + 1) * n)
      used.fill(0)
      used[0] = 1
      let prev = -1
      let cur = 0
      for (let step = 0; step < n; step++) {
        const row = cur * size
        let total = 0
        for (let j = 1; j < size; j++) {
          if (used[j]) continue
          let w = weight[row + j]
          if (limited && prev >= 0) {
            const penalty = model.turnPenalty(prev, cur, j)
            if (penalty > 0) w = tauAlpha[row + j] * Math.pow(1 / Math.max(dist[row + j] + penalty, MIN_DIST_M), params.beta)
          }
          stepWeight[j] = w
          total += w
        }
        let next = -1
        if (total > 0 && Number.isFinite(total)) {
          let r = rng() * total
          for (let j = 1; j < size; j++) {
            if (used[j]) continue
            next = j
            r -= stepWeight[j]
            if (r <= 0) break
          }
        } else {
          // Веса выродились (переполнение или 0), берём ближайшую
          let nearest = Infinity
          for (let j = 1; j < size; j++) {
            if (used[j]) continue
            const cost = dist[row + j] + (prev >= 0 ? model.turnPenalty(prev, cur, j) : 0)
            if (cost < nearest) {
              nearest = cost
              next = j
            }
          }
        }
        tour[step] = next
        used[next] = 1
        prev = cur
        cur = next
      }
      costs[ant] = visitCost(model, tour)
      if (costs[ant] < bestCost) {
        bestCost = costs[ant]
        best = tour.slice()
      }
    }

    for (let k = 0; k < tau.length; k++) tau[k] = Math.max(tauFloor, tau[k] * (1 - params.rho))
    for (let ant = 0; ant < params.ants; ant++) {
      deposit(tours.subarray(ant * n, (ant + 1) * n), params.q / Math.max(costs[ant], MIN_DIST_M))
    }
    deposit(best, params.q / Math.max(bestCost, MIN_DIST_M))

    iterations = it + 1
    hooks.onIteration(iterations, params.iterations, best)
  }

  return { visit: best, cost: bestCost, iterations, stopped }
}
