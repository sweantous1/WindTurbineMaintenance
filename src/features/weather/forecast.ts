import { assessHour, effectiveLimits, type HourAssessment } from '@/domain/flightCheck'
import { buildFlightPlan } from '@/domain/flightPlan'
import type { DroneProfile, FlightPlan, Mission, WeatherHour } from '@/domain/types'
import { findHour } from '@/domain/weather'
import { forecastDistanceM, isFarFromFarm } from './location'

// план полёта для проверки погоды, потолок общий для миссии и дрона
export function missionFlightPlan(m: Mission, drone: DroneProfile): FlightPlan | undefined {
  const { farm, takeoff, route } = m
  if (!farm || !takeoff || !route || route.order.length === 0) return undefined
  const plan = buildFlightPlan({
    farm,
    takeoff,
    order: route.order,
    flightAltitudeM: m.flightAltitudeM,
    maxAltitudeM: effectiveLimits(m.limits, drone).maxAltitudeM,
    returnToTakeoff: route.returnToTakeoff,
  })
  // в порядке остались только удалённые турбины, оценивать нечего
  return plan.turbineOrder.length > 0 ? plan : undefined
}

// чего не хватает для вердикта, в порядке шагов на экранах
export type ForecastGap = 'route' | 'weather' | 'departure' | 'departureMissing'

// маршрут есть, но план не строится, значит без оценки заряда
export type PlanIssue = 'takeoff' | 'staleRoute'

export type MissionForecast =
  | { gap: ForecastGap }
  | {
      gap: null
      hour: WeatherHour
      plan?: FlightPlan
      planIssue?: PlanIssue
      assessment: HourAssessment
      // м от точки прогноза до центра фермы, если это далеко
      farFromFarmM?: number
    }

export function forecastGap(m: Mission): ForecastGap | null {
  if (!m.route || m.route.order.length === 0) return 'route'
  if (!m.weather) return 'weather'
  if (!m.departureTime) return 'departure'
  if (!findHour(m.weather, m.departureTime)) return 'departureMissing'
  return null
}

export function missionForecast(m: Mission, drone: DroneProfile): MissionForecast {
  const gap = forecastGap(m)
  const hour = m.weather && findHour(m.weather, m.departureTime)
  if (gap !== null || !hour) return { gap: gap ?? 'departureMissing' }
  const plan = missionFlightPlan(m, drone)
  const planIssue: PlanIssue | undefined = plan ? undefined : !m.takeoff ? 'takeoff' : 'staleRoute'
  let assessment = assessHour(hour, { limits: m.limits, drone, plan, flightAltitudeM: m.flightAltitudeM })
  const distanceM = forecastDistanceM(m)
  const far = isFarFromFarm(distanceM)
  // по погоде в другом месте "можно" не ставим
  if (far && assessment.status === 'ok') assessment = { ...assessment, status: 'marginal' }
  return {
    gap: null,
    hour,
    assessment,
    ...(plan ? { plan } : {}),
    ...(planIssue ? { planIssue } : {}),
    ...(far ? { farFromFarmM: distanceM } : {}),
  }
}

// экран, где это исправить
export function gapScreen(gap: ForecastGap | PlanIssue): '/router' | '/weather' {
  return gap === 'route' || gap === 'takeoff' || gap === 'staleRoute' ? '/router' : '/weather'
}
