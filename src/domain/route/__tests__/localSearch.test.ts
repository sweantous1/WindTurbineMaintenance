import { describe, expect, it } from 'vitest'
import type { LocalPoint } from '@/lib/geo'
import { createRouteModel, pathCost, pathFromVisit, type RouteModel } from '../matrix'
import { nearestNeighborVisit } from '../nearestNeighbor'
import { moveSegment, OR_OPT_MAX_SEGMENT, orOpt } from '../orOpt'
import { mulberry32, shuffleInPlace, type Rng } from '../random'
import { reverseRange, twoOpt } from '../twoOpt'

function randomPoints(rng: Rng, count: number): LocalPoint[] {
  return Array.from({ length: count }, () => ({ x: Math.round(rng() * 2000), y: Math.round(rng() * 2000) }))
}

function randomPath(model: RouteModel, rng: Rng): Int32Array {
  return pathFromVisit(model, shuffleInPlace(Int32Array.from({ length: model.n }, (_, k) => k + 1), rng))
}

// Все ходы 2-opt в лоб, полным пересчётом стоимости
function bestTwoOptGain(model: RouteModel, path: Int32Array): number {
  const m = path.length
  const last = model.closed ? m - 2 : m - 1
  const base = pathCost(model, path)
  let gain = 0
  for (let i = 1; i < last; i++) {
    for (let j = i + 1; j <= last; j++) {
      const copy = path.slice()
      reverseRange(copy, i, j)
      gain = Math.max(gain, base - pathCost(model, copy))
    }
  }
  return gain
}

function bestOrOptGain(model: RouteModel, path: Int32Array): number {
  const m = path.length
  const last = model.closed ? m - 2 : m - 1
  const base = pathCost(model, path)
  let gain = 0
  for (let s = 1; s <= last; s++) {
    for (let l = 1; l <= OR_OPT_MAX_SEGMENT && s + l - 1 <= last; l++) {
      const e = s + l - 1
      for (let p = 0; p <= last; p++) {
        if (p >= s - 1 && p <= e) continue
        for (const rev of [false, true]) {
          const copy = path.slice()
          moveSegment(copy, s, e, p, rev)
          gain = Math.max(gain, base - pathCost(model, copy))
        }
      }
    }
  }
  return gain
}

describe('локальный поиск', () => {
  it('перенос цепочки совпадает с наивной перестановкой', () => {
    const path = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7])
    const forward = path.slice()
    moveSegment(forward, 2, 3, 5, false)
    expect(Array.from(forward)).toEqual([0, 1, 4, 5, 2, 3, 6, 7])
    const backward = path.slice()
    moveSegment(backward, 5, 6, 1, true)
    expect(Array.from(backward)).toEqual([0, 1, 6, 5, 2, 3, 4, 7])
  })

  // Дельты считаются по стыкам; если там ошибка, после поиска останется улучшающий ход
  it.each([
    [false, 180],
    [true, 180],
    [false, 100],
    [true, 100],
    [false, 45],
    [true, 30],
  ])('после поиска нет улучшающих ходов (closed=%s, θmax=%s°)', (closed, theta) => {
    const rng = mulberry32(closed ? 11 : 12)
    for (let trial = 0; trial < 15; trial++) {
      const model = createRouteModel(randomPoints(rng, 9), closed, theta)
      const path = randomPath(model, rng)
      const before = pathCost(model, path)

      twoOpt(model, path)
      const afterTwoOpt = pathCost(model, path)
      expect(afterTwoOpt).toBeLessThanOrEqual(before + 1e-9)
      expect(bestTwoOptGain(model, path)).toBeLessThan(1e-6)

      orOpt(model, path)
      expect(pathCost(model, path)).toBeLessThanOrEqual(afterTwoOpt + 1e-9)
      expect(bestOrOptGain(model, path)).toBeLessThan(1e-6)

      // Путь остаётся перестановкой со взлётом на концах
      expect(path[0]).toBe(0)
      if (closed) expect(path[path.length - 1]).toBe(0)
      expect(Array.from(path.subarray(1, model.n + 1)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    }
  })

  it('«ближайший сосед» с заданной первой турбиной начинает с неё и обходит всех', () => {
    const model = createRouteModel(randomPoints(mulberry32(3), 11), false, 180)
    for (let first = 1; first <= model.n; first++) {
      const visit = nearestNeighborVisit(model, first)
      expect(visit[0]).toBe(first)
      expect(Array.from(visit).sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, k) => k + 1))
    }
  })
})
