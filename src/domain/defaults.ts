import type { DroneProfile, FarmDefaults, MissionLimits } from './types'

export const DEFAULT_DRONE_PROFILE_ID = 'default'

// Старое имя встроенного профиля - встречается в сохранённых базах и снимках миссий
export const LEGACY_DEFAULT_DRONE_NAME = 'Квадрокоптер (по умолчанию)'

// Условный квадрокоптер, правится в настройках. "По умолчанию" показывает плашка, не имя
export const DEFAULT_DRONE_PROFILE: DroneProfile = {
  id: DEFAULT_DRONE_PROFILE_ID,
  name: 'Квадрокоптер',
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

// Один диапазон высоты на все экраны, иначе значение с одного экрана не сохранится на другом
export const FLIGHT_ALTITUDE_MIN_M = 10
export const FLIGHT_ALTITUDE_MAX_M = 500

// Доля лимита, с которой погода "на грани"
export const MARGINAL_FRACTION = 0.8
