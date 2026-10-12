import { describe, expect, it } from 'vitest'
import { durationParts, formatConfidence, formatDecimal, formatMegabytes } from '../format'

describe('форматирование', () => {
  it('уверенность — две цифры после запятой по языку', () => {
    expect(formatConfidence(0.87, 'ru')).toBe('0,87')
    expect(formatConfidence(0.1, 'ru')).toBe('0,10')
    expect(formatConfidence(0.873, 'en')).toBe('0.87')
  })

  it('десятичные — без лишних нулей, не больше заданного числа знаков', () => {
    expect(formatDecimal(0.145, 'ru')).toBe('0,145')
    expect(formatDecimal(2.5, 'ru', 1)).toBe('2,5')
    expect(formatDecimal(3, 'en')).toBe('3')
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
