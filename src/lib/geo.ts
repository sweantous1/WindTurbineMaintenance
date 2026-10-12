import type { GeoPoint } from '@/domain/types'

// Храним WGS84, считаем в локальных метрах (ENU) от центра фермы. Одна система для карты,
// маршрута, прогноза и 3D, без зашитой зоны UTM и меркатора

export interface LocalPoint {
  // Метры на восток от начала координат
  x: number
  // Метры на север от начала координат
  y: number
}

export interface LocalFrame {
  origin: GeoPoint
  toLocal(p: GeoPoint): LocalPoint
  toGeo(p: LocalPoint): GeoPoint
}

const WGS84_A = 6378137
const WGS84_E2 = 6.69437999014e-3
const EARTH_R = 6371008.8
const RAD = Math.PI / 180

// Касательная плоскость в origin с радиусами кривизны эллипсоида. Против Винсенти до 10 км
// ошибка меньше 0,05%, до 30 км около 0,1%, для фермы хватает
export function makeLocalFrame(origin: GeoPoint): LocalFrame {
  const phi = origin.lat * RAD
  const sin = Math.sin(phi)
  const w = Math.sqrt(1 - WGS84_E2 * sin * sin)
  // Радиус кривизны меридиана и первого вертикала
  const meridional = (WGS84_A * (1 - WGS84_E2)) / (w * w * w)
  const primeVertical = WGS84_A / w
  const metersPerDegLat = meridional * RAD
  const metersPerDegLon = primeVertical * Math.cos(phi) * RAD

  return {
    origin,
    toLocal: (p) => ({
      x: (p.lon - origin.lon) * metersPerDegLon,
      y: (p.lat - origin.lat) * metersPerDegLat,
    }),
    toGeo: (p) => ({
      lat: origin.lat + p.y / metersPerDegLat,
      lon: origin.lon + p.x / metersPerDegLon,
    }),
  }
}

export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function centroid(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) throw new Error('Нельзя найти центр пустого набора точек')
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), { lat: 0, lon: 0 })
  return { lat: sum.lat / points.length, lon: sum.lon / points.length }
}

export function bbox(points: GeoPoint[]): { south: number; west: number; north: number; east: number } {
  if (points.length === 0) throw new Error('Нельзя найти границы пустого набора точек')
  return points.reduce(
    (b, p) => ({
      south: Math.min(b.south, p.lat),
      west: Math.min(b.west, p.lon),
      north: Math.max(b.north, p.lat),
      east: Math.max(b.east, p.lon),
    }),
    { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity },
  )
}

export function dist2D(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function distPointToSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist2D(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Азимут: 0° север, по часовой
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const phi1 = a.lat * RAD
  const phi2 = b.lat * RAD
  const dLon = (b.lon - a.lon) * RAD
  const y = Math.sin(dLon) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

export function offsetGeo(p: GeoPoint, eastM: number, northM: number): GeoPoint {
  return makeLocalFrame(p).toGeo({ x: eastM, y: northM })
}
