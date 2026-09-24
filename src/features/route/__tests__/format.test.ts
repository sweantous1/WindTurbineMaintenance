import { describe, expect, it } from 'vitest'
import { formatInputNumber, formatKm, formatNumber } from '../format'
import { parseNumberInput } from '../optimizerParams'

describe('числа на экране маршрута', () => {
  it('в поле ввода — десятичный разделитель языка, и он читается обратно', () => {
    const range = { min: 0, max: 1e6 }
    for (const [lang, value, text] of [
      ['ru', 0.1, '0,1'],
      ['en', 0.1, '0.1'],
      ['ru', 4294967295, '4294967295'],
      ['ru', 1.5e-7, '1,5e-7'],
    ] as const) {
      expect(formatInputNumber(value, lang)).toBe(text)
      expect(parseNumberInput(formatInputNumber(value, lang), { ...range, max: 1e10 })).toBe(value)
    }
  })

  it('бесконечность и NaN не превращаются в «NaN км»', () => {
    expect(formatNumber(Infinity, 'ru')).toBe('∞')
    expect(formatNumber(Number.NaN, 'ru')).toBe('—')
    expect(formatKm(12345, 'en')).toBe('12.3')
    expect(formatKm(1234, 'en')).toBe('1.23')
  })
})
