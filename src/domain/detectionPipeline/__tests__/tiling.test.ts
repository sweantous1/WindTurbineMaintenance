import { describe, expect, it } from 'vitest'
import { planTiles, type TileRect } from '../tiling'

const starts = (tiles: TileRect[], axis: 'x' | 'y') => [...new Set(tiles.map((t) => t[axis]))].sort((a, b) => a - b)

// Без дыр: каждая точка сетки с шагом step попадает хотя бы в один фрагмент
function uncovered(tiles: TileRect[], width: number, height: number, step: number): number {
  let misses = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!tiles.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)) misses++
    }
  }
  // Последние строку и столбец проверяем отдельно, сетка их не задевает
  for (let x = 0; x < width; x += step) if (!tiles.some((t) => x >= t.x && x < t.x + t.w && t.y + t.h === height)) misses++
  for (let y = 0; y < height; y += step) if (!tiles.some((t) => y >= t.y && y < t.y + t.h && t.x + t.w === width)) misses++
  return misses
}

describe('planTiles', () => {
  it('кадр 8192×5460 режется на 16×11 = 176 фрагментов 640×640 без дыр и без выхода за край', () => {
    const tiles = planTiles(8192, 5460)
    expect(tiles).toHaveLength(176)
    const xs = starts(tiles, 'x')
    const ys = starts(tiles, 'y')
    expect(xs).toHaveLength(16)
    expect(ys).toHaveLength(11)
    for (const t of tiles) {
      expect(t.w).toBe(640)
      expect(t.h).toBe(640)
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w).toBeLessThanOrEqual(8192)
      expect(t.y + t.h).toBeLessThanOrEqual(5460)
    }
    // Шаг 512 (перекрытие 20%), последние ряд и столбец прижаты к краю
    expect(xs.slice(0, 3)).toEqual([0, 512, 1024])
    expect(xs.at(-1)).toBe(8192 - 640)
    expect(ys.at(-1)).toBe(5460 - 640)
    for (const list of [xs, ys]) {
      for (let i = 1; i < list.length; i++) {
        const gap = list[i] - list[i - 1]
        expect(gap).toBeGreaterThan(0)
        expect(gap).toBeLessThanOrEqual(512)
      }
    }
    expect(uncovered(tiles, 8192, 5460, 61)).toBe(0)
  })

  it('порядок — по строкам сверху вниз, в строке слева направо', () => {
    const tiles = planTiles(2000, 1400)
    for (let i = 1; i < tiles.length; i++) {
      const a = tiles[i - 1]
      const b = tiles[i]
      expect(b.y > a.y || (b.y === a.y && b.x > a.x)).toBe(true)
    }
  })

  it('кадр не больше 1280 по большей стороне — один проход целиком', () => {
    expect(planTiles(1280, 960)).toEqual([{ x: 0, y: 0, w: 1280, h: 960 }])
    expect(planTiles(640, 640)).toEqual([{ x: 0, y: 0, w: 640, h: 640 }])
    expect(planTiles(960, 1280)).toEqual([{ x: 0, y: 0, w: 960, h: 1280 }])
    expect(planTiles(300, 200)).toEqual([{ x: 0, y: 0, w: 300, h: 200 }])
  })

  it('чуть больше порога — уже сетка', () => {
    const tiles = planTiles(1281, 960)
    expect(starts(tiles, 'x')).toEqual([0, 512, 641])
    expect(starts(tiles, 'y')).toEqual([0, 320])
    expect(uncovered(tiles, 1281, 960, 7)).toBe(0)
  })

  it('узкая полоса: сторона меньше фрагмента не растягивается, фрагменты по ней во всю высоту', () => {
    const tiles = planTiles(3000, 500)
    expect(tiles.every((t) => t.y === 0 && t.h === 500 && t.w === 640)).toBe(true)
    expect(starts(tiles, 'x').at(-1)).toBe(3000 - 640)
    expect(uncovered(tiles, 3000, 500, 13)).toBe(0)
  })

  it('без дыр на неудобных размерах и других параметрах', () => {
    for (const [w, h] of [
      [4000, 3000],
      [5184, 3888],
      [6000, 4000],
      [1300, 1301],
      [7999, 641],
    ]) {
      const tiles = planTiles(w, h)
      expect(uncovered(tiles, w, h, 29)).toBe(0)
    }
    const custom = planTiles(2000, 2000, { tile: 500, overlap: 0.5, singlePassMaxSide: 0 })
    expect(starts(custom, 'x')).toEqual([0, 250, 500, 750, 1000, 1250, 1500])
  })

  it('некорректные размеры и перекрытие — ошибка', () => {
    expect(() => planTiles(0, 100)).toThrow(RangeError)
    expect(() => planTiles(100, Number.NaN)).toThrow(RangeError)
    expect(() => planTiles(2000, 2000, { overlap: 1 })).toThrow(RangeError)
    expect(() => planTiles(2000, 2000, { overlap: -0.1 })).toThrow(RangeError)
  })
})
