import { describe, expect, it } from 'vitest'
import { heldKarp } from '../heldKarp'
import { createRouteModel, visitCost, type RouteModel } from '../matrix'
import { mulberry32 } from '../random'

function* permutations(items: number[]): Generator<number[]> {
  if (items.length <= 1) {
    yield items
    return
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) yield [items[i], ...tail]
  }
}

function bruteForce(model: RouteModel): number {
  let best = Infinity
  for (const perm of permutations(Array.from({ length: model.n }, (_, k) => k + 1))) {
    best = Math.min(best, visitCost(model, perm))
  }
  return best
}

describe('Хелд — Карп', () => {
  it.each([
    [false, 180],
    [true, 180],
    [false, 70],
    [true, 70],
  ])('совпадает с полным перебором (closed=%s, θmax=%s°)', (closed, theta) => {
    const rng = mulberry32(99)
    for (let n = 1; n <= 7; n++) {
      const pts = Array.from({ length: n + 1 }, () => ({ x: rng() * 1000, y: rng() * 1000 }))
      const model = createRouteModel(pts, closed, theta)
      const exact = heldKarp(model)
      expect(exact.cost).toBeCloseTo(bruteForce(model), 6)
      expect(visitCost(model, exact.visit)).toBeCloseTo(exact.cost, 6)
      expect([...exact.visit].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, k) => k + 1))
    }
  })

  it('больше 12 турбин не берётся', () => {
    const pts = Array.from({ length: 14 }, (_, k) => ({ x: k, y: 0 }))
    expect(() => heldKarp(createRouteModel(pts, false, 180))).toThrow()
  })
})
