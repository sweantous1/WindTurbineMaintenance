import type { DroneProfile, FarmDefaults, MissionLimits } from './types'

export const DEFAULT_DRONE_PROFILE_ID = 'default'

// Условный инспекционный квадрокоптер; профиль редактируется в настройках
export const DEFAULT_DRONE_PROFILE: DroneProfile = {
  id: DEFAULT_DRONE_PROFILE_ID,
  name: 'Квадрокоптер (по умолчанию)',
  maxWindMs: 12,
  maxGustMs: 15,
  cruiseSpeedMs: 10,
  enduranceMin: 35,
  reservePct: 20,
  maxAltitudeM: 120,
}

export const DEFAULT_LIMITS: MissionLimits = {
  maxWindMs: 12,
  maxGustMs: 15,
  maxPrecipMmH: 0.5,
  minVisibilityKm: 3,
  minTempC: -10,
  maxTempC: 40,
  maxAltitudeM: 120,
}

export const DEFAULT_FARM_DEFAULTS: FarmDefaults = {
  hubHeightM: 100,
  rotorDiameterM: 120,
  safeDistanceM: 30,
}

export const DEFAULT_FLIGHT_ALTITUDE_M = 90

// Доля лимита, начиная с которой погода считается «на грани»
export const MARGINAL_FRACTION = 0.8
