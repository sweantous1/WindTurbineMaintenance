import { describe, expect, it } from 'vitest'
import {
  addHours,
  compassPoint,
  DASH,
  farmLocalNow,
  formatBytes,
  formatClock,
  formatDay,
  formatNumber,
  formatTimeZone,
  formatUtcOffset,
  isPastHour,
  offsetShiftInForecast,
  parseLocalTime,
  snapshotAge,
  splitMinutes,
} from '../format'

const MOSCOW = { timezone: 'Europe/Moscow', utcOffsetSeconds: 10800 }

describe('числа', () => {
  it('русская запятая и английская точка, без лишних нулей', () => {
    expect(formatNumber(12.44, 'ru', 1)).toBe('12,4')
    expect(formatNumber(12.44, 'en', 1)).toBe('12.4')
    expect(formatNumber(12, 'ru', 1)).toBe('12')
  })

  it('нет значения — прочерк, а не 0 или NaN', () => {
    expect(formatNumber(null, 'ru')).toBe(DASH)
    expect(formatNumber(undefined, 'ru')).toBe(DASH)
    expect(formatNumber(Number.NaN, 'ru')).toBe(DASH)
    expect(formatNumber(Infinity, 'ru')).toBe(DASH)
  })

  it('значение, округлившееся до нуля, без «-0»', () => {
    expect(formatNumber(-0.04, 'ru', 1)).toBe('0')
    expect(formatNumber(-3.26, 'ru', 1)).toMatch(/^-3,3$/)
  })
})

describe('время фермы', () => {
  it('разбирается строкой, без часового пояса компьютера', () => {
    expect(parseLocalTime('2026-09-24T14:05')).toEqual({ year: 2026, month: 9, day: 24, hour: 14, minute: 5 })
    expect(parseLocalTime('вчера')).toBeNull()
    expect(formatClock('2026-09-24T07:00')).toBe('07:00')
    expect(formatClock('мусор')).toBe(DASH)
  })

  it('прибавление часов переходит через полночь, месяц и год', () => {
    expect(addHours('2026-09-24T23:00', 1)).toBe('2026-09-25T00:00')
    expect(addHours('2026-09-30T23:00', 2)).toBe('2026-10-01T01:00')
    expect(addHours('2026-12-31T23:00', 1)).toBe('2027-01-01T00:00')
    expect(addHours('2026-09-25T00:00', -1)).toBe('2026-09-24T23:00')
  })

  it('подпись дня — число того же дня, что и в строке', () => {
    expect(formatDay('2026-09-25T00:00', 'ru')).toContain('25')
    expect(formatDay('2026-09-25T23:00', 'en')).toContain('25')
  })

  it('смещение UTC', () => {
    expect(formatUtcOffset(10800)).toBe('UTC+3')
    expect(formatUtcOffset(19800)).toBe('UTC+5:30')
    expect(formatUtcOffset(-12600)).toBe('UTC-3:30')
    expect(formatUtcOffset(0)).toBe('UTC')
  })

  it('текущее время на ферме — по часовому поясу фермы, а не компьютера', () => {
    const now = new Date('2026-09-24T16:20:00Z')
    expect(farmLocalNow(MOSCOW, now)).toBe('2026-09-24T19:20')
    // Незнакомый движку пояс — по смещению из снимка
    expect(farmLocalNow({ timezone: 'Mars/Olympus', utcOffsetSeconds: 3600 }, now)).toBe('2026-09-24T17:20')
  })

  // Находка: Open-Meteo подписывает весь ряд одним смещением, без перехода на зимнее время.
  // Снимок получен 23.10 (+2), смотрим 26.10 в 09:30Z: по часам ряда это 11:30, а не 10:30
  it('«сейчас» и прошедшие часы — по смещению снимка, а не по переходу на зимнее время', () => {
    const berlin = { timezone: 'Europe/Berlin', utcOffsetSeconds: 7200 }
    const now = new Date('2026-10-26T09:30:00Z')
    expect(farmLocalNow(berlin, now)).toBe('2026-10-26T11:30')
    expect(isPastHour('2026-10-26T10:00', berlin, now)).toBe(true)
    expect(isPastHour('2026-10-26T11:00', berlin, now)).toBe(false)
    // Весной в Новой Зеландии: идущий час ряда (09:00 по +12) не считается прошедшим
    const auckland = { timezone: 'Pacific/Auckland', utcOffsetSeconds: 43200 }
    expect(isPastHour('2026-09-29T09:00', auckland, new Date('2026-09-28T21:30:00Z'))).toBe(false)
  })

  it('перевод часов в горизонте прогноза замечается', () => {
    const hourly = (from: string, to: string) => [{ time: from }, { time: to }] as Parameters<typeof offsetShiftInForecast>[0]['hourly']
    const berlin = { timezone: 'Europe/Berlin', utcOffsetSeconds: 7200 }
    // 23.10 → 29.10: 25.10 Берлин переходит на +1
    expect(offsetShiftInForecast({ ...berlin, hourly: hourly('2026-10-23T12:00', '2026-10-29T12:00') })).toBe(-3600)
    expect(offsetShiftInForecast({ ...berlin, hourly: hourly('2026-10-20T12:00', '2026-10-22T12:00') })).toBeNull()
    expect(offsetShiftInForecast({ ...MOSCOW, hourly: hourly('2026-10-23T12:00', '2026-10-29T12:00') })).toBeNull()
    expect(offsetShiftInForecast({ timezone: 'Mars/Olympus', utcOffsetSeconds: 3600, hourly: hourly('2026-10-23T12:00', '2026-10-29T12:00') })).toBeNull()
    expect(offsetShiftInForecast({ ...berlin, hourly: [] })).toBeNull()
  })

  it('текущий час ещё не прошёл, предыдущий — прошёл', () => {
    const now = new Date('2026-09-24T16:35:00Z') // 19:35 в Москве
    expect(isPastHour('2026-09-24T18:00', MOSCOW, now)).toBe(true)
    expect(isPastHour('2026-09-24T19:00', MOSCOW, now)).toBe(false)
    expect(isPastHour('2026-09-25T02:00', MOSCOW, now)).toBe(false)
  })

  it('возраст снимка', () => {
    const now = new Date('2026-09-24T16:20:00Z')
    expect(snapshotAge('2026-09-24T16:19:30Z', now)).toEqual({ unit: 'justNow', count: 0 })
    expect(snapshotAge('2026-09-24T15:55:00Z', now)).toEqual({ unit: 'minutes', count: 25 })
    expect(snapshotAge('2026-09-24T11:00:00Z', now)).toEqual({ unit: 'hours', count: 5 })
    expect(snapshotAge('2026-09-20T16:20:00Z', now)).toEqual({ unit: 'days', count: 4 })
    expect(snapshotAge('не дата', now)).toBeNull()
  })
})

describe('направление ветра', () => {
  it('восемь румбов, откуда дует', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(22.4)).toBe('N')
    expect(compassPoint(22.6)).toBe('NE')
    expect(compassPoint(315)).toBe('NW')
    expect(compassPoint(359)).toBe('N')
    expect(compassPoint(180)).toBe('S')
    expect(compassPoint(-45)).toBe('NW')
    expect(compassPoint(720 + 90)).toBe('E')
  })

  it('нет направления — нет румба', () => {
    expect(compassPoint(null)).toBeNull()
    expect(compassPoint(Number.NaN)).toBeNull()
  })
})

describe('прочее', () => {
  it('минуты раскладываются на часы и минуты', () => {
    expect(splitMinutes(21.4)).toEqual({ h: 0, m: 21 })
    expect(splitMinutes(85)).toEqual({ h: 1, m: 25 })
    expect(splitMinutes(59.6)).toEqual({ h: 1, m: 0 })
    expect(splitMinutes(Infinity)).toBeNull()
  })

  it('байты в удобных единицах', () => {
    expect(formatBytes(512, 'ru')).toEqual({ value: '512', unit: 'B' })
    expect(formatBytes(1536, 'ru')).toEqual({ value: '1,5', unit: 'KB' })
    expect(formatBytes(5 * 1024 ** 3, 'en')).toEqual({ value: '5', unit: 'GB' })
  })
})

describe('часовой пояс', () => {
  it('название на языке интерфейса, а не идентификатор IANA', () => {
    expect(formatTimeZone('Europe/Moscow', 'ru')).toContain('Москва')
    expect(formatTimeZone('Europe/Moscow', 'en')).toContain('Moscow')
    expect(formatTimeZone('Europe/Moscow', 'ru')).not.toContain('Europe/')
  })

  it('без названия или незнакомый движку — идентификатор как есть', () => {
    expect(formatTimeZone('Etc/GMT-3', 'ru')).toBe('Etc/GMT-3')
    expect(formatTimeZone('GMT', 'ru')).toBe('GMT')
    expect(formatTimeZone('Nowhere/Nothing', 'ru')).toBe('Nowhere/Nothing')
  })
})
