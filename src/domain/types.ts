// Предметная модель приложения. Единицы измерения — в именах полей (M — метры, Ms — м/с, Km, Pct...).
// Координаты хранятся в WGS84 (lat, lon); для расчётов их переводят в локальные метры (src/lib/geo.ts).

export interface GeoPoint {
  lat: number
  lon: number
}

// ---------- Ферма ----------

export interface Turbine {
  id: string
  name: string
  lat: number
  lon: number
  groundAltM?: number
  // Если не заданы — берутся из Farm.defaults
  hubHeightM?: number
  rotorDiameterM?: number
}

export interface FarmDefaults {
  hubHeightM: number
  rotorDiameterM: number
  // Минимальная дистанция от конца лопасти до дрона
  safeDistanceM: number
}

export interface Farm {
  name?: string
  center: GeoPoint
  source?: {
    fileName: string
    sha256: string
    importedAt: string
  }
  defaults: FarmDefaults
  turbines: Turbine[]
}

// ---------- Дрон и лимиты ----------

export interface DroneProfile {
  id: string
  name: string
  maxWindMs: number
  maxGustMs: number
  cruiseSpeedMs: number
  enduranceMin: number
  // Какую долю заряда оставлять в запасе, %
  reservePct: number
  maxAltitudeM: number
}

export interface MissionLimits {
  maxWindMs: number
  maxGustMs: number
  maxPrecipMmH: number
  minVisibilityKm: number
  minTempC: number
  maxTempC: number
  // Потолок высоты полёта (регуляторный или по договорённости), м над землёй
  maxAltitudeM: number
}

// ---------- Маршрут ----------

export type RouteAlgorithm = 'auto' | 'aco' | 'ga'

export interface RoutePlan {
  algorithm: RouteAlgorithm
  // ACO: iterations, ants, alpha, beta, rho, q, seed; GA: generations, population, mutationRate, crossoverRate, seed
  params: Record<string, number>
  // Максимальный угол поворота, градусы; 180 — без ограничения
  thetaMaxDeg: number
  returnToTakeoff: boolean
  // Порядок облёта — id турбин
  order: string[]
  // Длина плана полёта целиком (взлёт, транзит, облёты, возврат), м
  lengthM: number
  turnViolations: number
  // 'edited' — порядок или ферму правили руками после расчёта
  source: 'auto' | 'edited'
  computedAt: string
}

// ---------- Погода ----------

export type WindLevel = '10' | '80' | '120' | '180'
export const WIND_LEVELS_M: readonly number[] = [10, 80, 120, 180]

export interface WeatherHour {
  // Локальное время фермы в формате Open-Meteo: '2026-09-24T14:00'
  time: string
  temperatureC: number | null
  precipitationMm: number | null
  precipitationProbabilityPct: number | null
  weatherCode: number | null
  windMs: Record<WindLevel, number | null>
  windDirDeg: Record<WindLevel, number | null>
  gustMs10: number | null
  humidityPct: number | null
  pressureHpa: number | null
  cloudCoverPct: number | null
  visibilityKm: number | null
}

export interface WeatherCurrent {
  time: string
  temperatureC: number | null
  windMs10: number | null
  windDirDeg10: number | null
  gustMs10: number | null
  weatherCode: number | null
  precipitationMm: number | null
}

export interface WeatherSnapshot {
  fetchedAt: string
  source: 'farm' | 'geocode' | 'manual'
  location: GeoPoint & { name?: string }
  // Расстояние от точки прогноза до центра фермы, если ферма есть
  distanceToFarmM?: number
  timezone: string
  utcOffsetSeconds: number
  current: WeatherCurrent
  hourly: WeatherHour[]
}

// ---------- План полёта (вычисляется, не хранится) ----------

export type WaypointKind = 'takeoff' | 'transit' | 'orbit' | 'landing'

export interface FlightWaypoint {
  kind: WaypointKind
  turbineId?: string
  lat: number
  lon: number
  // Высота над землёй, м
  altM: number
}

export interface FlightConflict {
  // Отрезок транзита проходит слишком близко к турбине, которую не облетают на этом отрезке
  segmentIndex: number
  turbineId: string
  distanceM: number
  minDistanceM: number
}

export interface FlightPlan {
  waypoints: FlightWaypoint[]
  transitAltM: number
  // Все высоты, на которых дрон окажется (для проверки ветра)
  altitudeLevelsM: number[]
  maxAltM: number
  lengthM: number
  turbineOrder: string[]
  conflicts: FlightConflict[]
}

// ---------- Миссия ----------

export type MissionStatus = 'draft' | 'planned' | 'ready' | 'flown' | 'analyzed' | 'archived'
export type MissionType = 'planned' | 'emergency' | 'post_storm'

export interface Mission {
  id: string
  schemaVersion: 1
  name: string
  type: MissionType
  status: MissionStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
  droneProfileId: string
  // Высота транзита между турбинами, м над землёй
  flightAltitudeM: number
  limits: MissionLimits
  farm?: Farm
  takeoff?: GeoPoint
  route?: RoutePlan
  weather?: WeatherSnapshot
  // Выбранный час вылета — значение WeatherHour.time
  departureTime?: string
  // Профиль дрона на момент завершения полёта: правка профиля в настройках
  // не должна задним числом менять вердикт и оценку заряда облетанной миссии
  droneSnapshot?: DroneProfile
  notes?: string
}

// Поля миссии, которые правятся через репозиторий
export type MissionPatch = Partial<Omit<Mission, 'id' | 'schemaVersion' | 'createdAt' | 'updatedAt' | 'status' | 'completedAt' | 'droneSnapshot'>>
