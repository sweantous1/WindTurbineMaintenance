import { APP_DEFECT_CLASSES, type AppDefectClass, type ModelManifest } from '../detection'
import { decodeYolo, type Candidate } from './decode'
import { fromLetterbox, type Box, type Letterbox } from './letterbox'
import { boxIou, nmsPerClass } from './nms'
import { DEFAULT_TILING, type TileRect, type TilingOptions } from './tiling'

export { planTiles, DEFAULT_TILING } from './tiling'
export type { TileRect, TilingOptions } from './tiling'
export { letterbox, toLetterbox, fromLetterbox, rgbaToChw, LETTERBOX_FILL, LETTERBOX_FILL_BYTE } from './letterbox'
export type { Box, Letterbox } from './letterbox'
export { decodeYolo } from './decode'
export type { Candidate, DecodeOptions } from './decode'
export { nmsPerClass, boxIou, boxArea } from './nms'

// Рамка в долях кадра 0..1, обрезана по краям
export interface RawDetection {
  modelClass: string
  classIndex: number
  confidence: number
  x: number
  y: number
  w: number
  h: number
}

// Как max_det в ultralytics
export const MAX_DET_PER_TILE = 300

// Фрагмент = вход модели, целиком гоняем кадры до двух фрагментов по стороне
export function tilingForModel(imgsz: number): TilingOptions {
  return { ...DEFAULT_TILING, tile: imgsz, singlePassMaxSide: imgsz * 2 }
}

export interface FrameSize {
  width: number
  height: number
}

export interface TileOutputOptions {
  confidence: number
  iou: number
  // Нужен, чтобы понять, какие края фрагмента внутренние
  frame: FrameSize
  numClasses?: number
  maxDet?: number
}

// Стороны рамки, упёртые во внутренний край фрагмента (объект, скорее всего, продолжается дальше)
export const CUT_LEFT = 1
export const CUT_TOP = 2
export const CUT_RIGHT = 4
export const CUT_BOTTOM = 8

// Кандидат в пикселях кадра + фрагмент, где его нашли
export interface FrameCandidate extends Candidate {
  tile?: TileRect
  // Биты CUT_*, нет поля - рамка видна целиком
  cut?: number
}

// Допуск до края фрагмента (доля стороны): модель тянет обрезанную рамку к краю, но не всегда до последнего пикселя
const CUT_TOLERANCE = 0.01

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Входные пиксели -> пиксели оригинала: снять letterbox, обрезать по фрагменту (clip_boxes в ultralytics),
// сдвинуть в кадр и пометить стороны, срезанные внутренним краем
export function tileCandidatesToFrame(candidates: readonly Candidate[], tile: TileRect, lb: Letterbox, frame: FrameSize): FrameCandidate[] {
  // У края кадра объект и правда кончается, поэтому смотрим только внутренние края
  const inner =
    (tile.x > 0 ? CUT_LEFT : 0) |
    (tile.y > 0 ? CUT_TOP : 0) |
    (tile.x + tile.w < frame.width ? CUT_RIGHT : 0) |
    (tile.y + tile.h < frame.height ? CUT_BOTTOM : 0)
  const tolX = Math.max(1, tile.w * CUT_TOLERANCE)
  const tolY = Math.max(1, tile.h * CUT_TOLERANCE)
  const result: FrameCandidate[] = []
  for (const c of candidates) {
    const b = fromLetterbox(lb, c)
    const x1 = clamp(b.x1, 0, tile.w)
    const y1 = clamp(b.y1, 0, tile.h)
    const x2 = clamp(b.x2, 0, tile.w)
    const y2 = clamp(b.y2, 0, tile.h)
    if (x2 <= x1 || y2 <= y1) continue
    const touches =
      (x1 <= tolX ? CUT_LEFT : 0) | (y1 <= tolY ? CUT_TOP : 0) | (x2 >= tile.w - tolX ? CUT_RIGHT : 0) | (y2 >= tile.h - tolY ? CUT_BOTTOM : 0)
    result.push({
      classIndex: c.classIndex,
      score: c.score,
      x1: x1 + tile.x,
      y1: y1 + tile.y,
      x2: x2 + tile.x,
      y2: y2 + tile.y,
      tile,
      cut: touches & inner,
    })
  }
  return result
}

// decode + NMS внутри фрагмента + перенос в кадр
export function processTileOutput(
  output: ArrayLike<number>,
  dims: readonly number[],
  tile: TileRect,
  lb: Letterbox,
  options: TileOutputOptions,
): FrameCandidate[] {
  const candidates = decodeYolo(output, dims, { confidence: options.confidence, numClasses: options.numClasses })
  const kept = nmsPerClass(candidates, options.iou, options.maxDet ?? MAX_DET_PER_TILE)
  return tileCandidatesToFrame(kept, tile, lb, options.frame)
}

// Общая область двух фрагментов
function sharedArea(a: TileRect, b: TileRect): Box | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null
}

const clipTo = (b: Box, area: Box): Box => ({
  x1: clamp(b.x1, area.x1, area.x2),
  y1: clamp(b.y1, area.y1, area.y2),
  x2: clamp(b.x2, area.x1, area.x2),
  y2: clamp(b.y2, area.y1, area.y2),
})

// Рамки с разных фрагментов сравниваем ещё и в их общей области: там один объект даёт почти одинаковые рамки,
// а IoU целых рамок для половинки против целого обычно < 0.7
function sameObject(kept: FrameCandidate, box: FrameCandidate, iou: number): boolean {
  const overlap = boxIou(kept, box)
  if (overlap > iou) return true
  // Не пересекаются - в общей области тоже не пересекутся
  if (overlap === 0) return false
  const a = kept.tile
  const b = box.tile
  if (!a || !b || (a.x === b.x && a.y === b.y)) return false
  const area = sharedArea(a, b)
  return area !== null && boxIou(clipTo(kept, area), clipTo(box, area)) > iou
}

// Срезанную сторону тянем по подавленной рамке того же объекта, если та уходит дальше.
// Иначе крупный дефект на стыке остаётся урезанным: у частичной рамки score бывает выше, чем у целой
function extendCutSides(kept: FrameCandidate, box: FrameCandidate): void {
  const cut = kept.cut ?? 0
  if (!cut) return
  const boxCut = box.cut ?? 0
  let next = cut
  const take = (side: number) => {
    next = (next & ~side) | (boxCut & side)
  }
  if ((cut & CUT_LEFT) !== 0 && box.x1 < kept.x1) {
    kept.x1 = box.x1
    take(CUT_LEFT)
  }
  if ((cut & CUT_TOP) !== 0 && box.y1 < kept.y1) {
    kept.y1 = box.y1
    take(CUT_TOP)
  }
  if ((cut & CUT_RIGHT) !== 0 && box.x2 > kept.x2) {
    kept.x2 = box.x2
    take(CUT_RIGHT)
  }
  if ((cut & CUT_BOTTOM) !== 0 && box.y2 > kept.y2) {
    kept.y2 = box.y2
    take(CUT_BOTTOM)
  }
  kept.cut = next
}

// Общий жадный NMS по классам в координатах кадра, убирает дубли из зон перекрытия.
// Для кадра в один проход совпадает с NMS ultralytics
export function mergeTileDetections(
  boxes: readonly FrameCandidate[],
  frame: FrameSize,
  classes: readonly string[],
  iou: number,
): RawDetection[] {
  const order = [...boxes].sort((a, b) => b.score - a.score)
  const keptByClass = new Map<number, FrameCandidate[]>()
  const kept: FrameCandidate[] = []
  for (const box of order) {
    const sameClass = keptByClass.get(box.classIndex)
    const owner = sameClass?.find((k) => sameObject(k, box, iou))
    if (owner) {
      extendCutSides(owner, box)
      continue
    }
    // Копия, extendCutSides её меняет
    const copy = { ...box }
    if (sameClass) sameClass.push(copy)
    else keptByClass.set(box.classIndex, [copy])
    kept.push(copy)
  }

  const { width, height } = frame
  const result: RawDetection[] = []
  for (const b of kept) {
    const x1 = clamp(b.x1 / width, 0, 1)
    const y1 = clamp(b.y1 / height, 0, 1)
    const x2 = clamp(b.x2 / width, 0, 1)
    const y2 = clamp(b.y2 / height, 0, 1)
    if (x2 <= x1 || y2 <= y1) continue
    result.push({
      modelClass: classes[b.classIndex] ?? `class_${b.classIndex}`,
      classIndex: b.classIndex,
      confidence: b.score,
      x: x1,
      y: y1,
      w: x2 - x1,
      h: y2 - y1,
    })
  }
  return result
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isShare = (v: unknown): v is number => typeof v === 'number' && v > 0 && v <= 1
const APP_CLASSES: readonly string[] = APP_DEFECT_CLASSES

// Битый manifest.json должен падать с понятной ошибкой, а не давать странные рамки
export function parseManifest(raw: unknown): ModelManifest {
  const fail = (what: string): never => {
    throw new Error(`manifest.json: ${what}`)
  }
  if (!isRecord(raw)) return fail('ожидался объект')
  if (raw.format !== 'yolo-raw') fail(`неизвестный формат ${String(raw.format)}`)
  if (!isText(raw.name) || !isText(raw.version)) fail('нет name или version')
  if (!isText(raw.input) || !isText(raw.output)) fail('нет имён входа и выхода')
  const imgsz = raw.imgsz
  if (typeof imgsz !== 'number' || !Number.isInteger(imgsz) || imgsz < 32) fail('imgsz должен быть целым ≥ 32')
  const classes = raw.classes
  if (!Array.isArray(classes) || classes.length === 0 || !classes.every(isText)) fail('classes — непустой список строк')
  const classMap = raw.classMap
  if (!isRecord(classMap)) return fail('нет classMap')
  const map: Record<string, AppDefectClass> = {}
  for (const [modelClass, appClass] of Object.entries(classMap)) {
    if (typeof appClass !== 'string' || !APP_CLASSES.includes(appClass)) fail(`classMap.${modelClass}: неизвестный класс ${String(appClass)}`)
    map[modelClass] = appClass as AppDefectClass
  }
  const defaults = raw.defaults
  if (!isRecord(defaults) || !isShare(defaults.confidence) || !isShare(defaults.iou)) fail('defaults.confidence и defaults.iou — числа в (0, 1]')
  const d = defaults as { confidence: number; iou: number }
  return {
    name: raw.name as string,
    version: raw.version as string,
    format: 'yolo-raw',
    imgsz: imgsz as number,
    input: raw.input as string,
    output: raw.output as string,
    classes: [...(classes as string[])],
    classMap: map,
    defaults: { confidence: d.confidence, iou: d.iou },
    license: typeof raw.license === 'string' ? raw.license : '',
    ...(isRecord(raw.metrics) ? { metrics: raw.metrics } : {}),
  }
}
