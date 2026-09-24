import { describe, expect, it } from 'vitest'
import forecastMs from './fixtures/openMeteo-48.215_40.284-24h.json'
import { DEFAULT_DRONE_PROFILE, DEFAULT_LIMITS } from '../defaults'
import type { DroneProfile, FlightPlan, MissionLimits, WeatherHour } from '../types'
import { assessHour, effectiveLimits, estimateMission } from '../flightCheck'
import { normalizeForecast } from '../weather'

const drone: DroneProfile = { ...DEFAULT_DRONE_PROFILE }
const limits: MissionLimits = { ...DEFAULT_LIMITS }
const ctx = { limits, drone, flightAltitudeM: 90 }

function hour(patch: Partial<WeatherHour> = {}, windMs = 3, gustMs10 = windMs): WeatherHour {
  return {
    time: '2026-09-25T10:00',
    temperatureC: 15,
    precipitationMm: 0,
    precipitationProbabilityPct: 0,
    weatherCode: 0,
    windMs: { '10': windMs, '80': windMs, '120': windMs, '180': windMs },
    windDirDeg: { '10': 0, '80': 0, '120': 0, '180': 0 },
    gustMs10,
    humidityPct: 50,
    pressureHpa: 1013,
    cloudCoverPct: 0,
    visibilityKm: 20,
    ...patch,
  }
}

function plan(patch: Partial<FlightPlan> = {}): FlightPlan {
  return {
    waypoints: [],
    transitAltM: 60,
    altitudeLevelsM: [60, 90, 60],
    maxAltM: 110,
    lengthM: 10_000,
    turbineOrder: [],
    conflicts: [],
    ...patch,
  }
}

describe('эффективные лимиты', () => {
  it('ветер, порывы и потолок — минимум из миссии и дрона', () => {
    const lim = effectiveLimits(
      { ...limits, maxWindMs: 14, maxGustMs: 12, maxAltitudeM: 150 },
      { ...drone, maxWindMs: 10, maxGustMs: 16, maxAltitudeM: 100 },
    )
    expect(lim).toEqual({
      maxWindMs: 10,
      maxGustMs: 12,
      maxPrecipMmH: limits.maxPrecipMmH,
      minVisibilityKm: limits.minVisibilityKm,
      minTempC: limits.minTempC,
      maxTempC: limits.maxTempC,
      maxAltitudeM: 100,
    })
  })
})

describe('оценка заряда', () => {
  it('10 км при 10 м/с и 35 мин, резерв 20%', () => {
    const e = estimateMission(10_000, drone)
    expect(e.lengthM).toBe(10_000)
    // 10 000 / 10 / 60 = 16,67 мин; 16,67 / 35 = 47,62%
    expect(e.timeMin).toBeCloseTo(50 / 3, 9)
    expect(e.batteryPct).toBeCloseTo(1000 / 21, 9)
    expect(e.timeWorstMin).toBe(e.timeMin)
    expect(e.batteryWorstPct).toBe(e.batteryPct)
    expect(e.usablePct).toBe(80)
    expect(e.sorties).toBe(1)
    // Попутный или отрицательный ветер худший случай не улучшает, null — как штиль
    expect(estimateMission(10_000, drone, -4).timeWorstMin).toBe(e.timeMin)
    expect(estimateMission(10_000, drone, null).timeWorstMin).toBe(e.timeMin)
  })

  it('встречный ветер 6 м/с — худший случай и два вылета', () => {
    const e = estimateMission(10_000, drone, 6)
    expect(e.timeMin).toBeCloseTo(50 / 3, 9)
    // Путевая 4 м/с: 10 000 / 4 / 60 = 41,67 мин = 119,05% при доступных 80%
    expect(e.timeWorstMin).toBeCloseTo(125 / 3, 9)
    expect(e.batteryWorstPct).toBeCloseTo(2500 / 21, 9)
    expect(e.sorties).toBe(2)
    // 4 вылета: 3 × 80% < 250% ≤ 4 × 80%
    expect(estimateMission(21_000, drone, 6).sorties).toBe(4)
  })

  it('путевая скорость ≤ 0,5 м/с — долететь нельзя', () => {
    const e = estimateMission(10_000, drone, 9.5)
    expect(e.timeWorstMin).toBe(Infinity)
    expect(e.batteryWorstPct).toBe(Infinity)
    expect(e.sorties).toBe(Infinity)
    // Чуть быстрее порога — долететь можно, пусть и за много вылетов
    expect(Number.isFinite(estimateMission(10_000, drone, 9.4).sorties)).toBe(true)
  })

  it('испорченный профиль дрона не даёт «заряда хватит»', () => {
    for (const bad of [
      { ...drone, enduranceMin: 0 },
      { ...drone, enduranceMin: -35 },
      { ...drone, cruiseSpeedMs: 0 },
      { ...drone, cruiseSpeedMs: -10 },
      { ...drone, reservePct: 100 },
    ]) {
      expect(estimateMission(10_000, bad, 3).sorties).toBe(Infinity)
    }
    expect(estimateMission(10_000, drone, Number.NaN).sorties).toBe(Infinity)
  })

  it('ровно доступный заряд — один вылет, пустой маршрут — ноль', () => {
    // 80% от 35 мин = 28 мин = 16 800 м при 10 м/с
    expect(estimateMission(16_800, drone).sorties).toBe(1)
    expect(estimateMission(0, drone, 20)).toMatchObject({ timeWorstMin: 0, batteryWorstPct: 0, sorties: 1 })
  })
})

describe('оценка часа', () => {
  it('11,9 м/с при лимите 12 — на грани', () => {
    const a = assessHour(hour({}, 11.9), ctx)
    expect(a.status).toBe('marginal')
    expect(a.reasons).toContainEqual({ code: 'wind', severity: 'marginal', value: 11.9, limit: 12, altM: 90 })
  })

  it('12,1 м/с — нельзя, с высотой', () => {
    const a = assessHour(hour({}, 12.1), ctx)
    expect(a.status).toBe('no')
    expect(a.reasons[0]).toEqual({ code: 'wind', severity: 'no', value: 12.1, limit: 12, altM: 90 })
  })

  it('ровно на границах: 0,8 лимита — на грани, лимит — нельзя', () => {
    // 0,8 × 12 в двоичной арифметике = 9,600000000000001: значение 9,6 из прогноза обязано попасть в «на грани»
    expect(assessHour(hour({}, 9.6), ctx).reasons).toEqual([
      { code: 'wind', severity: 'marginal', value: 9.6, limit: 12, altM: 90 },
    ])
    expect(assessHour(hour({}, 9.59), ctx).status).toBe('ok')
    expect(assessHour(hour({}, 12), ctx).reasons[0]).toMatchObject({ code: 'wind', severity: 'no', value: 12 })
    // Порыв при лимите 14: 0,8 × 14 = 11,200000000000001
    const gustLimits = { ...ctx, limits: { ...limits, maxGustMs: 14 } }
    expect(assessHour(hour({}, 5.6, 11.2), gustLimits).reasons).toEqual([
      { code: 'gust', severity: 'marginal', value: 11.2, limit: 14, altM: 90 },
    ])
    expect(assessHour(hour({}, 7, 14), gustLimits).reasons[0]).toMatchObject({ code: 'gust', severity: 'no' })
    // Осадки при лимите 3 мм/ч: 0,8 × 3 = 2,4000000000000004
    const wetLimits = { ...ctx, limits: { ...limits, maxPrecipMmH: 3 } }
    expect(assessHour(hour({ precipitationMm: 2.4 }), wetLimits).reasons).toEqual([
      { code: 'precip', severity: 'marginal', value: 2.4, limit: 3 },
    ])
  })

  it('регрессия эталона: 15 км/ч ≈ 4,17 м/с — можно лететь', () => {
    const a = assessHour(hour({}, 15 / 3.6, 20 / 3.6), ctx)
    expect(a.windByAlt[0].ms).toBeCloseTo(4.17, 2)
    expect(a.status).toBe('ok')
    expect(a.reasons).toEqual([])
    // Те же числа, прочитанные как м/с (ошибка эталона), дали бы запрет
    expect(assessHour(hour({}, 15, 20), ctx).status).toBe('no')
  })

  it('реальный прогноз: данных хватает, средний ветер на 90 м далеко от лимита', () => {
    const s = normalizeForecast(forecastMs, { source: 'farm' })
    for (const h of s.hourly) {
      const a = assessHour(h, ctx)
      expect(a.status).not.toBe('insufficient')
      expect(a.reasons.filter((r) => r.code !== 'gust')).toEqual([])
    }
    const noon = s.hourly.find((h) => h.time === '2026-09-25T12:00')
    expect(noon && assessHour(noon, ctx).status).toBe('ok')
  })

  it('ветер проверяется на каждой высоте плана, причина — с худшей', () => {
    const h = hour({ windMs: { '10': 5, '80': 8, '120': 12.5, '180': 14 } }, 5, 8)
    const a = assessHour(h, { ...ctx, plan: plan({ altitudeLevelsM: [30, 60, 30], maxAltM: 120 }) })
    expect(a.windByAlt.map((w) => w.altM)).toEqual([30, 60, 120])
    expect(a.status).toBe('no')
    expect(a.reasons.find((r) => r.code === 'wind')).toMatchObject({ severity: 'no', value: 12.5, altM: 120 })
    // Порыв на 120 м: 12,5 + (8 − 5) = 15,5 при лимите 15
    expect(a.reasons.find((r) => r.code === 'gust')).toMatchObject({ severity: 'no', altM: 120 })
    expect(a.reasons.find((r) => r.code === 'gust')?.value).toBeCloseTo(15.5, 9)
  })

  it('порывы на грани при спокойном среднем ветре', () => {
    const a = assessHour(hour({}, 5, 13), ctx)
    expect(a.status).toBe('marginal')
    expect(a.reasons).toHaveLength(1)
    expect(a.reasons[0]).toMatchObject({ code: 'gust', severity: 'marginal', limit: 15, altM: 90 })
    expect(a.reasons[0].value).toBeCloseTo(13, 9)
  })

  it('осадки — мм/ч, вероятность осадков на решение не влияет', () => {
    expect(assessHour(hour({ precipitationMm: 0, precipitationProbabilityPct: 90 }), ctx).status).toBe('ok')
    const wet = assessHour(hour({ precipitationMm: 0.6, precipitationProbabilityPct: 0 }), ctx)
    expect(wet.status).toBe('no')
    expect(wet.reasons).toEqual([{ code: 'precip', severity: 'no', value: 0.6, limit: 0.5 }])
    expect(assessHour(hour({ precipitationMm: 0.5 }), ctx).reasons[0]).toMatchObject({ code: 'precip', severity: 'marginal' })
    expect(assessHour(hour({ precipitationMm: 0.4 }), ctx).reasons[0]).toMatchObject({ code: 'precip', severity: 'marginal' })
    expect(assessHour(hour({ precipitationMm: 0.3 }), ctx).status).toBe('ok')
    // Лимит 0 мм/ч: сухо — можно, любая капля — нельзя
    const dryOnly = { ...ctx, limits: { ...limits, maxPrecipMmH: 0 } }
    expect(assessHour(hour({ precipitationMm: 0 }), dryOnly).status).toBe('ok')
    expect(assessHour(hour({ precipitationMm: 0.1 }), dryOnly).reasons[0]).toMatchObject({ code: 'precip', severity: 'no' })
  })

  it('температура вне диапазона и плохая видимость — нельзя', () => {
    expect(assessHour(hour({ temperatureC: -12 }), ctx).reasons).toEqual([{ code: 'temp', severity: 'no', value: -12, limit: -10 }])
    expect(assessHour(hour({ temperatureC: 41 }), ctx).reasons).toEqual([{ code: 'temp', severity: 'no', value: 41, limit: 40 }])
    expect(assessHour(hour({ temperatureC: -10 }), ctx).status).toBe('ok')
    expect(assessHour(hour({ temperatureC: 40 }), ctx).status).toBe('ok')
    expect(assessHour(hour({ visibilityKm: 2.5 }), ctx).reasons).toEqual([
      { code: 'visibility', severity: 'no', value: 2.5, limit: 3 },
    ])
    expect(assessHour(hour({ visibilityKm: 3 }), ctx).status).toBe('ok')
    // Пропуски в неветровых полях проверку не валят и не выдают «недостаточно данных»
    expect(assessHour(hour({ temperatureC: null, visibilityKm: null, precipitationMm: null }), ctx).status).toBe('ok')
  })

  it('план выше потолка — нельзя', () => {
    const a = assessHour(hour(), { ...ctx, plan: plan({ maxAltM: 130 }) })
    expect(a.status).toBe('no')
    expect(a.reasons).toContainEqual({ code: 'altitude', severity: 'no', value: 130, limit: 120, altM: 130 })
    // Потолок — минимум из миссии и дрона
    const low = assessHour(hour(), { ...ctx, drone: { ...drone, maxAltitudeM: 100 }, plan: plan() })
    expect(low.reasons).toContainEqual({ code: 'altitude', severity: 'no', value: 110, limit: 100, altM: 110 })
    // Ровно на потолке — можно
    expect(assessHour(hour(), { ...ctx, plan: plan({ maxAltM: 120 }) }).status).toBe('ok')
    // Без плана потолок сверяется с высотой транзита миссии
    const noPlan = assessHour(hour(), { ...ctx, flightAltitudeM: 130 })
    expect(noPlan.reasons).toEqual([{ code: 'altitude', severity: 'no', value: 130, limit: 120, altM: 130 }])
  })

  it('заряд считается по худшему ветру среди высот плана', () => {
    const h = hour({ windMs: { '10': 2, '80': 4, '120': 6, '180': 7 } }, 2, 2.4)
    const a = assessHour(h, { ...ctx, plan: plan({ altitudeLevelsM: [60, 90], maxAltM: 120 }) })
    // На 120 м — 6 м/с, путевая 4 м/с
    expect(a.estimate?.timeWorstMin).toBeCloseTo(125 / 3, 9)
    expect(a.reasons).toContainEqual({ code: 'battery', severity: 'marginal', value: a.estimate?.batteryWorstPct, limit: 80, altM: 120 })
  })

  it('испорченный профиль дрона с планом — запрет по заряду', () => {
    const a = assessHour(hour(), { ...ctx, drone: { ...drone, enduranceMin: -35 }, plan: plan() })
    expect(a.status).toBe('no')
    expect(a.reasons).toContainEqual(expect.objectContaining({ code: 'battery', severity: 'no' }))
  })

  it('заряд: несколько вылетов — на грани, против ветра не долететь — нельзя', () => {
    const calm = assessHour(hour({}, 3), { ...ctx, plan: plan() })
    expect(calm.status).toBe('ok')
    expect(calm.estimate?.sorties).toBe(1)

    const windy = assessHour(hour({}, 6, 6), { ...ctx, plan: plan() })
    expect(windy.status).toBe('marginal')
    expect(windy.estimate?.sorties).toBe(2)
    expect(windy.reasons).toEqual([
      { code: 'battery', severity: 'marginal', value: windy.estimate?.batteryWorstPct, limit: 80, altM: 60 },
    ])

    const slowDrone = { ...drone, cruiseSpeedMs: 7 }
    const stuck = assessHour(hour({}, 6.6, 6.6), { ...ctx, drone: slowDrone, plan: plan() })
    expect(stuck.status).toBe('no')
    expect(stuck.reasons).toEqual([{ code: 'battery', severity: 'no', value: Infinity, limit: 80, altM: 60 }])
  })

  it('без плана заряд не оценивается', () => {
    expect(assessHour(hour({}, 6), ctx).estimate).toBeUndefined()
  })

  it('нет ветра на нужной высоте — недостаточно данных', () => {
    const noUpper = hour({ windMs: { '10': 3, '80': null, '120': null, '180': null } })
    const a = assessHour(noUpper, ctx)
    expect(a.status).toBe('insufficient')
    expect(a.windByAlt).toEqual([{ altM: 90, ms: null, gustMs: null, extrapolated: false }])

    // Недостаток данных важнее «на грани», но «нельзя» важнее недостатка
    expect(assessHour({ ...noUpper, precipitationMm: 0.45 }, ctx).status).toBe('insufficient')
    expect(assessHour({ ...noUpper, temperatureC: -20 }, ctx).status).toBe('no')

    // Не хватает ветра хотя бы на одной высоте плана — тоже недостаточно, даже если на других всё есть
    const no180 = hour({ windMs: { '10': 3, '80': 3, '120': 3, '180': null } })
    const withPlan = assessHour(no180, { ...ctx, plan: plan({ altitudeLevelsM: [60, 90], maxAltM: 150 }) })
    expect(withPlan.status).toBe('no')
    expect(withPlan.reasons.map((r) => r.code)).toEqual(['altitude'])
    const inCeiling = { ...ctx, limits: { ...limits, maxAltitudeM: 200 }, drone: { ...drone, maxAltitudeM: 200 } }
    expect(assessHour(no180, { ...inCeiling, plan: plan({ altitudeLevelsM: [60, 90], maxAltM: 150 }) }).status).toBe('insufficient')

    // Нет порыва у земли — оценить порывы нельзя
    expect(assessHour(hour({ gustMs10: null }), ctx).status).toBe('insufficient')
  })

  it('причины-запреты идут первыми', () => {
    const a = assessHour(hour({ visibilityKm: 1 }, 5, 13), ctx)
    expect(a.status).toBe('no')
    expect(a.reasons.map((r) => r.severity)).toEqual(['no', 'marginal'])
  })

  it('высоты плана уникальны и включают максимальную', () => {
    const a = assessHour(hour(), { ...ctx, plan: plan({ altitudeLevelsM: [90, 60, 90], maxAltM: 90 }) })
    expect(a.windByAlt.map((w) => w.altM)).toEqual([60, 90])
  })
})
