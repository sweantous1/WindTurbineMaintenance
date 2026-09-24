import type { SearchHooks, SearchOutcome } from './aco'
import { visitCost, type RouteModel } from './matrix'
import { nearestNeighborVisit } from './nearestNeighbor'
import { mulberry32, randInt, shuffleInPlace, type Rng } from './random'

// Генетический алгоритм на перестановках турбин: отбор турниром (или рулеткой),
// упорядоченный кроссовер OX, мутация обменом или инверсией, лучшие особи переходят
// в следующее поколение без изменений

export type GaParams = {
  generations: number
  population: number
  mutationRate: number
  crossoverRate: number
  seed: number
}

export const DEFAULT_GA_PARAMS: Readonly<GaParams> = {
  generations: 200,
  population: 50,
  mutationRate: 0.1,
  crossoverRate: 0.8,
  seed: 1,
}

export type GaSelection = 'tournament' | 'roulette'

const TOURNAMENT_SIZE = 3
const ELITE_COUNT = 2
const DUPLICATE_RETRIES = 3

export function runGa(model: RouteModel, params: GaParams, selection: GaSelection, hooks: SearchHooks): SearchOutcome {
  const { n } = model
  const size = params.population
  const rng = mulberry32(params.seed)

  // Одна особь — маршрут «ближайшего соседа»: с ним популяция не начинает с чистого листа
  let pop: Int32Array[] = [nearestNeighborVisit(model)]
  while (pop.length < size) {
    const perm = new Int32Array(n)
    for (let k = 0; k < n; k++) perm[k] = k + 1
    pop.push(shuffleInPlace(perm, rng))
  }
  let costs = pop.map((v) => visitCost(model, v))

  let bestIdx = argMin(costs)
  let best = pop[bestIdx].slice()
  let bestCost = costs[bestIdx]
  const elites = Math.min(ELITE_COUNT, size - 1)

  const select = (): number => {
    if (selection === 'roulette') return rouletteSelect(costs, rng)
    let winner = randInt(rng, size)
    for (let k = 1; k < TOURNAMENT_SIZE; k++) {
      const rival = randInt(rng, size)
      if (costs[rival] < costs[winner]) winner = rival
    }
    return winner
  }

  let iterations = 0
  let stopped = false
  for (let gen = 0; gen < params.generations; gen++) {
    if (hooks.shouldStop()) {
      stopped = true
      break
    }
    const order = costs.map((_, i) => i).sort((a, b) => costs[a] - costs[b] || a - b)
    const next: Int32Array[] = []
    const seenKeys = new Set<string>()
    for (let k = 0; k < elites; k++) {
      next.push(pop[order[k]].slice())
      seenKeys.add(pop[order[k]].join(','))
    }
    while (next.length < size) {
      const a = select()
      const b = select()
      const child = rng() < params.crossoverRate ? orderCrossover(pop[a], pop[b], rng) : pop[a].slice()
      if (rng() < params.mutationRate) mutate(child, rng)
      // Копии уже взятых особей мутируют принудительно: без этого популяция быстро
      // вырождается в клоны одного маршрута и поиск останавливается
      let key = child.join(',')
      for (let attempt = 0; attempt < DUPLICATE_RETRIES && seenKeys.has(key); attempt++) {
        mutate(child, rng)
        key = child.join(',')
      }
      seenKeys.add(key)
      next.push(child)
    }
    pop = next
    costs = pop.map((v) => visitCost(model, v))
    bestIdx = argMin(costs)
    if (costs[bestIdx] < bestCost) {
      bestCost = costs[bestIdx]
      best = pop[bestIdx].slice()
    }
    iterations = gen + 1
    hooks.onIteration(iterations, params.generations, best)
  }

  return { visit: best, cost: bestCost, iterations, stopped }
}

function argMin(values: number[]): number {
  let idx = 0
  for (let k = 1; k < values.length; k++) if (values[k] < values[idx]) idx = k
  return idx
}

// Рулетка: шанс особи обратно пропорционален стоимости маршрута
function rouletteSelect(costs: number[], rng: Rng): number {
  let total = 0
  for (const c of costs) total += 1 / Math.max(c, 1e-9)
  let r = rng() * total
  for (let k = 0; k < costs.length; k++) {
    r -= 1 / Math.max(costs[k], 1e-9)
    if (r <= 0) return k
  }
  return costs.length - 1
}

// OX: отрезок [a..b] берётся у первого родителя, остальные позиции по кругу после b
// заполняются генами второго в его порядке
export function orderCrossover(p1: Int32Array, p2: Int32Array, rng: Rng): Int32Array {
  const n = p1.length
  const child = new Int32Array(n)
  if (n < 2) return p1.slice()
  let a = randInt(rng, n)
  let b = randInt(rng, n)
  if (a > b) [a, b] = [b, a]
  let maxGene = 0
  for (let k = 0; k < n; k++) if (p1[k] > maxGene) maxGene = p1[k]
  const taken = new Uint8Array(maxGene + 1)
  for (let k = a; k <= b; k++) {
    child[k] = p1[k]
    taken[p1[k]] = 1
  }
  let write = (b + 1) % n
  for (let k = 0; k < n; k++) {
    const gene = p2[(b + 1 + k) % n]
    if (taken[gene]) continue
    child[write] = gene
    write = (write + 1) % n
  }
  return child
}

function mutate(visit: Int32Array, rng: Rng): void {
  const n = visit.length
  if (n < 2) return
  let i = randInt(rng, n)
  let j = randInt(rng, n - 1)
  if (j >= i) j++
  if (rng() < 0.5) {
    const tmp = visit[i]
    visit[i] = visit[j]
    visit[j] = tmp
    return
  }
  if (i > j) [i, j] = [j, i]
  visit.subarray(i, j + 1).reverse()
}
