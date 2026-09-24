import { assessHour, effectiveLimits, type HourAssessment } from '@/domain/flightCheck'
import { buildFlightPlan } from '@/domain/flightPlan'
import type { DroneProfile, FlightPlan, Mission, WeatherHour } from '@/domain/types'
import { findHour } from '@/domain/weather'

// План полёта для проверки погоды: нужны ферма, точка взлёта и порядок облёта.
// Потолок — общий для миссии и дрона: выше своего потолка дрон всё равно не поднимется
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
  // Порядок ссылается только на удалённые турбины — такой «план» из взлёта и посадки ничего не оценит
  return plan.turbineOrder.length > 0 ? plan : undefined
}

// Чего не хватает для вердикта — в том порядке, в каком это делают на экранах
export type ForecastGap = 'route' | 'weather' | 'departure' | 'departureMissing'

// Маршрут есть, но план полёта не построить: без него нет оценки заряда
export type PlanIssue = 'takeoff' | 'staleRoute'

export type MissionForecast =
  | { gap: ForecastGap }
  | { gap: null; hour: WeatherHour; plan?: FlightPlan; planIssue?: PlanIssue; assessment: HourAssessment }

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
  const assessment = assessHour(hour, { limits: m.limits, drone, plan, flightAltitudeM: m.flightAltitudeM })
  return { gap: null, hour, assessment, ...(plan ? { plan } : {}), ...(planIssue ? { planIssue } : {}) }
}

// Экран, на котором закрывается пробел
export function gapScreen(gap: ForecastGap | PlanIssue): '/router' | '/weather' {
  return gap === 'route' || gap === 'takeoff' || gap === 'staleRoute' ? '/router' : '/weather'
}
