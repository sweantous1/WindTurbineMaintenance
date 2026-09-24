import type { Farm, FarmDefaults, GeoPoint, Mission, RoutePlan } from '@/domain/types'
import { DEFAULT_FARM_DEFAULTS } from '@/domain/defaults'
import { centroid, offsetGeo } from '@/lib/geo'

export const BASE: GeoPoint = { lat: 52.02, lon: 18.5 }

// Точка в метрах на восток и север от BASE
export const at = (eastM: number, northM: number): GeoPoint => offsetGeo(BASE, eastM, northM)

// Ферма из смещений в метрах; id t1..tn, имена T1..Tn
export function makeFarm(offsets: readonly (readonly [number, number])[], defaults: Partial<FarmDefaults> = {}): Farm {
  const turbines = offsets.map(([e, n], i) => ({ id: `t${i + 1}`, name: `T${i + 1}`, ...at(e, n) }))
  return { center: centroid(turbines), defaults: { ...DEFAULT_FARM_DEFAULTS, ...defaults }, turbines }
}

// Ряд из n турбин с запада на восток через каждые spacingM метров
export function lineFarm(n: number, spacingM = 400): Farm {
  return makeFarm(Array.from({ length: n }, (_, i) => [i * spacingM, 0] as const))
}

export function makeRoute(order: string[], over: Partial<RoutePlan> = {}): RoutePlan {
  return {
    algorithm: 'auto',
    params: { seed: 1 },
    thetaMaxDeg: 180,
    returnToTakeoff: true,
    order,
    lengthM: 0,
    turnViolations: 0,
    source: 'auto',
    computedAt: '2026-09-24T10:00:00.000Z',
    ...over,
  }
}

export type MissionFields = Pick<Mission, 'farm' | 'takeoff' | 'route' | 'flightAltitudeM'>
