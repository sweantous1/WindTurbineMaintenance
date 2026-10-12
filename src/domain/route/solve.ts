import type { RouteAlgorithm } from '@/domain/types'
import type { LocalPoint } from '@/lib/geo'
import { DEFAULT_ACO_PARAMS, runAco, type AcoParams, type SearchHooks, type SearchOutcome } from './aco'
import { DEFAULT_GA_PARAMS, runGa, type GaParams, type GaSelection } from './ga'
import { createRouteModel, pathCost, pathFromVisit, visitCost, visitFromPath, visitLengthM, type RouteModel } from './matrix'
import { nearestNeighborVisit } from './nearestNeighbor'
import { orOpt } from './orOpt'
import { mulberry32, randInt, shuffleInPlace, type Rng } from './random'
import { countTurnViolations } from './turns'
import { IMPROVE_EPS_M, twoOpt } from './twoOpt'

export { DEFAULT_ACO_PARAMS, DEFAULT_GA_PARAMS }
export type { AcoParams, GaParams }

export interface SolveInput {
  // [0] - взлёт, 1..n - турбины, локальные метры (makeLocalFrame)
  points: LocalPoint[]
  // Возврат на взлёт
  closed: boolean
  algorithm: RouteAlgorithm
  // ACO: iterations, ants, alpha, beta, rho, q, seed; GA: generations, population, mutationRate,
  // crossoverRate, seed, selection (0 турнир, 1 рулетка); auto: seed
  params?: Record<string, number>
  // 180 = без ограничения
  thetaMaxDeg: number
}

export interface SolveProgress {
  iteration: number
  total: number
  bestLengthM: number
}

export interface SolveResult {
  // Турбины 1..n в порядке облёта
  visit: number[]
  // Длина без штрафов, с возвратом если closed
  lengthM: number
  turnViolations: number
  iterations: number
  algorithm: RouteAlgorithm
}

// Не чаще 10 раз в секунду, postMessage не бесплатный
const PROGRESS_INTERVAL_MS = 100

// auto: число поисков под n, чтобы работа была примерно одинаковой (поиск ~n^2).
// 20 турбин - 20 стартов + 200 встрясок, 200 турбин - всего 10 поисков
const AUTO_WORK = 200_000
const AUTO_MIN_RUNS = 10
const AUTO_KICKS_PER_TURBINE = 6
// На малых n поиск дешёвый, а с ограничением угла воронки узкие - встрясок больше
const AUTO_MIN_KICKS = 200
// Принимаем результат встряски, если он хуже лучшего не больше чем на 5%, так поиск перелезает через штрафы
const ILS_ACCEPT_WORSE = 0.05
const SCRAMBLE_MIN = 3
const SCRAMBLE_SPREAD = 6

export function solveRoute(
  input: SolveInput,
  onProgress?: (p: SolveProgress) => void,
  shouldStop?: () => boolean,
): SolveResult {
  validateInput(input)
  const model = createRouteModel(input.points, input.closed, input.thetaMaxDeg)
  const stop = shouldStop ?? (() => false)

  let lastReportMs = -Infinity
  const report = (iteration: number, total: number, bestVisit: ArrayLike<number>) => {
    if (!onProgress) return
    const now = performance.now()
    if (now - lastReportMs < PROGRESS_INTERVAL_MS) return
    lastReportMs = now
    onProgress({ iteration, total, bestLengthM: visitLengthM(model, bestVisit) })
  }
  const hooks: SearchHooks = { shouldStop: stop, onIteration: report }

  let visit: ArrayLike<number>
  let iterations: number
  if (model.n <= 2) {
    visit = solveTiny(model)
    iterations = 1
  } else if (input.algorithm === 'auto') {
    const out = solveAuto(model, readSeed(input.params), hooks)
    visit = out.visit
    iterations = out.iterations
  } else {
    const out =
      input.algorithm === 'aco'
        ? runAco(model, readAcoParams(input.params), hooks)
        : runGa(model, readGaParams(input.params), readSelection(input.params), hooks)
    visit = out.stopped ? out.visit : polishTwoOpt(model, out, stop)
    iterations = out.iterations
  }

  return {
    visit: Array.from(visit),
    lengthM: visitLengthM(model, visit),
    turnViolations: countTurnViolations(model, visit),
    iterations,
    algorithm: input.algorithm,
  }
}

// Вход приходит через postMessage, типы там ничего не гарантируют
function validateInput(input: SolveInput): void {
  if (!Array.isArray(input.points) || input.points.length === 0) throw new Error('Для расчёта маршрута нужна точка взлёта')
  for (const p of input.points) {
    if (typeof p !== 'object' || p === null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error('Координаты точек маршрута должны быть числами')
    }
  }
  if (typeof input.closed !== 'boolean') throw new Error('Не указано, возвращается ли дрон к точке взлёта')
  if (!Number.isFinite(input.thetaMaxDeg)) throw new Error('Предельный угол поворота должен быть числом')
  if (input.algorithm !== 'auto' && input.algorithm !== 'aco' && input.algorithm !== 'ga') {
    throw new Error(`Неизвестный алгоритм маршрута: ${String(input.algorithm)}`)
  }
}

// До двух турбин просто перебор
function solveTiny(model: RouteModel): number[] {
  if (model.n === 0) return []
  if (model.n === 1) return [1]
  return visitCost(model, [2, 1]) < visitCost(model, [1, 2]) - IMPROVE_EPS_M ? [2, 1] : [1, 2]
}

function polishTwoOpt(model: RouteModel, out: SearchOutcome, stop: () => boolean): number[] {
  const path = pathFromVisit(model, out.visit)
  twoOpt(model, path, stop)
  // На всякий случай: доводка не должна ухудшать
  return pathCost(model, path) <= out.cost ? visitFromPath(model, path) : Array.from(out.visit)
}

// 2-opt и Or-opt по очереди, пока есть улучшения
function localSearch(model: RouteModel, path: Int32Array, stop: () => boolean): void {
  for (;;) {
    twoOpt(model, path, stop)
    if (stop() || !orOpt(model, path, stop) || stop()) return
  }
}

// auto: мультистарт ближайшего соседа + локальный поиск, потом встряски (double bridge / перемешивание участка).
// rng с seed, так что результат детерминирован
function solveAuto(model: RouteModel, seed: number, hooks: SearchHooks): { visit: number[]; iterations: number } {
  const { n } = model
  const runs = Math.max(AUTO_MIN_RUNS, Math.floor(AUTO_WORK / (n * n)))
  const starts = pickStarts(model, Math.min(n, Math.ceil(runs / 2)))
  const kicks = Math.min(runs - starts.length, Math.max(AUTO_MIN_KICKS, AUTO_KICKS_PER_TURBINE * n))
  const total = starts.length + kicks

  let best = pathFromVisit(model, nearestNeighborVisit(model))
  let bestCost = pathCost(model, best)
  let iterations = 0
  const bestVisit = () => best.subarray(1, n + 1)

  for (const first of starts) {
    if (hooks.shouldStop()) break
    const path = pathFromVisit(model, nearestNeighborVisit(model, first))
    localSearch(model, path, hooks.shouldStop)
    const cost = pathCost(model, path)
    if (cost < bestCost - IMPROVE_EPS_M) {
      best = path
      bestCost = cost
    }
    iterations++
    hooks.onIteration(iterations, total, bestVisit())
  }

  const rng = mulberry32(seed)
  let current = best
  for (let k = 0; k < kicks; k++) {
    if (hooks.shouldStop()) break
    const path = current.slice()
    if (k % 2 === 0) doubleBridge(path, n, rng)
    else scrambleSegment(path, n, rng)
    localSearch(model, path, hooks.shouldStop)
    const cost = pathCost(model, path)
    if (cost < bestCost - IMPROVE_EPS_M) {
      best = path
      bestCost = cost
    }
    if (cost < bestCost * (1 + ILS_ACCEPT_WORSE)) current = path
    iterations++
    hooks.onIteration(iterations, total, bestVisit())
  }

  return { visit: visitFromPath(model, best), iterations }
}

// Стартовые турбины: все или равномерная выборка по удалённости от взлёта
function pickStarts(model: RouteModel, count: number): number[] {
  const { n, dist } = model
  const byDistance = Array.from({ length: n }, (_, k) => k + 1).sort((a, b) => dist[a] - dist[b] || a - b)
  if (count >= n) return byDistance
  return Array.from({ length: count }, (_, k) => byDistance[Math.floor((k * n) / count)])
}

// double bridge на path[1..n]: A B C D -> A C B D, 2-opt и Or-opt так за один ход не умеют
function doubleBridge(path: Int32Array, n: number, rng: Rng): void {
  const p1 = randInt(rng, n - 1)
  const p2 = p1 + 1 + randInt(rng, n - 1 - p1)
  const p3 = p2 + 1 + randInt(rng, n - p2)
  const visit = path.slice(1, n + 1)
  const reordered = [...visit.subarray(0, p1), ...visit.subarray(p2, p3), ...visit.subarray(p1, p2), ...visit.subarray(p3)]
  path.set(reordered, 1)
}

// Перемешать короткий участок: с ограничением угла так находятся узкие воронки,
// куда double bridge не попадает
function scrambleSegment(path: Int32Array, n: number, rng: Rng): void {
  const len = Math.min(n, SCRAMBLE_MIN + randInt(rng, SCRAMBLE_SPREAD))
  const start = 1 + randInt(rng, n - len + 1)
  shuffleInPlace(path.subarray(start, start + len), rng)
}

// Параметры от пользователя

type Range = { min: number; max: number; integer?: boolean }

// Не число -> fallback, выход за границы обрезаем
function readNumber(params: Record<string, number> | undefined, key: string, fallback: number, range: Range): number {
  const raw = params?.[key]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  const value = range.integer ? Math.round(raw) : raw
  return Math.min(range.max, Math.max(range.min, value))
}

const SEED_RANGE: Range = { min: 0, max: 0xffffffff, integer: true }

function readSeed(params: Record<string, number> | undefined): number {
  return readNumber(params, 'seed', 1, SEED_RANGE)
}

function readAcoParams(params: Record<string, number> | undefined): AcoParams {
  const d = DEFAULT_ACO_PARAMS
  return {
    iterations: readNumber(params, 'iterations', d.iterations, { min: 1, max: 100_000, integer: true }),
    ants: readNumber(params, 'ants', d.ants, { min: 1, max: 10_000, integer: true }),
    alpha: readNumber(params, 'alpha', d.alpha, { min: 0, max: 10 }),
    beta: readNumber(params, 'beta', d.beta, { min: 0, max: 20 }),
    rho: readNumber(params, 'rho', d.rho, { min: 0.001, max: 1 }),
    q: readNumber(params, 'q', d.q, { min: 1e-6, max: 1e12 }),
    seed: readNumber(params, 'seed', d.seed, SEED_RANGE),
  }
}

function readGaParams(params: Record<string, number> | undefined): GaParams {
  const d = DEFAULT_GA_PARAMS
  return {
    generations: readNumber(params, 'generations', d.generations, { min: 1, max: 100_000, integer: true }),
    population: readNumber(params, 'population', d.population, { min: 2, max: 10_000, integer: true }),
    mutationRate: readNumber(params, 'mutationRate', d.mutationRate, { min: 0, max: 1 }),
    crossoverRate: readNumber(params, 'crossoverRate', d.crossoverRate, { min: 0, max: 1 }),
    seed: readNumber(params, 'seed', d.seed, SEED_RANGE),
  }
}

function readSelection(params: Record<string, number> | undefined): GaSelection {
  return params?.selection === 1 ? 'roulette' : 'tournament'
}
