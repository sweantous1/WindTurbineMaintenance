import { describe, expect, it } from 'vitest'
import { orderCrossover } from '../ga'
import { mulberry32, randInt, shuffleInPlace } from '../random'

describe('генератор случайных чисел', () => {
  it('одинаковый seed — одинаковая последовательность, разный — разная', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const c = mulberry32(43)
    const seqA = Array.from({ length: 20 }, () => a())
    expect(Array.from({ length: 20 }, () => b())).toEqual(seqA)
    expect(Array.from({ length: 20 }, () => c())).not.toEqual(seqA)
  })

  it('значения в [0, 1), целые — в заданном диапазоне', () => {
    const rng = mulberry32(1)
    for (let k = 0; k < 10_000; k++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      const i = randInt(rng, 7)
      expect(Number.isInteger(i) && i >= 0 && i < 7).toBe(true)
    }
  })

  it('OX: отрезок первого родителя на своих местах, остальное — по кругу после него в порядке второго', () => {
    // Разрез a = 2, b = 4 (randInt от 8: 0,3 → 2; 0,55 → 4). У второго родителя с позиции 5
    // по кругу: 5 3 1 8 6 4 2 7; без взятых 3 4 5 остаётся 1 8 6 2 7 — на позиции 5 6 7 0 1
    const cuts = [0.3, 0.55]
    const child = orderCrossover(Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8]), Int32Array.from([8, 6, 4, 2, 7, 5, 3, 1]), () => cuts.shift()!)
    expect(Array.from(child)).toEqual([2, 7, 3, 4, 5, 1, 8, 6])
  })

  it('тасование и кроссовер OX дают перестановку', () => {
    const rng = mulberry32(5)
    const sorted = (arr: Int32Array) => Array.from(arr).sort((x, y) => x - y)
    const ref = Array.from({ length: 12 }, (_, k) => k + 1)
    for (let k = 0; k < 200; k++) {
      const p1 = shuffleInPlace(Int32Array.from(ref), rng)
      const p2 = shuffleInPlace(Int32Array.from(ref), rng)
      expect(sorted(p1)).toEqual(ref)
      expect(sorted(orderCrossover(p1, p2, rng))).toEqual(ref)
    }
  })
})
