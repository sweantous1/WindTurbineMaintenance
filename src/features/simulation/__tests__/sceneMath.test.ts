import { describe, expect, it } from 'vitest'
import { makeLocalFrame } from '@/lib/geo'
import {
  groundTiles,
  latToTileY,
  lonToTileX,
  nacelleRotationY,
  rotorRpm,
  sceneBounds,
  tileXToLon,
  tileYToLat,
  toScene,
  yawToRotationY,
} from '../sceneMath'

// Куда смотрит нос после поворота вокруг +Y (при нуле нос на -Z)
function noseAfter(rotationY: number): { x: number; z: number } {
  return { x: -Math.sin(rotationY), z: -Math.cos(rotationY) }
}

describe('оси сцены', () => {
  it('восток — +X, север — −Z, высота — +Y', () => {
    expect(toScene({ x: 10, y: 20, z: 30 })).toEqual([10, 30, -20])
  })

  it('азимут 90° (восток) разворачивает нос на +X, 180° (юг) — на +Z', () => {
    const east = noseAfter(yawToRotationY(Math.PI / 2))
    expect(east.x).toBeCloseTo(1, 12)
    expect(east.z).toBeCloseTo(0, 12)
    const south = noseAfter(yawToRotationY(Math.PI))
    expect(south.z).toBeCloseTo(1, 12)
  })

  it('при западном ветре (дует с 270°) ротор смотрит на запад', () => {
    const nose = noseAfter(nacelleRotationY(270))
    expect(nose.x).toBeCloseTo(-1, 12)
    expect(nose.z).toBeCloseTo(0, 12)
  })
})

describe('rotorRpm', () => {
  it('стоит в штиль, до 3 м/с, выше 25 м/с и без данных', () => {
    expect(rotorRpm(null, 120)).toBe(0)
    expect(rotorRpm(undefined, 120)).toBe(0)
    expect(rotorRpm(2.9, 120)).toBe(0)
    expect(rotorRpm(26, 120)).toBe(0)
    expect(rotorRpm(NaN, 120)).toBe(0)
    expect(rotorRpm(10, 0)).toBe(0)
  })

  it('растёт с ветром и упирается в скорость конца лопасти 80 м/с', () => {
    const slow = rotorRpm(5, 120)
    const fast = rotorRpm(10, 120)
    expect(fast).toBeGreaterThan(slow)
    const max = (80 / (Math.PI * 120)) * 60
    expect(rotorRpm(20, 120)).toBeCloseTo(max, 9)
    expect(max).toBeGreaterThan(12)
    expect(max).toBeLessThan(14)
    // Большой ротор крутится медленнее
    expect(rotorRpm(20, 170)).toBeLessThan(rotorRpm(20, 120))
  })
})

describe('sceneBounds', () => {
  it('охватывает точки с полем не меньше заданного', () => {
    const b = sceneBounds([
      { x: 0, y: 0 },
      { x: 1000, y: 200 },
    ])
    expect(b.minX).toBe(-400)
    expect(b.maxX).toBe(1400)
    expect(b.minY).toBe(-400)
    expect(b.maxY).toBe(600)
  })

  it('поле — четверть размера большой фермы', () => {
    const b = sceneBounds([
      { x: 0, y: 0 },
      { x: 8000, y: 0 },
    ])
    expect(b.minX).toBe(-2000)
    expect(b.maxX).toBe(10000)
  })

  it('без точек — квадрат вокруг начала координат', () => {
    expect(sceneBounds([])).toEqual({ minX: -400, maxX: 400, minY: -400, maxY: 400 })
  })
})

describe('тайлы OSM', () => {
  it('номера тайлов совпадают с эталонными формулами OSM', () => {
    // Москва, z=10: тайл 619/320 (https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames)
    expect(lonToTileX(37.62, 10)).toBe(619)
    expect(latToTileY(55.75, 10)).toBe(320)
    expect(tileXToLon(619, 10)).toBeLessThanOrEqual(37.62)
    expect(tileXToLon(620, 10)).toBeGreaterThan(37.62)
    expect(tileYToLat(320, 10)).toBeGreaterThanOrEqual(55.75)
    expect(tileYToLat(321, 10)).toBeLessThan(55.75)
  })

  const center = { lat: 47.3, lon: 39.9 }
  const frame = makeLocalFrame(center)
  const bounds = { minX: -3000, maxX: 5000, minY: -2500, maxY: 2500 }

  it('тайлы закрывают рамку целиком и без щелей', () => {
    const tiles = groundTiles(frame, bounds, 64)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThanOrEqual(64)
    const minX = Math.min(...tiles.map((t) => t.rect.minX))
    const maxX = Math.max(...tiles.map((t) => t.rect.maxX))
    const minY = Math.min(...tiles.map((t) => t.rect.minY))
    const maxY = Math.max(...tiles.map((t) => t.rect.maxY))
    expect(minX).toBeLessThanOrEqual(bounds.minX)
    expect(maxX).toBeGreaterThanOrEqual(bounds.maxX)
    expect(minY).toBeLessThanOrEqual(bounds.minY)
    expect(maxY).toBeGreaterThanOrEqual(bounds.maxY)
    // Соседние по x тайлы стыкуются край в край
    const row = tiles.filter((t) => t.y === tiles[0].y).sort((a, b) => a.x - b.x)
    for (let i = 1; i < row.length; i++) expect(row[i].rect.minX).toBeCloseTo(row[i - 1].rect.maxX, 6)
    for (const t of tiles) {
      expect(t.rect.maxX).toBeGreaterThan(t.rect.minX)
      expect(t.rect.maxY).toBeGreaterThan(t.rect.minY)
      expect(t.url).toBe(`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`)
    }
  })

  it('чем меньше разрешено тайлов, тем крупнее масштаб', () => {
    const many = groundTiles(frame, bounds, 64)
    const few = groundTiles(frame, bounds, 4)
    expect(few.length).toBeLessThanOrEqual(4)
    expect(few[0].z).toBeLessThan(many[0].z)
  })

  it('не детальнее maxZoom', () => {
    const tiny = { minX: -50, maxX: 50, minY: -50, maxY: 50 }
    const tiles = groundTiles(frame, tiny, 64, 16)
    expect(tiles[0].z).toBe(16)
  })
})
