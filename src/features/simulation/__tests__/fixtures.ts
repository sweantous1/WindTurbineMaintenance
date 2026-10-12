import { DEFAULT_DRONE_PROFILE, DEFAULT_LIMITS } from '@/domain/defaults'
import type { DroneProfile, Farm, Mission, RoutePlan, Turbine, WeatherHour, WeatherSnapshot } from '@/domain/types'
import { offsetGeo } from '@/lib/geo'

// Три турбины в ряд с запада на восток: A в центре, C посередине, B в 600 м.
// Маршрут A -> B идёт над C ниже её лопастей, это конфликт

export const CENTER = { lat: 47.5, lon: 40.1 }

export function turbine(id: string, name: string, eastM: number, northM: number, extra: Partial<Turbine> = {}): Turbine {
  return { id, name, ...offsetGeo(CENTER, eastM, northM), ...extra }
}

export const FARM: Farm = {
  center: CENTER,
  defaults: { hubHeightM: 100, rotorDiameterM: 120, safeDistanceM: 30 },
  turbines: [turbine('a', 'WTG-A', 0, 0), turbine('b', 'WTG-B', 600, 0), turbine('c', 'WTG-C', 300, 0)],
}

export const ROUTE: RoutePlan = {
  algorithm: 'auto',
  params: {},
  thetaMaxDeg: 180,
  returnToTakeoff: true,
  order: ['a', 'b'],
  lengthM: 0,
  turnViolations: 0,
  source: 'auto',
  computedAt: '2026-09-24T10:00:00Z',
}

export const DRONE: DroneProfile = { ...DEFAULT_DRONE_PROFILE, cruiseSpeedMs: 10, enduranceMin: 35, reservePct: 20 }

export const HOUR: WeatherHour = {
  time: '2026-09-24T14:00',
  temperatureC: 15,
  precipitationMm: 0,
  precipitationProbabilityPct: 0,
  weatherCode: 1,
  windMs: { '10': 3, '80': 5, '120': 6, '180': 7 },
  windDirDeg: { '10': 200, '80': 210, '120': 220, '180': 230 },
  gustMs10: 5,
  humidityPct: 60,
  pressureHpa: 1015,
  cloudCoverPct: 20,
  visibilityKm: 20,
}

export const WEATHER: WeatherSnapshot = {
  fetchedAt: '2026-09-24T10:00:00Z',
  source: 'farm',
  location: CENTER,
  distanceToFarmM: 0,
  timezone: 'Europe/Moscow',
  utcOffsetSeconds: 10800,
  current: { time: '2026-09-24T13:00', temperatureC: 15, windMs10: 3, windDirDeg10: 200, gustMs10: 5, weatherCode: 1, precipitationMm: 0 },
  hourly: [HOUR],
}

export function makeMission(over: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    schemaVersion: 1,
    name: 'Облёт юг',
    type: 'planned',
    status: 'planned',
    createdAt: '2026-09-24T09:00:00Z',
    updatedAt: '2026-09-24T09:00:00Z',
    droneProfileId: DRONE.id,
    flightAltitudeM: 90,
    limits: { ...DEFAULT_LIMITS },
    farm: FARM,
    takeoff: offsetGeo(CENTER, 0, -500),
    route: ROUTE,
    ...over,
  }
}
