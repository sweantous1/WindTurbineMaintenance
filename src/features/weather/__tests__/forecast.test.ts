import { describe, expect, it } from 'vitest'
import forecast from '@/domain/__tests__/fixtures/openMeteo-48.215_40.284-24h.json'
import { DEFAULT_DRONE_PROFILE, DEFAULT_FARM_DEFAULTS, DEFAULT_LIMITS } from '@/domain/defaults'
import { assessHour, effectiveLimits, transitAltitudeM } from '@/domain/flightCheck'
import { buildFlightPlan } from '@/domain/flightPlan'
import type { DroneProfile, Farm, Mission, RoutePlan } from '@/domain/types'
import { normalizeForecast } from '@/domain/weather'
import { offsetGeo } from '@/lib/geo'
import { chartAltitudes } from '../chartData'
import { forecastGap, gapScreen, missionFlightPlan, missionForecast } from '../forecast'

const CENTER = { lat: 48.215, lon: 40.284 }
const drone: DroneProfile = { ...DEFAULT_DRONE_PROFILE }

const farm: Farm = {
  name: 'Тестовая',
  center: CENTER,
  defaults: { ...DEFAULT_FARM_DEFAULTS },
  turbines: [
    { id: 't1', name: 'T1', ...offsetGeo(CENTER, -600, 0) },
    { id: 't2', name: 'T2', ...offsetGeo(CENTER, 0, 0) },
    { id: 't3', name: 'T3', ...offsetGeo(CENTER, 600, 0) },
  ],
}

const route: RoutePlan = {
  algorithm: 'auto',
  params: {},
  thetaMaxDeg: 180,
  returnToTakeoff: true,
  order: ['t1', 't2', 't3'],
  lengthM: 0,
  turnViolations: 0,
  source: 'auto',
  computedAt: '2026-09-24T16:00:00.000Z',
}

const weather = normalizeForecast(forecast, { source: 'farm', farmCenter: CENTER, fetchedAt: '2026-09-24T16:20:00.000Z' })
const departure = weather.hourly[15].time

function mission(patch: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    schemaVersion: 1,
    name: 'Облёт',
    type: 'planned',
    status: 'ready',
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
    droneProfileId: drone.id,
    flightAltitudeM: 90,
    limits: { ...DEFAULT_LIMITS },
    farm,
    takeoff: offsetGeo(CENTER, -900, -200),
    route,
    weather,
    departureTime: departure,
    ...patch,
  }
}

describe('чего не хватает для вердикта', () => {
  it('по порядку работы: маршрут, прогноз, час вылета', () => {
    expect(forecastGap(mission({ route: undefined, weather: undefined }))).toBe('route')
    expect(forecastGap(mission({ route: { ...route, order: [] } }))).toBe('route')
    expect(forecastGap(mission({ weather: undefined }))).toBe('weather')
    expect(forecastGap(mission({ departureTime: undefined }))).toBe('departure')
    expect(forecastGap(mission({ departureTime: '2030-01-01T00:00' }))).toBe('departureMissing')
    expect(forecastGap(mission())).toBeNull()
  })

  it('подсказка ведёт на экран, где пробел закрывается', () => {
    expect(gapScreen('route')).toBe('/router')
    expect(gapScreen('takeoff')).toBe('/router')
    expect(gapScreen('staleRoute')).toBe('/router')
    expect(gapScreen('weather')).toBe('/weather')
    expect(gapScreen('departure')).toBe('/weather')
    expect(gapScreen('departureMissing')).toBe('/weather')
  })
})

describe('план полёта для проверки погоды', () => {
  it('строится из фермы, точки взлёта и порядка облёта с общим потолком', () => {
    const m = mission({ limits: { ...DEFAULT_LIMITS, maxAltitudeM: 150 } })
    const plan = missionFlightPlan(m, { ...drone, maxAltitudeM: 80 })
    expect(plan).toBeDefined()
    expect(plan!.turbineOrder).toEqual(['t1', 't2', 't3'])
    // Потолок дрона ниже высоты полёта миссии — транзит прижат к нему
    expect(plan!.transitAltM).toBe(80)
    expect(plan!.lengthM).toBeCloseTo(
      buildFlightPlan({
        farm,
        takeoff: m.takeoff!,
        order: route.order,
        flightAltitudeM: 90,
        maxAltitudeM: 80,
        returnToTakeoff: true,
      }).lengthM,
    )
  })

  it('без точки взлёта или с устаревшим порядком плана нет', () => {
    expect(missionFlightPlan(mission({ takeoff: undefined }), drone)).toBeUndefined()
    expect(missionFlightPlan(mission({ route: { ...route, order: ['gone'] } }), drone)).toBeUndefined()
    expect(missionFlightPlan(mission({ farm: undefined }), drone)).toBeUndefined()
  })
})

describe('вердикт на час вылета', () => {
  it('та же проверка, что assessHour с планом, плюс оценка полёта', () => {
    const m = mission()
    const f = missionForecast(m, drone)
    if (f.gap !== null) throw new Error('ожидался вердикт')
    const plan = missionFlightPlan(m, drone)
    expect(f.hour.time).toBe(departure)
    expect(f.plan).toEqual(plan)
    expect(f.planIssue).toBeUndefined()
    expect(f.assessment).toEqual(assessHour(f.hour, { limits: m.limits, drone, plan, flightAltitudeM: 90 }))
    expect(f.assessment.estimate?.lengthM).toBe(plan!.lengthM)
    // Проверяются все высоты плана: транзит и ступица
    expect(f.assessment.windByAlt.map((w) => w.altM)).toEqual([90, 100])
  })

  it('без точки взлёта — вердикт по высоте полёта миссии, без оценки заряда', () => {
    const f = missionForecast(mission({ takeoff: undefined }), drone)
    if (f.gap !== null) throw new Error('ожидался вердикт')
    expect(f.plan).toBeUndefined()
    expect(f.planIssue).toBe('takeoff')
    expect(f.assessment.estimate).toBeUndefined()
    expect(f.assessment.windByAlt.map((w) => w.altM)).toEqual([90])
  })

  it('без плана график ветра — на той же высоте, что вердикт: миссия выше потолка прижата к нему', () => {
    const m = mission({ takeoff: undefined, flightAltitudeM: 150, limits: { ...DEFAULT_LIMITS, maxAltitudeM: 120 } })
    const f = missionForecast(m, drone)
    if (f.gap !== null) throw new Error('ожидался вердикт')
    // Экран погоды строит график по transitAltitudeM, вердикт — assessHour
    const chartAltM = transitAltitudeM(m.flightAltitudeM, effectiveLimits(m.limits, drone))
    expect(chartAltitudes(undefined, chartAltM)).toEqual({ transitAltM: 120, topAltM: 120 })
    expect(f.assessment.windByAlt.map((w) => w.altM)).toEqual([chartAltM])
    // Ниже потолка высота миссии не меняется
    expect(transitAltitudeM(90, effectiveLimits(m.limits, drone))).toBe(90)
  })

  it('устаревший порядок облёта отмечается отдельно', () => {
    const f = missionForecast(mission({ route: { ...route, order: ['gone'] } }), drone)
    expect(f.gap === null && f.planIssue).toBe('staleRoute')
  })

  it('чего-то не хватает — только пробел, без вердикта', () => {
    expect(missionForecast(mission({ departureTime: undefined }), drone)).toEqual({ gap: 'departure' })
  })

  // Находка: после импорта фермы в 400 км вердикт «Можно лететь» давался по погоде прежнего места
  it('прогноз далеко от нынешнего центра фермы — не «можно», с расстоянием', () => {
    // Две башни без конфликтов плана: рядом с прогнозом вердикт «можно»
    const at = (northM: number): Pick<Mission, 'farm' | 'takeoff' | 'route'> => {
      const center = offsetGeo(CENTER, 0, northM)
      return {
        farm: {
          ...farm,
          center,
          turbines: [
            { id: 't1', name: 'T1', ...offsetGeo(center, -600, 0) },
            { id: 't3', name: 'T3', ...offsetGeo(center, 600, 0) },
          ],
        },
        takeoff: offsetGeo(center, -900, -200),
        route: { ...route, order: ['t1', 't3'] },
      }
    }
    const near = missionForecast(mission(at(0)), drone)
    if (near.gap !== null) throw new Error('ожидался вердикт')
    expect(near.assessment.status).toBe('ok')
    expect(near.farFromFarmM).toBeUndefined()

    const f = missionForecast(mission(at(400_000)), drone)
    if (f.gap !== null) throw new Error('ожидался вердикт')
    expect(f.assessment.status).toBe('marginal')
    expect(f.assessment.reasons).toEqual(near.assessment.reasons)
    expect(f.farFromFarmM).toBeGreaterThan(390_000)
  })

  it('лимиты — меньшие из миссии и дрона', () => {
    const strict = { ...drone, maxWindMs: 0.5, maxGustMs: 0.5 }
    const f = missionForecast(mission(), strict)
    if (f.gap !== null) throw new Error('ожидался вердикт')
    expect(effectiveLimits(DEFAULT_LIMITS, strict).maxWindMs).toBe(0.5)
    expect(f.assessment.status).toBe('no')
    expect(f.assessment.reasons.some((r) => r.code === 'wind' && r.limit === 0.5)).toBe(true)
  })
})
