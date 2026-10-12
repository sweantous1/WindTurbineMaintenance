import { describe, expect, it } from 'vitest'
import { decodeYolo } from '../decode'

// Фейковый выход [1, 4 + nc, anchors]: на якорь cx, cy, w, h и вероятности классов
function yoloOutput(anchors: { box: [number, number, number, number]; probs: number[] }[]): { data: Float32Array; dims: number[] } {
  const nc = anchors[0].probs.length
  const n = anchors.length
  const data = new Float32Array((4 + nc) * n)
  anchors.forEach((a, i) => {
    a.box.forEach((v, row) => (data[row * n + i] = v))
    a.probs.forEach((p, c) => (data[(4 + c) * n + i] = p))
  })
  return { data, dims: [1, 4 + nc, n] }
}

describe('decodeYolo', () => {
  const { data, dims } = yoloOutput([
    { box: [100, 50, 20, 10], probs: [0.1, 0.9, 0.2] },
    { box: [300, 300, 64, 32], probs: [0.3, 0.2, 0.28] },
    { box: [10, 10, 4, 4], probs: [0.25, 0.1, 0.1] },
    { box: [20, 20, 4, 4], probs: [0.2, 0.2, 0.2] },
    { box: [30, 30, 4, 4], probs: [Number.NaN, Number.NaN, Number.NaN] },
    { box: [Number.NaN, 30, 4, 4], probs: [0.9, 0, 0] },
  ])

  it('класс — argmax, порог по его вероятности строго больше; cxcywh → xyxy во входных пикселях', () => {
    const got = decodeYolo(data, dims, { confidence: 0.25 })
    expect(got).toHaveLength(2)
    expect(got[0].classIndex).toBe(1)
    expect(got[0].score).toBeCloseTo(0.9, 6)
    expect([got[0].x1, got[0].y1, got[0].x2, got[0].y2]).toEqual([90, 45, 110, 55])
    // 0.28 тоже выше порога, но берём только лучший класс
    expect(got[1].classIndex).toBe(0)
    expect(got[1].score).toBeCloseTo(0.3, 6)
    expect([got[1].x1, got[1].y1, got[1].x2, got[1].y2]).toEqual([268, 284, 332, 316])
  })

  it('порог управляет отбором', () => {
    expect(decodeYolo(data, dims, { confidence: 0.5 }).map((c) => c.classIndex)).toEqual([1])
    expect(decodeYolo(data, dims, { confidence: 0.19 })).toHaveLength(4)
    expect(decodeYolo(data, dims, { confidence: 0.95 })).toEqual([])
  })

  it('при равных вероятностях — первый класс, как torch.max', () => {
    const tie = yoloOutput([{ box: [5, 5, 2, 2], probs: [0.4, 0.6, 0.6] }])
    expect(decodeYolo(tie.data, tie.dims, { confidence: 0.25 })[0].classIndex).toBe(1)
  })

  it('форма выхода проверяется, в том числе по числу классов манифеста', () => {
    expect(() => decodeYolo(data, [1, 7, 6, 1], { confidence: 0.25 })).toThrow(/форма/)
    expect(() => decodeYolo(data, [2, 7, 6], { confidence: 0.25 })).toThrow(/форма/)
    expect(() => decodeYolo(data, [1, 7, 60], { confidence: 0.25 })).toThrow(/короче/)
    expect(() => decodeYolo(data, dims, { confidence: 0.25, numClasses: 7 })).toThrow(/7/)
    expect(decodeYolo(data, dims, { confidence: 0.25, numClasses: 3 })).toHaveLength(2)
  })

  it('размер как у модели дефектов: [1, 11, 8400]', () => {
    const anchors = 8400
    const out = new Float32Array(11 * anchors)
    // Уверенный якорь в самом конце, проверяем индексацию
    const a = anchors - 1
    out[a] = 320
    out[anchors + a] = 200
    out[2 * anchors + a] = 40
    out[3 * anchors + a] = 60
    out[(4 + 6) * anchors + a] = 0.8
    const got = decodeYolo(out, [1, 11, anchors], { confidence: 0.25, numClasses: 7 })
    expect(got).toEqual([{ classIndex: 6, score: Math.fround(0.8), x1: 300, y1: 170, x2: 340, y2: 230 }])
    // Транспонированный выход [1, 8400, 11] (другой экспорт) должен падать, а не читаться как мусор
    expect(() => decodeYolo(out, [1, anchors, 11], { confidence: 0.25, numClasses: 7 })).toThrow(/8396/)
  })
})
