import type { EffectiveLimits } from '@/domain/flightCheck'
import type { FlightPlan, WeatherHour } from '@/domain/types'
import { gustAtAltitude, windAtAltitude } from '@/domain/weather'
import { parseLocalTime } from './format'

export interface ChartAltitudes {
  transitAltM: number
  topAltM: number
}

// транзит (там большая часть пути) и максимум плана (там ветер сильнее); без плана - высота миссии
export function chartAltitudes(plan: FlightPlan | undefined, flightAltitudeM: number): ChartAltitudes {
  if (!plan) return { transitAltM: flightAltitudeM, topAltM: flightAltitudeM }
  return { transitAltM: plan.transitAltM, topAltM: Math.max(plan.maxAltM, plan.transitAltM) }
}

// меньше полуметра на графике не видно, линии бы совпали
export function hasTwoAltitudes(a: ChartAltitudes): boolean {
  return Math.abs(a.topAltM - a.transitAltM) >= 0.5
}

export interface WindChartPoint {
  time: string
  windTransitMs: number | null
  windTopMs: number | null
  // худший порыв из двух высот
  gustMs: number | null
  precipMm: number | null
  // выше 180 м ветер берём с верхнего уровня модели
  extrapolated: boolean
}

export function buildWindChartData(hours: WeatherHour[], alts: ChartAltitudes): WindChartPoint[] {
  return hours.map((h) => {
    const transit = windAtAltitude(h, alts.transitAltM)
    const top = windAtAltitude(h, alts.topAltM)
    const gusts = [gustAtAltitude(h, alts.transitAltM), gustAtAltitude(h, alts.topAltM)].filter(
      (g): g is number => g != null,
    )
    return {
      time: h.time,
      windTransitMs: transit.ms,
      windTopMs: top.ms,
      gustMs: gusts.length > 0 ? Math.max(...gusts) : null,
      precipMm: h.precipitationMm,
      extrapolated: transit.extrapolated || top.extrapolated,
    }
  })
}

// округление вверх до кратного step
export function niceCeil(x: number, step: number): number {
  if (!Number.isFinite(x) || x <= 0) return step
  return Math.ceil(x / step - 1e-9) * step
}

// лимиты всегда в пределах оси, даже в штиль
export function windAxisMaxMs(points: WindChartPoint[], limits: Pick<EffectiveLimits, 'maxWindMs' | 'maxGustMs'>): number {
  let max = Math.max(limits.maxWindMs, limits.maxGustMs)
  for (const p of points) max = Math.max(max, p.windTransitMs ?? 0, p.windTopMs ?? 0, p.gustMs ?? 0)
  return niceCeil(max * 1.05, 5)
}

export function precipAxisMaxMm(points: WindChartPoint[], limitMmH: number): number {
  let max = Number.isFinite(limitMmH) ? limitMmH : 0
  for (const p of points) max = Math.max(max, p.precipMm ?? 0)
  if (max <= 1) return 1
  if (max <= 2) return 2
  return niceCeil(max, 5)
}

const TICK_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100]

// свои деления, иначе recharts делит 25 на 0, 7, 14, 21, 25
export function axisTicks(max: number, maxTicks = 6): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]
  const step = TICK_STEPS.find((s) => max / s <= maxTicks) ?? Math.ceil(max / maxTicks)
  const ticks: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

// шаг 3/6/12 ч, чтобы подписи не слипались
export function chartTickTimes(times: string[]): string[] {
  const step = times.length <= 24 ? 3 : times.length <= 72 ? 6 : 12
  return times.filter((time) => {
    const p = parseLocalTime(time)
    return p !== null && p.minute === 0 && p.hour % step === 0
  })
}
