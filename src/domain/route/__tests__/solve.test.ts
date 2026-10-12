import { describe, expect, it, vi } from 'vitest'
import type { LocalPoint } from '@/lib/geo'
import { DEFAULT_ACO_PARAMS, DEFAULT_GA_PARAMS, solveRoute, type SolveInput, type SolveProgress } from '../index'
import { heldKarp } from '../heldKarp'
import { createRouteModel, visitCost } from '../matrix'
import { nearestNeighborVisit } from '../nearestNeighbor'
import { mulberry32, type Rng } from '../random'
import { countTurnViolations } from '../turns'

function randomPoints(rng: Rng, count: number, spanM = 3000): LocalPoint[] {
  return Array.from({ length: count }, () => ({ x: rng() * spanM, y: rng() * spanM }))
}

function isPermutation(visit: number[], n: number): boolean {
  return [...visit].sort((a, b) => a - b).every((v, k) => v === k + 1) && visit.length === n
}

// Стоимость маршрута и оптимум в одной целевой функции (длина + штрафы)
function costAndOptimum(input: SolveInput, visit: number[]) {
  const model = createRouteModel(input.points, input.closed, input.thetaMaxDeg)
  return { cost: visitCost(model, visit), optimum: heldKarp(model).cost }
}

describe('«Авто»', () => {
  it.each([
    [false, 180],
    [true, 180],
    [false, 90],
    [true, 90],
  ])('на случайных наборах до 10 турбин не хуже 1,01 × оптимума (closed=%s, θmax=%s°)', (closed, theta) => {
    const rng = mulberry32(closed ? 2024 : 2025)
    for (let n = 3; n <= 10; n++) {
      for (let trial = 0; trial < 8; trial++) {
        const input: SolveInput = { points: randomPoints(rng, n + 1), closed, algorithm: 'auto', thetaMaxDeg: theta }
        const result = solveRoute(input)
        expect(isPermutation(result.visit, n)).toBe(true)
        const { cost, optimum } = costAndOptimum(input, result.visit)
        expect(cost).toBeLessThanOrEqual(optimum * 1.01 + 1e-6)
      }
    }
  })

  it('детерминирован', () => {
    const input: SolveInput = { points: randomPoints(mulberry32(8), 31), closed: true, algorithm: 'auto', thetaMaxDeg: 120 }
    expect(solveRoute(input)).toEqual(solveRoute(input))
  })

  it('21 точка считается быстрее 50 мс', () => {
    const points = randomPoints(mulberry32(21), 21)
    for (const closed of [true, false]) {
      const started = performance.now()
      const result = solveRoute({ points, closed, algorithm: 'auto', thetaMaxDeg: 180 })
      const elapsedMs = performance.now() - started
      expect(isPermutation(result.visit, 20)).toBe(true)
      expect(elapsedMs).toBeLessThan(50)
    }
  })

  it('с ограничением угла 21 точка укладывается в четверть секунды', () => {
    // Со штрафами поиск заметно дороже, но он всё равно в воркере
    const points = randomPoints(mulberry32(21), 21)
    for (const theta of [90, 45]) {
      const started = performance.now()
      const result = solveRoute({ points, closed: true, algorithm: 'auto', thetaMaxDeg: theta })
      expect(performance.now() - started).toBeLessThan(250)
      expect(isPermutation(result.visit, 20)).toBe(true)
    }
  })
})

describe('ACO и GA', () => {
  it.each(['aco', 'ga'] as const)('%s: одинаковый seed — одинаковый результат, на 8 турбинах не хуже 1,05 × оптимума', (algorithm) => {
    const rng = mulberry32(algorithm === 'aco' ? 81 : 82)
    for (let trial = 0; trial < 4; trial++) {
      for (const closed of [false, true]) {
        const input: SolveInput = { points: randomPoints(rng, 9), closed, algorithm, thetaMaxDeg: 180 }
        const first = solveRoute(input)
        expect(solveRoute(input)).toEqual(first)
        expect(first.algorithm).toBe(algorithm)
        expect(first.iterations).toBe(algorithm === 'aco' ? DEFAULT_ACO_PARAMS.iterations : DEFAULT_GA_PARAMS.generations)
        expect(isPermutation(first.visit, 8)).toBe(true)
        const { cost, optimum } = costAndOptimum(input, first.visit)
        expect(cost).toBeLessThanOrEqual(optimum * 1.05 + 1e-6)
      }
    }
  })

  it('seed действительно влияет на поиск', () => {
    const points = randomPoints(mulberry32(5), 41)
    const runs = [1, 2, 3].map((seed) =>
      solveRoute({ points, closed: true, algorithm: 'aco', thetaMaxDeg: 180, params: { seed, iterations: 30 } }),
    )
    // За 30 итераций на 40 турбинах разные seed дают разные маршруты
    expect(new Set(runs.map((r) => r.visit.join(','))).size).toBeGreaterThan(1)
  })

  it('с ограничением угла (и рулеточным отбором) не хуже «ближайшего соседа», с которого начинают', () => {
    const rng = mulberry32(6)
    for (let trial = 0; trial < 5; trial++) {
      const points = randomPoints(rng, 12)
      const model = createRouteModel(points, false, 60)
      const nnCost = visitCost(model, nearestNeighborVisit(model))
      for (const algorithm of ['aco', 'ga'] as const) {
        const result = solveRoute({
          points,
          closed: false,
          algorithm,
          thetaMaxDeg: 60,
          params: { iterations: 20, generations: 20, selection: trial % 2 },
        })
        expect(isPermutation(result.visit, 11)).toBe(true)
        expect(visitCost(model, result.visit)).toBeLessThanOrEqual(nnCost + 1e-6)
      }
    }
  })

  it('негодные параметры заменяются допустимыми', () => {
    const points = randomPoints(mulberry32(7), 7)
    const aco = solveRoute({
      points,
      closed: true,
      algorithm: 'aco',
      thetaMaxDeg: 180,
      params: { iterations: Number.NaN, ants: -5, rho: 7, beta: Infinity },
    })
    expect(aco.iterations).toBe(DEFAULT_ACO_PARAMS.iterations)
    const ga = solveRoute({ points, closed: true, algorithm: 'ga', thetaMaxDeg: 180, params: { population: 1, generations: 3.4 } })
    expect(ga.iterations).toBe(3)
    expect(isPermutation(ga.visit, 6)).toBe(true)
  })
})

describe('ограничение угла поворота', () => {
  // Два параллельных ряда по три турбины: кратчайший путь - змейка с поворотом на 90 градусов у каждой турбины,
  // с пределом 60 выгоднее пройти по одному ряду и вернуться по другому (два крутых поворота)
  const points: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 20 },
    { x: 200, y: 20 },
    { x: 200, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 20 },
  ]

  it('штраф меняет порядок облёта', () => {
    const free = solveRoute({ points, closed: false, algorithm: 'auto', thetaMaxDeg: 180 })
    expect(free.visit).toEqual([1, 2, 3, 4, 5, 6])
    expect(free.lengthM).toBeCloseTo(360, 6)
    expect(free.turnViolations).toBe(0)

    const limited = solveRoute({ points, closed: false, algorithm: 'auto', thetaMaxDeg: 60 })
    const strictModel = createRouteModel(points, false, 60)
    expect(countTurnViolations(strictModel, free.visit)).toBe(5)
    expect(limited.visit).not.toEqual(free.visit)
    expect(limited.turnViolations).toBeLessThan(5)
    expect(limited.lengthM).toBeGreaterThan(free.lengthM)
    // И это оптимум со штрафами
    expect(visitCost(strictModel, limited.visit)).toBeCloseTo(heldKarp(strictModel).cost, 6)
  })

  it('ряд с взлётом посередине: сначала к ближнему краю, разворот неизбежен — ровно одно нарушение', () => {
    // Турбины через 100 м от 0 до 1000, взлёт в 450: 450 до левого края + 1000 вдоль ряда = 1450 м
    // (с правого края 1550), разворот на краю 180 градусов
    const line: LocalPoint[] = [{ x: 450, y: 0 }, ...Array.from({ length: 11 }, (_, k) => ({ x: k * 100, y: 0 }))]
    for (const algorithm of ['auto', 'aco', 'ga'] as const) {
      const result = solveRoute({ points: line, closed: false, algorithm, thetaMaxDeg: 90 })
      if (algorithm === 'auto') {
        expect(result.visit).toEqual([5, 4, 3, 2, 1, 6, 7, 8, 9, 10, 11])
        expect(result.lengthM).toBeCloseTo(1450, 9)
      } else {
        expect(result.lengthM).toBeLessThanOrEqual(1450 * 1.05)
      }
      expect(result.turnViolations).toBe(1)
    }
  })

  it('больше 65 точек (штрафы считаются без таблицы): маршрут корректен и не хуже «ближайшего соседа»', () => {
    const scattered = randomPoints(mulberry32(70), 71)
    const model = createRouteModel(scattered, true, 75)
    const nnCost = visitCost(model, nearestNeighborVisit(model))
    const result = solveRoute({ points: scattered, closed: true, algorithm: 'auto', thetaMaxDeg: 75 })
    expect(isPermutation(result.visit, 70)).toBe(true)
    expect(result.turnViolations).toBe(countTurnViolations(model, result.visit))
    expect(visitCost(model, result.visit)).toBeLessThan(nnCost)
  })

  it('недостижимый предел — не отказ: маршрут строится, нарушения считаются', () => {
    const result = solveRoute({ points, closed: true, algorithm: 'auto', thetaMaxDeg: 0 })
    expect(isPermutation(result.visit, 6)).toBe(true)
    expect(result.turnViolations).toBeGreaterThan(0)
  })
})

describe('вырожденные случаи', () => {
  it('без турбин, с одной и с двумя', () => {
    const takeoff = { x: 0, y: 0 }
    for (const algorithm of ['auto', 'aco', 'ga'] as const) {
      const none = solveRoute({ points: [takeoff], closed: true, algorithm, thetaMaxDeg: 90 })
      expect(none).toMatchObject({ visit: [], lengthM: 0, turnViolations: 0, algorithm })

      const one = solveRoute({ points: [takeoff, { x: 30, y: 40 }], closed: true, algorithm, thetaMaxDeg: 180 })
      expect(one.visit).toEqual([1])
      expect(one.lengthM).toBeCloseTo(100, 9)

      // Сначала дальняя, потом ближняя - длиннее
      const two = solveRoute({
        points: [takeoff, { x: 200, y: 0 }, { x: 100, y: 0 }],
        closed: false,
        algorithm,
        thetaMaxDeg: 180,
      })
      expect(two.visit).toEqual([2, 1])
      expect(two.lengthM).toBeCloseTo(200, 9)
    }
  })

  it('совпадающие точки не ломают расчёт', () => {
    const points = [{ x: 0, y: 0 }, ...Array.from({ length: 6 }, () => ({ x: 50, y: 50 })), { x: 0, y: 0 }]
    for (const algorithm of ['auto', 'aco', 'ga'] as const) {
      const result = solveRoute({ points, closed: true, algorithm, thetaMaxDeg: 30, params: { iterations: 10, generations: 10 } })
      expect(isPermutation(result.visit, 7)).toBe(true)
      expect(Number.isFinite(result.lengthM)).toBe(true)
    }
  })

  it('некорректный вход — понятная ошибка', () => {
    expect(() => solveRoute({ points: [], closed: false, algorithm: 'auto', thetaMaxDeg: 180 })).toThrow(/взлёта/)
    expect(() =>
      solveRoute({ points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }], closed: false, algorithm: 'auto', thetaMaxDeg: 180 }),
    ).toThrow(/числами/)
    expect(() => solveRoute({ points: [{ x: 0, y: 0 }], closed: false, algorithm: 'x' as never, thetaMaxDeg: 180 })).toThrow()
  })
})

describe('прогресс и остановка', () => {
  it('прогресс приходит не чаще 10 раз в секунду', () => {
    const points = randomPoints(mulberry32(9), 61)
    const events: { at: number; p: SolveProgress }[] = []
    solveRoute({ points, closed: true, algorithm: 'aco', thetaMaxDeg: 180, params: { iterations: 60 } }, (p) =>
      events.push({ at: performance.now(), p }),
    )
    expect(events.length).toBeGreaterThan(0)
    for (let k = 1; k < events.length; k++) expect(events[k].at - events[k - 1].at).toBeGreaterThanOrEqual(99)
    for (const { p } of events) {
      expect(p.total).toBe(60)
      expect(p.iteration).toBeGreaterThanOrEqual(1)
      expect(p.bestLengthM).toBeGreaterThan(0)
    }
  })

  it.each(['auto', 'aco', 'ga'] as const)('%s: прогресс согласован — номер растёт, лучшая длина не растёт, итог не хуже', (algorithm) => {
    // Без ограничения угла стоимость = длина, так что лучшая длина только уменьшается
    const points = randomPoints(mulberry32(12), 41)
    const events: SolveProgress[] = []
    let clock = 0
    // Часы идут по 150 мс за вызов, так троттлинг не отбрасывает ни одного события
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 150))
    try {
      const result = solveRoute({ points, closed: true, algorithm, thetaMaxDeg: 180, params: { iterations: 15, generations: 15 } }, (p) =>
        events.push(p),
      )
      expect(events.length).toBe(result.iterations)
      events.forEach((p, k) => {
        expect(p.iteration).toBe(k + 1)
        expect(p.total).toBe(events[0].total)
        if (k > 0) expect(p.bestLengthM).toBeLessThanOrEqual(events[k - 1].bestLengthM + 1e-9)
      })
      expect(events.at(-1)!.iteration).toBeLessThanOrEqual(events[0].total)
      expect(result.lengthM).toBeLessThanOrEqual(events.at(-1)!.bestLengthM + 1e-9)
    } finally {
      now.mockRestore()
    }
  })

  it('«Авто» с одним и тем же seed повторяется, параметр seed принимается', () => {
    const points = randomPoints(mulberry32(13), 26)
    const run = (seed: number) => solveRoute({ points, closed: false, algorithm: 'auto', thetaMaxDeg: 100, params: { seed } })
    expect(run(7)).toEqual(run(7))
    expect(isPermutation(run(8).visit, 25)).toBe(true)
  })

  it('shouldStop прерывает расчёт и возвращает лучшее найденное', () => {
    const points = randomPoints(mulberry32(10), 41)
    for (const algorithm of ['auto', 'aco', 'ga'] as const) {
      let calls = 0
      const result = solveRoute({ points, closed: false, algorithm, thetaMaxDeg: 180 }, undefined, () => ++calls > 3)
      expect(isPermutation(result.visit, 40)).toBe(true)
      expect(result.iterations).toBeLessThan(5)
      expect(result.lengthM).toBeGreaterThan(0)
    }
  })
})
