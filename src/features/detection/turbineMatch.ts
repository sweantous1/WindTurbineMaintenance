import type { PhotoRecord } from '@/domain/detection'
import type { Farm, GeoPoint, Turbine } from '@/domain/types'
import { haversineM } from '@/lib/geo'

// Ротор до ~85 м + дистанция облёта + погрешность GPS; соседние турбины обычно от 300 м
export const GPS_MATCH_RADIUS_M = 300

export interface TurbineSuggestion {
  turbine: Turbine
  distanceM: number
}

const validPoint = (p: GeoPoint) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180

// Ближайшая турбина к точке съёмки, если она не дальше радиуса
export function nearestTurbine(
  gps: GeoPoint | undefined,
  turbines: readonly Turbine[] | undefined,
  maxDistanceM = GPS_MATCH_RADIUS_M,
): TurbineSuggestion | undefined {
  if (!gps || !validPoint(gps) || !turbines?.length) return undefined
  let best: TurbineSuggestion | undefined
  for (const turbine of turbines) {
    if (!validPoint(turbine)) continue
    const distanceM = haversineM(gps, turbine)
    if (!best || distanceM < best.distanceM) best = { turbine, distanceM }
  }
  return best && best.distanceM <= maxDistanceM ? best : undefined
}

export interface GpsAssignment {
  photoId: string
  turbineId: string
  distanceM: number
}

// Только фото без турбины, выбор оператора не трогаем
export function gpsAssignments(photos: readonly Pick<PhotoRecord, 'id' | 'gps' | 'turbineId'>[], farm: Pick<Farm, 'turbines'> | undefined): GpsAssignment[] {
  if (!farm) return []
  const out: GpsAssignment[] = []
  for (const p of photos) {
    if (p.turbineId) continue
    const s = nearestTurbine(p.gps, farm.turbines)
    if (s) out.push({ photoId: p.id, turbineId: s.turbine.id, distanceM: s.distanceM })
  }
  return out
}

// По имени с учётом чисел: T2 раньше T10
export function sortedTurbines(turbines: readonly Turbine[]): Turbine[] {
  return [...turbines].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export type TurbineRef =
  | { kind: 'assigned'; turbine: Turbine }
  // Турбину удалили из фермы уже после привязки
  | { kind: 'missing'; turbineId: string }
  | { kind: 'suggested'; suggestion: TurbineSuggestion }
  | { kind: 'none' }

export function turbineRef(photo: Pick<PhotoRecord, 'gps' | 'turbineId'>, farm: Pick<Farm, 'turbines'> | undefined): TurbineRef {
  if (photo.turbineId) {
    const turbine = farm?.turbines.find((tb) => tb.id === photo.turbineId)
    return turbine ? { kind: 'assigned', turbine } : { kind: 'missing', turbineId: photo.turbineId }
  }
  const suggestion = nearestTurbine(photo.gps, farm?.turbines)
  return suggestion ? { kind: 'suggested', suggestion } : { kind: 'none' }
}
