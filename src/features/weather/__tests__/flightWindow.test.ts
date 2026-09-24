import { describe, expect, it } from 'vitest'
import { DEFAULT_DRONE_PROFILE, DEFAULT_LIMITS } from '@/domain/defaults'
import type { HourStatus } from '@/domain/flightCheck'
import type { WeatherHour } from '@/domain/types'
import {
  assessHours,
  countByStatus,
  formatWindowRange,
  groupByDay,
  okWindows,
  STATUS_ORDER,
  statusLook,
  type WindowCell,
} from '../flightWindow'
import { addHours, formatDay } from '../format'

const ctx = { limits: { ...DEFAULT_LIMITS }, drone: { ...DEFAULT_DRONE_PROFILE }, flightAltitudeM: 90 }

function hour(time: string, windMs: number | null, patch: Partial<WeatherHour> = {}): WeatherHour {
  return {
    time,
    temperatureC: 15,
    precipitationMm: 0,
    precipitationProbabilityPct: 0,
    weatherCode: 0,
    windMs: { '10': windMs, '80': windMs, '120': windMs, '180': windMs },
    windDirDeg: { '10': 0, '80': 0, '120': 0, '180': 0 },
    gustMs10: windMs,
    humidityPct: 50,
    pressureHpa: 1013,
    cloudCoverPct: 0,
    visibilityKm: 20,
    ...patch,
  }
}

// Короткая запись: статус на каждый час подряд, начиная с 22:00
function cells(statuses: HourStatus[], start = '2026-09-24T22:00'): WindowCell[] {
  return statuses.map((status, i) => {
    const time = addHours(start, i)
    return {
      time,
      day: time.slice(0, 10),
      hour: Number(time.slice(11, 13)),
      status,
      assessment: { status, reasons: [], windByAlt: [] },
    }
  })
}

describe('раскраска окна вылета', () => {
  it('каждый час получает статус проверки', () => {
    const hours = [
      hour('2026-09-25T08:00', 3),
      hour('2026-09-25T09:00', 10), // 10 из 12 — больше 80% лимита
      hour('2026-09-25T10:00', 13),
      hour('2026-09-25T11:00', null),
    ]
    const result = assessHours(hours, ctx)
    expect(result.map((c) => c.status)).toEqual(['ok', 'marginal', 'no', 'insufficient'])
    expect(result.map((c) => c.hour)).toEqual([8, 9, 10, 11])
    expect(result[0].day).toBe('2026-09-25')
    expect(result[2].assessment.reasons[0]).toMatchObject({ code: 'wind', severity: 'no', value: 13 })
  })

  it('статусы различимы не только цветом: у каждого свой значок и подпись', () => {
    const looks = STATUS_ORDER.map(statusLook)
    expect(new Set(looks.map((l) => l.icon)).size).toBe(STATUS_ORDER.length)
    expect(new Set(looks.map((l) => l.labelKey)).size).toBe(STATUS_ORDER.length)
    expect(new Set(looks.map((l) => l.cell)).size).toBe(STATUS_ORDER.length)
    // «Нет данных» — ещё и пунктирной рамкой
    expect(statusLook('insufficient').cell).toContain('border-dashed')
  })

  it('в легенде все четыре статуса', () => {
    expect([...STATUS_ORDER].sort()).toEqual(['insufficient', 'marginal', 'no', 'ok'])
  })
})

describe('группировка и подсчёт', () => {
  it('часы делятся по суткам', () => {
    const groups = groupByDay(cells(['ok', 'ok', 'no', 'ok']))
    expect(groups.map((g) => [g.day, g.cells.length])).toEqual([
      ['2026-09-24', 2],
      ['2026-09-25', 2],
    ])
  })

  it('подсчёт по статусам', () => {
    expect(countByStatus(cells(['ok', 'no', 'ok', 'insufficient']))).toEqual({ ok: 2, marginal: 0, no: 1, insufficient: 1 })
  })
})

describe('окна «можно»', () => {
  it('подряд идущие часы «можно»; конец окна — следующий час', () => {
    const w = okWindows(cells(['ok', 'ok', 'marginal', 'ok', 'ok', 'ok', 'no']))
    expect(w).toEqual([
      { start: '2026-09-24T22:00', endExclusive: '2026-09-25T00:00', hours: 2 },
      { start: '2026-09-25T01:00', endExclusive: '2026-09-25T04:00', hours: 3 },
    ])
  })

  it('окно в конце прогноза тоже учитывается', () => {
    expect(okWindows(cells(['no', 'ok']))).toEqual([{ start: '2026-09-24T23:00', endExclusive: '2026-09-25T00:00', hours: 1 }])
  })

  it('минимальная длина окна', () => {
    expect(okWindows(cells(['ok', 'no', 'ok', 'ok']), { minHours: 2 })).toHaveLength(1)
  })

  it('прошедшие часы из окна исключаются', () => {
    const c = cells(['ok', 'ok', 'ok'])
    const w = okWindows(c, { skip: (x) => x.time === c[0].time })
    expect(w).toEqual([{ start: c[1].time, endExclusive: addHours(c[2].time, 1), hours: 2 }])
  })

  it('разрыв во времени рвёт окно', () => {
    const c = [...cells(['ok', 'ok']), ...cells(['ok'], '2026-09-25T05:00')]
    expect(okWindows(c).map((w) => w.hours)).toEqual([2, 1])
  })

  it('подпись окна: через полночь — с днём конца, конец в полночь — без него', () => {
    const day24 = formatDay('2026-09-24T00:00', 'ru')
    const day25 = formatDay('2026-09-25T00:00', 'ru')
    const range = (start: string, hours: number) => formatWindowRange({ start, endExclusive: addHours(start, hours), hours }, 'ru')
    expect(range('2026-09-24T08:00', 5)).toBe(`${day24} 08:00–13:00`)
    expect(range('2026-09-24T20:00', 4)).toBe(`${day24} 20:00–00:00`)
    expect(range('2026-09-24T22:00', 18)).toBe(`${day24} 22:00 – ${day25} 16:00`)
  })

  it('нет часов «можно» — нет окон', () => {
    expect(okWindows(cells(['no', 'marginal', 'insufficient']))).toEqual([])
    expect(okWindows([])).toEqual([])
  })
})
