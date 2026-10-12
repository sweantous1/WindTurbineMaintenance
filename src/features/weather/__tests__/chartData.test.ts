import { describe, expect, it } from 'vitest'
import forecast from '@/domain/__tests__/fixtures/openMeteo-48.215_40.284-24h.json'
import type { FlightPlan, WeatherHour } from '@/domain/types'
import { gustAtAltitude, normalizeForecast, windAtAltitude } from '@/domain/weather'
import {
  axisTicks,
  buildWindChartData,
  chartAltitudes,
  chartTickTimes,
  hasTwoAltitudes,
  niceCeil,
  precipAxisMaxMm,
  windAxisMaxMs,
} from '../chartData'
import { addHours } from '../format'

const snapshot = normalizeForecast(forecast, { source: 'farm', fetchedAt: '2026-09-24T16:20:00.000Z' })

function plan(patch: Partial<FlightPlan> = {}): FlightPlan {
  return {
    waypoints: [],
    transitAltM: 60,
    altitudeLevelsM: [60, 100],
    maxAltM: 100,
    lengthM: 5000,
    turbineOrder: ['t1'],
    conflicts: [],
    ...patch,
  }
}

function hour(windMs: Partial<WeatherHour['windMs']>, gustMs10: number | null, precipitationMm: number | null = 0): WeatherHour {
  return {
    time: '2026-09-25T10:00',
    temperatureC: 10,
    precipitationMm,
    precipitationProbabilityPct: 0,
    weatherCode: 0,
    windMs: { '10': null, '80': null, '120': null, '180': null, ...windMs },
    windDirDeg: { '10': 0, '80': 0, '120': 0, '180': 0 },
    gustMs10,
    humidityPct: 50,
    pressureHpa: 1010,
    cloudCoverPct: 0,
    visibilityKm: 20,
  }
}

describe('высоты графика', () => {
  it('без плана — высота полёта миссии, одна линия', () => {
    const a = chartAltitudes(undefined, 90)
    expect(a).toEqual({ transitAltM: 90, topAltM: 90 })
    expect(hasTwoAltitudes(a)).toBe(false)
  })

  it('с планом — транзит и максимальная высота плана', () => {
    const a = chartAltitudes(plan({ transitAltM: 60, maxAltM: 110 }), 90)
    expect(a).toEqual({ transitAltM: 60, topAltM: 110 })
    expect(hasTwoAltitudes(a)).toBe(true)
  })

  it('максимум плана не ниже транзита', () => {
    expect(chartAltitudes(plan({ transitAltM: 90, maxAltM: 90 }), 90).topAltM).toBe(90)
  })
})

describe('данные графика', () => {
  it('на каждый час — ветер на двух высотах, худший порыв и осадки', () => {
    const alts = { transitAltM: 60, topAltM: 110 }
    const points = buildWindChartData(snapshot.hourly, alts)
    expect(points).toHaveLength(snapshot.hourly.length)
    snapshot.hourly.forEach((h, i) => {
      const p = points[i]
      expect(p.time).toBe(h.time)
      expect(p.windTransitMs).toBe(windAtAltitude(h, 60).ms)
      expect(p.windTopMs).toBe(windAtAltitude(h, 110).ms)
      expect(p.gustMs).toBe(Math.max(gustAtAltitude(h, 60)!, gustAtAltitude(h, 110)!))
      expect(p.precipMm).toBe(h.precipitationMm)
      expect(p.extrapolated).toBe(false)
    })
  })

  it('выше 180 м помечается экстраполяцией', () => {
    const [p] = buildWindChartData([hour({ '10': 3, '180': 9 }, 5)], { transitAltM: 90, topAltM: 200 })
    expect(p.windTopMs).toBe(9)
    expect(p.extrapolated).toBe(true)
  })

  it('нет данных — null, а не ноль: линия рвётся, а не ложится на ось', () => {
    const [p] = buildWindChartData([hour({}, null, null)], { transitAltM: 90, topAltM: 90 })
    expect(p.windTransitMs).toBeNull()
    expect(p.windTopMs).toBeNull()
    expect(p.gustMs).toBeNull()
    expect(p.precipMm).toBeNull()
  })

  it('порыв берётся с той высоты, где он известен', () => {
    // На 60 м ветер интерполируется между 10 и 120 м, а для 200 м нет уровня 180 м
    const [p] = buildWindChartData([hour({ '10': 4, '120': 8 }, 6)], { transitAltM: 60, topAltM: 200 })
    expect(p.windTopMs).toBeNull()
    expect(p.gustMs).toBe(gustAtAltitude(hour({ '10': 4, '120': 8 }, 6), 60))
  })
})

describe('оси', () => {
  it('ось ветра всегда вмещает лимиты и данные, деления по 5 м/с', () => {
    const lim = { maxWindMs: 12, maxGustMs: 15 }
    expect(windAxisMaxMs([], lim)).toBe(20)
    const points = buildWindChartData([hour({ '10': 3, '80': 21, '120': 22, '180': 23 }, 4)], { transitAltM: 90, topAltM: 150 })
    expect(windAxisMaxMs(points, lim)).toBeGreaterThanOrEqual(Math.max(...points.map((p) => p.gustMs ?? 0)))
    expect(windAxisMaxMs(points, lim) % 5).toBe(0)
  })

  it('ось осадков: минимум 1 мм, вмещает лимит и данные', () => {
    const at = (mm: number) => buildWindChartData([hour({ '10': 1 }, 1, mm)], { transitAltM: 10, topAltM: 10 })
    expect(precipAxisMaxMm(at(0), 0.5)).toBe(1)
    expect(precipAxisMaxMm(at(1.6), 0.5)).toBe(2)
    expect(precipAxisMaxMm(at(7.2), 0.5)).toBe(10)
    expect(precipAxisMaxMm(at(0), 3)).toBe(5)
  })

  it('niceCeil не прибавляет лишний шаг из-за погрешности', () => {
    expect(niceCeil(15, 5)).toBe(15)
    expect(niceCeil(15.000000000001, 5)).toBe(15)
    expect(niceCeil(15.1, 5)).toBe(20)
    expect(niceCeil(0, 5)).toBe(5)
  })

  it('деления значений — круглые, от нуля до максимума оси', () => {
    expect(axisTicks(25)).toEqual([0, 5, 10, 15, 20, 25])
    expect(axisTicks(20)).toEqual([0, 5, 10, 15, 20])
    expect(axisTicks(40)).toEqual([0, 10, 20, 30, 40])
    expect(axisTicks(1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(axisTicks(2, 4)).toEqual([0, 0.5, 1, 1.5, 2])
    expect(axisTicks(10, 4)).toEqual([0, 5, 10])
    expect(axisTicks(0)).toEqual([0])
  })

  it('деления времени: шаг растёт с длиной прогноза', () => {
    const series = (n: number) => Array.from({ length: n }, (_, i) => addHours('2026-09-24T19:00', i))
    const t24 = chartTickTimes(series(24))
    expect(t24.every((t) => Number(t.slice(11, 13)) % 3 === 0)).toBe(true)
    const t48 = chartTickTimes(series(48))
    expect(t48.every((t) => Number(t.slice(11, 13)) % 6 === 0)).toBe(true)
    expect(t48).toContain('2026-09-25T00:00')
    const t168 = chartTickTimes(series(168))
    expect(t168.every((t) => Number(t.slice(11, 13)) % 12 === 0)).toBe(true)
    expect(t168.length).toBeLessThanOrEqual(15)
  })
})
