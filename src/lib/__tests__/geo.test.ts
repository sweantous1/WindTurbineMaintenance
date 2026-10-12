import { describe, expect, it } from 'vitest'
import type { GeoPoint } from '@/domain/types'
import { bbox, bearingDeg, centroid, distPointToSegment, haversineM, makeLocalFrame, offsetGeo, type LocalPoint } from '@/lib/geo'

const RAD = Math.PI / 180

// Для сверки: обратная задача Винсенти на WGS84 (погрешность доли мм).
// haversineM считает на сфере и сам расходится с эллипсоидом на десятые доли процента
function vincentyM(p1: GeoPoint, p2: GeoPoint): number {
  const a = 6378137
  const f = 1 / 298.257223563
  const b = a * (1 - f)
  const L = (p2.lon - p1.lon) * RAD
  const u1 = Math.atan((1 - f) * Math.tan(p1.lat * RAD))
  const u2 = Math.atan((1 - f) * Math.tan(p2.lat * RAD))
  const [sinU1, cosU1, sinU2, cosU2] = [Math.sin(u1), Math.cos(u1), Math.sin(u2), Math.cos(u2)]
  let lambda = L
  let prev: number
  let sinSigma: number
  let cosSigma: number
  let sigma: number
  let cos2Alpha: number
  let cos2SigmaM: number
  let iter = 0
  do {
    const sinL = Math.sin(lambda)
    const cosL = Math.cos(lambda)
    sinSigma = Math.hypot(cosU2 * sinL, cosU1 * sinU2 - sinU1 * cosU2 * cosL)
    if (sinSigma === 0) return 0
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL
    sigma = Math.atan2(sinSigma, cosSigma)
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma
    cos2Alpha = 1 - sinAlpha * sinAlpha
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha))
    prev = lambda
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)))
  } while (Math.abs(lambda - prev) > 1e-12 && ++iter < 200)
  const uSq = (cos2Alpha * (a * a - b * b)) / (b * b)
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM + (B / 4) * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)))
  return b * A * (sigma - deltaSigma)
}

const ORIGINS: GeoPoint[] = [
  { lat: 48, lon: 18.5 },
  { lat: 52, lon: 18.5 },
]

// Точки на окружностях вокруг начала координат через каждые 5° азимута
function ringPoints(maxRadiusM: number, radiusStepM: number): LocalPoint[] {
  const points: LocalPoint[] = []
  for (let r = radiusStepM; r <= maxRadiusM; r += radiusStepM) {
    for (let az = 0; az < 360; az += 5) points.push({ x: r * Math.sin(az * RAD), y: r * Math.cos(az * RAD) })
  }
  return points
}

// Худшее относительное расхождение длины в локальной системе с расстоянием reference
function maxRelativeError(origin: GeoPoint, maxRadiusM: number, reference: (a: GeoPoint, b: GeoPoint) => number): number {
  const frame = makeLocalFrame(origin)
  let worst = 0
  for (const p of ringPoints(maxRadiusM, 500)) {
    const expected = reference(origin, frame.toGeo(p))
    worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y) - expected) / expected)
  }
  return worst
}

function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

describe('эталон Винсенти', () => {
  it('воспроизводит классический пример (Flinders Peak — Buninyong, 54 972,271 м)', () => {
    const dms = (d: number, m: number, s: number) => Math.sign(d) * (Math.abs(d) + m / 60 + s / 3600)
    const flinders = { lat: dms(-37, 57, 3.7203), lon: dms(144, 25, 29.5244) }
    const buninyong = { lat: dms(-37, 39, 10.1561), lon: dms(143, 55, 35.3839) }
    expect(vincentyM(flinders, buninyong)).toBeCloseTo(54972.271, 3)
  })
})

describe('makeLocalFrame', () => {
  it.each(ORIGINS)('toLocal/toGeo туда-обратно точнее 1 мм до 30 км (широта $lat°)', (origin) => {
    const frame = makeLocalFrame(origin)
    for (const p of [{ x: 0, y: 0 }, { x: 0.001, y: -0.002 }, ...ringPoints(30000, 2500)]) {
      const back = frame.toLocal(frame.toGeo(p))
      expect(Math.hypot(back.x - p.x, back.y - p.y)).toBeLessThan(0.001)
      const geo = frame.toGeo(p)
      expect(haversineM(frame.toGeo(frame.toLocal(geo)), geo)).toBeLessThan(0.001)
    }
  })

  it('x — метры на восток, y — метры на север', () => {
    const origin = ORIGINS[0]
    const frame = makeLocalFrame(origin)
    expect(frame.origin).toEqual(origin)
    expect(frame.toLocal(origin)).toEqual({ x: 0, y: 0 })
    const east = frame.toGeo({ x: 1000, y: 0 })
    expect(east.lat).toBe(origin.lat)
    expect(east.lon).toBeGreaterThan(origin.lon)
    const north = frame.toGeo({ x: 0, y: 1000 })
    expect(north.lon).toBe(origin.lon)
    expect(north.lat).toBeGreaterThan(origin.lat)
  })

  it.each(ORIGINS)('до 10 км от центра расхождение с геодезическим расстоянием меньше 0,05% (широта $lat°)', (origin) => {
    expect(maxRelativeError(origin, 10000, vincentyM)).toBeLessThan(0.0005)
  })

  // Масштаб по долготе берётся по широте центра, поэтому ошибка растёт линейно с удалением:
  // около 0,0035% на км, на 30 км 0,10% (48°) и 0,12% (52°)
  it.each(ORIGINS)('до 30 км от центра расхождение с геодезическим расстоянием меньше 0,12% (широта $lat°)', (origin) => {
    expect(maxRelativeError(origin, 30000, vincentyM)).toBeLessThan(0.0012)
  })

  it.each(ORIGINS)('до 30 км от центра расхождение меньше 0,12% (широта $lat°)', (origin) => {
    expect(maxRelativeError(origin, 30000, vincentyM)).toBeLessThan(0.0012)
  })

  // Сфера и эллипсоид на этих широтах расходятся до 0,3% по востоку, так что сверка
  // с haversineM показывает скорее модель Земли, чем качество проекции
  it.each(ORIGINS)('против haversineM до 30 км расхождение меньше 0,4% (широта $lat°)', (origin) => {
    expect(maxRelativeError(origin, 30000, haversineM)).toBeLessThan(0.004)
  })

  it.each(ORIGINS)('по меридиану расхождение с геодезическим расстоянием меньше 0,005% до 30 км (широта $lat°)', (origin) => {
    const frame = makeLocalFrame(origin)
    for (let y = -30000; y <= 30000; y += 1000) {
      if (y === 0) continue
      expect(Math.abs(Math.abs(y) - vincentyM(origin, frame.toGeo({ x: 0, y }))) / Math.abs(y)).toBeLessThan(0.00005)
    }
  })
})

describe('distPointToSegment', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 10, y: 0 }

  it('перпендикуляр внутри отрезка', () => {
    expect(distPointToSegment({ x: 5, y: 5 }, a, b)).toBeCloseTo(5, 12)
    expect(distPointToSegment({ x: 0, y: 10 }, a, { x: 10, y: 10 })).toBeCloseTo(Math.SQRT2 * 5, 12)
  })

  it('за концами отрезка — расстояние до ближайшего конца', () => {
    expect(distPointToSegment({ x: 13, y: 4 }, a, b)).toBeCloseTo(5, 12)
    expect(distPointToSegment({ x: -3, y: -4 }, a, b)).toBeCloseTo(5, 12)
  })

  it('точка на отрезке — ноль, вырожденный отрезок — расстояние до точки', () => {
    expect(distPointToSegment({ x: 7, y: 0 }, a, b)).toBe(0)
    expect(distPointToSegment({ x: 4, y: 5 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(5, 12)
  })
})

describe('bearingDeg', () => {
  const base = ORIGINS[1]

  it('стороны света: 0° — север, по часовой стрелке', () => {
    expect(angleDiffDeg(bearingDeg(base, offsetGeo(base, 0, 1000)), 0)).toBeLessThan(1e-9)
    expect(angleDiffDeg(bearingDeg(base, offsetGeo(base, 1000, 0)), 90)).toBeLessThan(0.01)
    expect(angleDiffDeg(bearingDeg(base, offsetGeo(base, 0, -1000)), 180)).toBeLessThan(1e-9)
    expect(angleDiffDeg(bearingDeg(base, offsetGeo(base, -1000, 0)), 270)).toBeLessThan(0.01)
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 12)
  })

  it('через антимеридиан — кратчайшее направление, а не разворот', () => {
    expect(angleDiffDeg(bearingDeg({ lat: 10, lon: 179.99 }, { lat: 10, lon: -179.99 }), 90)).toBeLessThan(0.01)
    expect(angleDiffDeg(bearingDeg({ lat: 10, lon: -179.99 }, { lat: 10, lon: 179.99 }), 270)).toBeLessThan(0.01)
  })

  // bearingDeg на сфере, а локальная система на эллипсоиде с разными радиусами по меридиану
  // и параллели, поэтому по диагоналям азимуты расходятся до ~0,09°
  it('всегда в диапазоне [0, 360) и сходится с направлением в локальной системе', () => {
    for (let az = 0; az < 360; az += 15) {
      const target = offsetGeo(base, 500 * Math.sin(az * RAD), 500 * Math.cos(az * RAD))
      const bearing = bearingDeg(base, target)
      expect(bearing).toBeGreaterThanOrEqual(0)
      expect(bearing).toBeLessThan(360)
      expect(angleDiffDeg(bearing, az)).toBeLessThan(0.1)
    }
  })
})

describe('offsetGeo', () => {
  const base = ORIGINS[0]

  it('нулевой сдвиг возвращает ту же точку', () => {
    expect(offsetGeo(base, 0, 0)).toEqual(base)
  })

  it('сдвиг на 500 м к востоку и 300 м к северу', () => {
    const p = offsetGeo(base, 500, 300)
    const expectedM = Math.hypot(500, 300)
    expect(Math.abs(vincentyM(base, p) - expectedM) / expectedM).toBeLessThan(0.0001)
    expect(angleDiffDeg(bearingDeg(base, p), Math.atan2(500, 300) / RAD)).toBeLessThan(0.1)
    const local = makeLocalFrame(base).toLocal(p)
    expect(local.x).toBeCloseTo(500, 6)
    expect(local.y).toBeCloseTo(300, 6)
  })
})

describe('centroid и bbox', () => {
  const points = [
    { lat: 52, lon: 18 },
    { lat: 52.2, lon: 18.4 },
    { lat: 52.1, lon: 18.2 },
  ]

  it('центр и границы набора точек', () => {
    const c = centroid(points)
    expect(c.lat).toBeCloseTo(52.1, 12)
    expect(c.lon).toBeCloseTo(18.2, 12)
    expect(bbox(points)).toEqual({ south: 52, west: 18, north: 52.2, east: 18.4 })
  })

  it('пустой набор — ошибка', () => {
    expect(() => centroid([])).toThrow()
    expect(() => bbox([])).toThrow()
  })
})
