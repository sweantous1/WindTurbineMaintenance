import { describe, expect, it } from 'vitest'
import type { Candidate } from '../decode'
import { boxIou, nmsPerClass } from '../nms'

const box = (classIndex: number, score: number, x1: number, y1: number, x2: number, y2: number): Candidate => ({
  classIndex,
  score,
  x1,
  y1,
  x2,
  y2,
})

describe('boxIou', () => {
  it('пересечение, вложение, касание и вырожденные рамки', () => {
    expect(boxIou(box(0, 1, 0, 0, 10, 10), box(0, 1, 0, 0, 10, 10))).toBe(1)
    expect(boxIou(box(0, 1, 0, 0, 10, 10), box(0, 1, 5, 0, 15, 10))).toBeCloseTo(50 / 150, 12)
    expect(boxIou(box(0, 1, 0, 0, 10, 10), box(0, 1, 0, 0, 10, 5))).toBe(0.5)
    expect(boxIou(box(0, 1, 0, 0, 10, 10), box(0, 1, 10, 0, 20, 10))).toBe(0)
    expect(boxIou(box(0, 1, 0, 0, 0, 0), box(0, 1, 0, 0, 0, 0))).toBe(0)
  })
})

describe('nmsPerClass', () => {
  it('перекрывающиеся рамки одного класса схлопываются в самую уверенную', () => {
    const kept = nmsPerClass([box(2, 0.6, 1, 1, 101, 101), box(2, 0.9, 0, 0, 100, 100), box(2, 0.7, 2, 0, 102, 100)], 0.7)
    expect(kept).toEqual([box(2, 0.9, 0, 0, 100, 100)])
  })

  it('рамки разных классов на одном месте не подавляют друг друга', () => {
    const kept = nmsPerClass([box(0, 0.8, 0, 0, 100, 100), box(1, 0.7, 0, 0, 100, 100), box(0, 0.5, 1, 1, 99, 99)], 0.7)
    expect(kept.map((b) => [b.classIndex, b.score])).toEqual([
      [0, 0.8],
      [1, 0.7],
    ])
  })

  it('подавление строго при IoU больше порога', () => {
    const a = box(0, 0.9, 0, 0, 10, 10)
    const b = box(0, 0.8, 0, 0, 10, 5)
    expect(nmsPerClass([a, b], 0.5)).toHaveLength(2)
    expect(nmsPerClass([a, b], 0.49)).toEqual([a])
  })

  it('жадный порядок: подавленная рамка сама никого не подавляет', () => {
    const a = box(0, 0.9, 0, 0, 10, 10)
    const b = box(0, 0.8, 2, 0, 12, 10)
    const c = box(0, 0.7, 4, 0, 14, 10)
    // IoU(a, b) = 0.67, IoU(b, c) = 0.67, IoU(a, c) = 0.43
    expect(nmsPerClass([c, b, a], 0.5)).toEqual([a, c])
  })

  it('результат по убыванию уверенности, не длиннее maxDet; вход не меняется', () => {
    const input = [box(0, 0.3, 0, 0, 1, 1), box(1, 0.9, 5, 5, 6, 6), box(2, 0.5, 9, 9, 10, 10)]
    const copy = [...input]
    expect(nmsPerClass(input, 0.7).map((b) => b.score)).toEqual([0.9, 0.5, 0.3])
    expect(nmsPerClass(input, 0.7, 2).map((b) => b.score)).toEqual([0.9, 0.5])
    expect(input).toEqual(copy)
    expect(nmsPerClass([], 0.7)).toEqual([])
  })
})
