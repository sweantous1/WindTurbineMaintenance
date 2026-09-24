import { describe, expect, it } from 'vitest'
import { durationParts, formatConfidence, formatDecimal, formatMegabytes, manifestRecall, recallPercent } from '../format'

describe('форматирование', () => {
  it('уверенность — две цифры после запятой по языку', () => {
    expect(formatConfidence(0.87, 'ru')).toBe('0,87')
    expect(formatConfidence(0.1, 'ru')).toBe('0,10')
    expect(formatConfidence(0.873, 'en')).toBe('0.87')
  })

  it('recall 0,145 — это примерно 15%, а не 14 из-за двоичной погрешности', () => {
    expect(0.145 * 100).toBeLessThan(14.5)
    expect(recallPercent(0.145)).toBe(15)
    expect(recallPercent(0.5)).toBe(50)
    expect(formatDecimal(0.145, 'ru')).toBe('0,145')
  })

  it('recall берётся из metrics, только если это число 0..1', () => {
    expect(manifestRecall({ recall: 0.145 })).toBe(0.145)
    expect(manifestRecall({ recall: '0.145' })).toBeUndefined()
    expect(manifestRecall({ recall: 14.5 })).toBeUndefined()
    expect(manifestRecall(undefined)).toBeUndefined()
  })

  it('длительность: до 10 с — с десятыми, дальше целые, с минуты — минуты и секунды', () => {
    expect(durationParts(840)).toEqual({ minutes: 0, seconds: 0.8 })
    expect(durationParts(42_400)).toEqual({ minutes: 0, seconds: 42 })
    expect(durationParts(192_000)).toEqual({ minutes: 3, seconds: 12 })
    expect(durationParts(Number.NaN)).toEqual({ minutes: 0, seconds: 0 })
  })

  it('мегабайты с одной цифрой после запятой', () => {
    expect(formatMegabytes(12_345_678, 'ru')).toBe('11,8')
  })
})
