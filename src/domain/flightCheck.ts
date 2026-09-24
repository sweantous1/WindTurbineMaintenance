import type { DroneProfile, FlightPlan, MissionLimits, WeatherHour } from './types'
import { MARGINAL_FRACTION } from './defaults'
import { gustAtAltitude, windAtAltitude } from './weather'

export type HourStatus = 'ok' | 'marginal' | 'no' | 'insufficient'
export type ReasonCode = 'wind' | 'gust' | 'precip' | 'temp' | 'visibility' | 'battery' | 'altitude' | 'conflict'

// value и limit — в единицах проверки: м/с, мм/ч, °C, км, м; для battery — % заряда
// (худший случай против доступного без резерва; при невозможности долететь value = Infinity);
// для conflict — число конфликтов плана (как в сводке экрана маршрута) при допустимом нуле
export interface Reason {
  code: ReasonCode
  severity: 'marginal' | 'no'
  value: number
  limit: number
  altM?: number
}

export interface EffectiveLimits {
  maxWindMs: number
  maxGustMs: number
  maxPrecipMmH: number
  minVisibilityKm: number
  minTempC: number
  maxTempC: number
  maxAltitudeM: number
}

// Лететь можно только в пределах, которые выдерживают и миссия, и дрон
export function effectiveLimits(limits: MissionLimits, drone: DroneProfile): EffectiveLimits {
  return {
    maxWindMs: Math.min(limits.maxWindMs, drone.maxWindMs),
    maxGustMs: Math.min(limits.maxGustMs, drone.maxGustMs),
    maxPrecipMmH: limits.maxPrecipMmH,
    minVisibilityKm: limits.minVisibilityKm,
    minTempC: limits.minTempC,
    maxTempC: limits.maxTempC,
    maxAltitudeM: Math.min(limits.maxAltitudeM, drone.maxAltitudeM),
  }
}

// Высота транзита без плана полёта. Миссия выше потолка — не запрет: план прижимает транзит
// к потолку (buildFlightPlan), и до построения маршрута вердикт и график ветра обязаны считать
// так же, иначе вердикт менялся бы с «нельзя» на «можно» от одного нажатия «Построить маршрут»
export function transitAltitudeM(flightAltitudeM: number, lim: Pick<EffectiveLimits, 'maxAltitudeM'>): number {
  return Math.min(flightAltitudeM, lim.maxAltitudeM)
}

export interface MissionEstimate {
  lengthM: number
  timeMin: number
  timeWorstMin: number
  batteryPct: number
  batteryWorstPct: number
  usablePct: number
  sorties: number
}

// Путевая скорость ниже этой — дрон против ветра фактически висит на месте
const MIN_GROUND_SPEED_MS = 0.5
// Чтобы 80,0000001% из 80% не превращались во второй вылет
const SORTIE_EPSILON = 1e-9
// Порог «на грани» — произведение: 0,8 × 12 = 9,600000000000001, и без допуска
// ветер ровно 9,6 м/с (Open-Meteo даёт две цифры после запятой) считался бы «можно»
const COMPARE_EPSILON = 1e-9

const atLeast = (value: number, threshold: number) => value >= threshold - COMPARE_EPSILON

export function estimateMission(lengthM: number, drone: DroneProfile, windMs?: number | null): MissionEstimate {
  const usablePct = 100 - drone.reservePct
  if (lengthM <= 0) {
    return { lengthM, timeMin: 0, timeWorstMin: 0, batteryPct: 0, batteryWorstPct: 0, usablePct, sorties: 1 }
  }
  // Худший случай: встречный ветер на всём маршруте. Сравнения записаны «от хорошего»,
  // чтобы NaN и неположительные значения из профиля, который правят руками, давали
  // «не долететь», а не «заряда хватит»
  const groundMs = drone.cruiseSpeedMs - Math.max(0, windMs ?? 0)
  const timeMin = drone.cruiseSpeedMs > 0 ? lengthM / drone.cruiseSpeedMs / 60 : Infinity
  const timeWorstMin = groundMs > MIN_GROUND_SPEED_MS ? lengthM / groundMs / 60 : Infinity
  const pctOf = (min: number) => (drone.enduranceMin > 0 ? (min / drone.enduranceMin) * 100 : Infinity)
  const batteryPct = pctOf(timeMin)
  const batteryWorstPct = pctOf(timeWorstMin)
  const sorties = usablePct > 0 ? Math.max(1, Math.ceil(batteryWorstPct / usablePct - SORTIE_EPSILON)) : Infinity
  return { lengthM, timeMin, timeWorstMin, batteryPct, batteryWorstPct, usablePct, sorties }
}

export interface HourAssessment {
  status: HourStatus
  reasons: Reason[]
  windByAlt: { altM: number; ms: number | null; gustMs: number | null; extrapolated: boolean }[]
  estimate?: MissionEstimate
}

// Без плана — высота транзита, уже прижатая к потолку (transitAltM)
function checkAltitudes(plan: FlightPlan | undefined, transitAltM: number): number[] {
  const alts = plan ? [...plan.altitudeLevelsM, plan.maxAltM] : [transitAltM]
  return [...new Set(alts.filter(Number.isFinite))].sort((a, b) => a - b)
}

// Ветер и порывы: «нет» с лимита, «на грани» с доли MARGINAL_FRACTION лимита
function upperLimitReason(code: ReasonCode, value: number, limit: number, altM?: number): Reason | null {
  let severity: Reason['severity']
  if (atLeast(value, limit)) severity = 'no'
  else if (atLeast(value, MARGINAL_FRACTION * limit)) severity = 'marginal'
  else return null
  return { code, severity, value, limit, ...(altM !== undefined ? { altM } : {}) }
}

// Худшая высота по выбранному показателю; высоты без данных пропускаются
function worstAt<T extends { altM: number }>(items: T[], pick: (x: T) => number | null) {
  let worst: { altM: number; value: number } | undefined
  for (const item of items) {
    const v = pick(item)
    if (v != null && (!worst || v > worst.value)) worst = { altM: item.altM, value: v }
  }
  return worst
}

export function assessHour(
  h: WeatherHour,
  ctx: { limits: MissionLimits; drone: DroneProfile; plan?: FlightPlan; flightAltitudeM: number },
): HourAssessment {
  const lim = effectiveLimits(ctx.limits, ctx.drone)
  const transitAltM = transitAltitudeM(ctx.flightAltitudeM, lim)
  const windByAlt = checkAltitudes(ctx.plan, transitAltM).map((altM) => {
    const w = windAtAltitude(h, altM)
    return { altM, ms: w.ms, gustMs: gustAtAltitude(h, altM), extrapolated: w.extrapolated }
  })
  const missingWind = windByAlt.length === 0 || windByAlt.some((w) => w.ms == null || w.gustMs == null)
  const reasons: Reason[] = []
  const add = (r: Reason | null) => {
    if (r) reasons.push(r)
  }

  // Лимит одинаков на всех высотах, поэтому достаточно худшей
  const worstWind = worstAt(windByAlt, (w) => w.ms)
  if (worstWind) add(upperLimitReason('wind', worstWind.value, lim.maxWindMs, worstWind.altM))
  const worstGust = worstAt(windByAlt, (w) => w.gustMs)
  if (worstGust) add(upperLimitReason('gust', worstGust.value, lim.maxGustMs, worstGust.altM))

  // Осадки — мм/ч, а не вероятность в процентах: эталон их путал
  const precip = h.precipitationMm
  if (precip != null) {
    if (precip > lim.maxPrecipMmH) add({ code: 'precip', severity: 'no', value: precip, limit: lim.maxPrecipMmH })
    else if (precip > 0 && atLeast(precip, MARGINAL_FRACTION * lim.maxPrecipMmH)) {
      add({ code: 'precip', severity: 'marginal', value: precip, limit: lim.maxPrecipMmH })
    }
  }

  const temp = h.temperatureC
  if (temp != null && temp < lim.minTempC) add({ code: 'temp', severity: 'no', value: temp, limit: lim.minTempC })
  if (temp != null && temp > lim.maxTempC) add({ code: 'temp', severity: 'no', value: temp, limit: lim.maxTempC })

  const vis = h.visibilityKm
  if (vis != null && vis < lim.minVisibilityKm) {
    add({ code: 'visibility', severity: 'no', value: vis, limit: lim.minVisibilityKm })
  }

  // Выше потолка может оказаться только облёт ступицы, а её высоту знает лишь план
  const topAltM = ctx.plan ? ctx.plan.maxAltM : transitAltM
  if (topAltM > lim.maxAltitudeM) {
    add({ code: 'altitude', severity: 'no', value: topAltM, limit: lim.maxAltitudeM, altM: topAltM })
  }

  let estimate: MissionEstimate | undefined
  if (ctx.plan) {
    estimate = estimateMission(ctx.plan.lengthM, ctx.drone, worstWind?.value)
    const battery = { code: 'battery' as const, value: estimate.batteryWorstPct, limit: estimate.usablePct }
    const altM = worstWind ? { altM: worstWind.altM } : {}
    if (!Number.isFinite(estimate.sorties)) add({ ...battery, severity: 'no', ...altM })
    else if (estimate.sorties > 1) add({ ...battery, severity: 'marginal', ...altM })
    // Маршрут заходит в безопасную зону башен. Погода тут ни при чём, но «можно лететь,
    // всё в пределах» с таким планом писать нельзя: пусть человек посмотрит на маршрут
    if (ctx.plan.conflicts.length > 0) {
      add({ code: 'conflict', severity: 'marginal', value: ctx.plan.conflicts.length, limit: 0 })
    }
  }

  let status: HourStatus = 'ok'
  if (reasons.some((r) => r.severity === 'no')) status = 'no'
  else if (missingWind) status = 'insufficient'
  else if (reasons.length > 0) status = 'marginal'

  // Запреты вперёд: UI показывает первую причину как главную
  reasons.sort((a, b) => Number(b.severity === 'no') - Number(a.severity === 'no'))
  return { status, reasons, windByAlt, ...(estimate ? { estimate } : {}) }
}
