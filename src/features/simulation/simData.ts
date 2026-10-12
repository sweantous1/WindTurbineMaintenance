import { useMemo } from 'react'
import { effectiveLimits, estimateMission, planWorstWindMs, type MissionEstimate } from '@/domain/flightCheck'
import { buildTrajectory, type Trajectory } from '@/domain/flightPath'
import { orbitRadiusM, turbineHubM, turbineRotorM } from '@/domain/flightPlan'
import { WIND_LEVELS_M, type DroneProfile, type FlightPlan, type Mission, type WeatherHour, type WindLevel } from '@/domain/types'
import { gustAtAltitude, windAtAltitude } from '@/domain/weather'
import { departureHour } from '@/features/mission/missionView'
import { planFor, routeContext } from '@/features/route/routeLogic'
import { makeLocalFrame, type LocalFrame, type LocalPoint } from '@/lib/geo'
import { sceneBounds, type LocalBounds } from './sceneMath'

// Данные для сцены и панели из миссии и профиля дрона. План строим как на экране маршрута,
// чтобы путь в 3D совпадал с картой

// Чего не хватает для облёта: фермы, маршрута или скорости дрона
export type SimGap = 'farm' | 'route' | 'speed'

export interface SimTurbine {
  id: string
  name: string
  local: LocalPoint
  hubM: number
  rotorM: number
  orbitRadiusM: number
  // Номер в порядке облёта с нуля, null если турбины нет в маршруте
  visitIndex: number | null
  // Какой-то отрезок плана заходит в безопасную зону этой башни
  conflict: boolean
}

export interface SimWind {
  hour: WeatherHour
  // На высоте транзита плана
  transitMs: number | null
  // На средней высоте ступиц: по нему крутятся роторы
  hubMs: number | null
  // Порывы на высоте транзита
  gustMs: number | null
  // Откуда дует, градусы: уровень прогноза с данными, ближайший к средней высоте ступиц
  fromDeg: number | null
}

export interface SimReady {
  kind: 'ready'
  plan: FlightPlan
  trajectory: Trajectory
  frame: LocalFrame
  bounds: LocalBounds
  takeoff: LocalPoint
  turbines: SimTurbine[]
  // Номера отрезков траектории (= FlightConflict.segmentIndex), которые заходят в зону башен
  conflictSegments: ReadonlySet<number>
  // null, если нет прогноза или не выбран час вылета
  wind: SimWind | null
  estimate: MissionEstimate
}

export type SimData = { kind: 'gap'; gap: SimGap } | SimReady

export function buildSimData(mission: Mission, drone: DroneProfile): SimData {
  const { farm, route } = mission
  if (!farm || farm.turbines.length === 0) return { kind: 'gap', gap: 'farm' }
  const ctx = routeContext(mission, effectiveLimits(mission.limits, drone).maxAltitudeM)
  if (!ctx || !route || route.order.length === 0) return { kind: 'gap', gap: 'route' }
  const plan = planFor(ctx, route.order, route.returnToTakeoff)
  // В порядке только удалённые турбины, облетать нечего
  if (plan.turbineOrder.length === 0) return { kind: 'gap', gap: 'route' }
  // buildTrajectory бросает RangeError на неположительной или нечисловой скорости
  if (!(drone.cruiseSpeedMs > 0) || !Number.isFinite(drone.cruiseSpeedMs)) return { kind: 'gap', gap: 'speed' }

  const trajectory = buildTrajectory(plan, farm, drone.cruiseSpeedMs)
  const frame = makeLocalFrame(farm.center)
  const takeoff = frame.toLocal(ctx.takeoff)
  const visitIndexOf = new Map(plan.turbineOrder.map((id, i) => [id, i]))
  const conflicted = new Set(plan.conflicts.map((c) => c.turbineId))
  const turbines: SimTurbine[] = farm.turbines.map((t) => ({
    id: t.id,
    name: t.name,
    local: frame.toLocal(t),
    hubM: turbineHubM(farm, t),
    rotorM: turbineRotorM(farm, t),
    orbitRadiusM: orbitRadiusM(farm, t),
    visitIndex: visitIndexOf.get(t.id) ?? null,
    conflict: conflicted.has(t.id),
  }))
  const meanHubM = turbines.reduce((sum, t) => sum + t.hubM, 0) / turbines.length
  const wind = simWind(departureHour(mission), plan.transitAltM, meanHubM)

  return {
    kind: 'ready',
    plan,
    trajectory,
    frame,
    bounds: sceneBounds([...turbines.map((t) => t.local), takeoff]),
    takeoff,
    turbines,
    conflictSegments: new Set(plan.conflicts.map((c) => c.segmentIndex)),
    wind,
    // Для заряда берём худший ветер на высотах плана, как вердикт часа на экране погоды
    estimate: estimateMission(plan.lengthM, drone, wind ? planWorstWindMs(wind.hour, plan) : undefined),
  }
}

function simWind(hour: WeatherHour | undefined, transitAltM: number, hubAltM: number): SimWind | null {
  if (!hour) return null
  return {
    hour,
    transitMs: windAtAltitude(hour, transitAltM).ms,
    hubMs: windAtAltitude(hour, hubAltM).ms,
    gustMs: gustAtAltitude(hour, transitAltM),
    fromDeg: windDirNear(hour, hubAltM),
  }
}

// Направление не интерполируем (350° и 10° дали бы 180°), берём ближайший уровень с данными
export function windDirNear(hour: WeatherHour, altM: number): number | null {
  let best: { gap: number; deg: number } | null = null
  for (const level of WIND_LEVELS_M) {
    const deg = hour.windDirDeg?.[String(level) as WindLevel]
    if (deg == null || !Number.isFinite(deg)) continue
    const gap = Math.abs(level - altM)
    if (!best || gap < best.gap) best = { gap, deg }
  }
  return best ? best.deg : null
}

// undefined, пока профиль дрона грузится
export function useSimData(mission: Mission, drone: DroneProfile | undefined): SimData | undefined {
  return useMemo(() => (drone ? buildSimData(mission, drone) : undefined), [mission, drone])
}
