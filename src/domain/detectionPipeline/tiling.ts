// Фрагмент в пикселях оригинала
export interface TileRect {
  x: number
  y: number
  w: number
  h: number
}

export interface TilingOptions {
  // Модель обучена на кусках 640x640 без масштабирования
  tile: number
  // Перекрытие соседей, [0, 1)
  overlap: number
  // Кадр с большей стороной до этой гоняем целиком за один проход
  singlePassMaxSide: number
}

export const DEFAULT_TILING: TilingOptions = { tile: 640, overlap: 0.2, singlePassMaxSide: 1280 }

function assertSide(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} должен быть положительным: ${value}`)
}

// Старты по оси с шагом step, последний прижат к краю (без дыр и выхода за кадр)
function axisStarts(length: number, tile: number, step: number): number[] {
  if (length <= tile) return [0]
  const count = Math.ceil((length - tile) / step) + 1
  return Array.from({ length: count }, (_, i) => Math.min(i * step, length - tile))
}

// Порядок: строки сверху вниз, в строке слева направо
export function planTiles(width: number, height: number, options: Partial<TilingOptions> = {}): TileRect[] {
  const { tile, overlap, singlePassMaxSide } = { ...DEFAULT_TILING, ...options }
  assertSide(width, 'width')
  assertSide(height, 'height')
  assertSide(tile, 'tile')
  if (!(overlap >= 0 && overlap < 1)) throw new RangeError(`overlap должен быть в [0, 1): ${overlap}`)

  if (Math.max(width, height) <= singlePassMaxSide) return [{ x: 0, y: 0, w: width, h: height }]

  const step = Math.max(1, Math.round(tile * (1 - overlap)))
  const xs = axisStarts(width, tile, step)
  const ys = axisStarts(height, tile, step)
  const w = Math.min(tile, width)
  const h = Math.min(tile, height)
  const tiles: TileRect[] = []
  for (const y of ys) {
    for (const x of xs) tiles.push({ x, y, w, h })
  }
  return tiles
}
