import type { LocalFrame, LocalPoint } from '@/lib/geo'
import type { Vec3 } from '@/domain/flightPath'

// Переход из локальных метров фермы в сцену three.js. Карта, маршрут и 3D считают в одной
// системе координат (src/lib/geo.ts), поэтому турбины и путь в сцене совпадают с картой.
// Оси сцены: X — восток, Y — вверх, Z — юг (север — это −Z)

export type SceneVec = [number, number, number]

export function toScene(p: Vec3): SceneVec {
  return [p.x, p.z, -p.y]
}

// Поворот вокруг вертикали для объекта, у которого «нос» смотрит на север (−Z) при нулевом
// повороте. Азимут отсчитывается по часовой стрелке, а поворот вокруг +Y — против неё
export function yawToRotationY(bearingRad: number): number {
  return -bearingRad
}

// Ротор разворачивается навстречу ветру. Направление ветра в метеорологии — откуда он дует,
// поэтому нос гондолы (сторона с ротором) смотрит на азимут windFromDeg
export function nacelleRotationY(windFromDeg: number): number {
  return yawToRotationY((windFromDeg * Math.PI) / 180)
}

// Обороты ротора по ветру на высоте ступицы: типичная ветроустановка стоит до 3 м/с,
// флюгирует лопасти выше 25 м/с, между ними держит быстроходность около 7 и не разгоняет
// концы лопастей быстрее 80 м/с. Для D = 120 м это до ~13 об/мин — как у настоящих машин
export const CUT_IN_MS = 3
export const CUT_OUT_MS = 25
const TIP_SPEED_RATIO = 7
const MAX_TIP_SPEED_MS = 80

export function rotorRpm(windMs: number | null | undefined, rotorDiameterM: number): number {
  if (windMs == null || !Number.isFinite(windMs) || !(rotorDiameterM > 0)) return 0
  if (windMs < CUT_IN_MS || windMs > CUT_OUT_MS) return 0
  const tipSpeed = Math.min(TIP_SPEED_RATIO * windMs, MAX_TIP_SPEED_MS)
  return (tipSpeed / (Math.PI * rotorDiameterM)) * 60
}

export interface LocalBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

// Рамка сцены: все турбины и взлётка плюс поля, чтобы земля не обрывалась у крайней башни
export function sceneBounds(points: readonly LocalPoint[], minMarginM = 400): LocalBounds {
  if (points.length === 0) return { minX: -minMarginM, maxX: minMarginM, minY: -minMarginM, maxY: minMarginM }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const margin = Math.max(minMarginM, 0.25 * Math.max(maxX - minX, maxY - minY))
  return { minX: minX - margin, maxX: maxX + margin, minY: minY - margin, maxY: maxY + margin }
}

export function boundsSize(b: LocalBounds): { width: number; depth: number; center: LocalPoint } {
  return { width: b.maxX - b.minX, depth: b.maxY - b.minY, center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } }
}

// ---------- Подложка из тайлов OpenStreetMap ----------

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const MAX_MERCATOR_LAT = 85.05112878

export interface GroundTile {
  z: number
  x: number
  y: number
  url: string
  // Прямоугольник тайла в локальных метрах. Локальная система линейна по широте и долготе
  // отдельно, поэтому края тайла (линии постоянной широты и долготы) в ней — стороны
  // прямоугольника. Внутри тайла меркатор по широте нелинеен, но на тайле в пару километров
  // это доли метра
  rect: LocalBounds
}

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

export function latToTileY(lat: number, z: number): number {
  const phi = (Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** z)
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

export function tileYToLat(y: number, z: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
}

// Самый подробный масштаб, при котором рамку закрывают не больше maxTiles тайлов.
// Ограничение числа тайлов — ещё и вежливость к серверам OSM
export function groundTiles(frame: LocalFrame, bounds: LocalBounds, maxTiles = 64, maxZoom = 16): GroundTile[] {
  const sw = frame.toGeo({ x: bounds.minX, y: bounds.minY })
  const ne = frame.toGeo({ x: bounds.maxX, y: bounds.maxY })
  for (let z = maxZoom; z >= 0; z--) {
    const n = 2 ** z
    const clamp = (v: number) => Math.min(n - 1, Math.max(0, v))
    const x0 = clamp(lonToTileX(sw.lon, z))
    const x1 = clamp(lonToTileX(ne.lon, z))
    // Номера тайлов по y растут к югу
    const y0 = clamp(latToTileY(ne.lat, z))
    const y1 = clamp(latToTileY(sw.lat, z))
    const count = (x1 - x0 + 1) * (y1 - y0 + 1)
    if (count > maxTiles && z > 0) continue
    const tiles: GroundTile[] = []
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nw = frame.toLocal({ lat: tileYToLat(y, z), lon: tileXToLon(x, z) })
        const se = frame.toLocal({ lat: tileYToLat(y + 1, z), lon: tileXToLon(x + 1, z) })
        tiles.push({
          z,
          x,
          y,
          url: OSM_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)),
          rect: { minX: nw.x, maxX: se.x, minY: se.y, maxY: nw.y },
        })
      }
    }
    return tiles
  }
  return []
}
