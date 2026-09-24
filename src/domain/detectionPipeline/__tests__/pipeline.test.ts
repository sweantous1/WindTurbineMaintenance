import { describe, expect, it } from 'vitest'
import manifestText from '../../../../public/models/defects/manifest.json?raw'
import {
  CUT_BOTTOM,
  CUT_LEFT,
  CUT_RIGHT,
  CUT_TOP,
  letterbox,
  mergeTileDetections,
  nmsPerClass,
  parseManifest,
  planTiles,
  processTileOutput,
  tilingForModel,
  type Box,
  type FrameCandidate,
  type FrameSize,
  type RawDetection,
  type TileRect,
} from '../index'

// Выход модели с заданными рамками во входных пикселях: { class, score, x1..y2 }
function outputWith(boxes: (Box & { classIndex: number; score: number })[], nc = 3, anchors = 16): { data: Float32Array; dims: number[] } {
  const data = new Float32Array((4 + nc) * anchors)
  boxes.forEach((b, i) => {
    data[i] = (b.x1 + b.x2) / 2
    data[anchors + i] = (b.y1 + b.y2) / 2
    data[2 * anchors + i] = b.x2 - b.x1
    data[3 * anchors + i] = b.y2 - b.y1
    data[(4 + b.classIndex) * anchors + i] = b.score
  })
  return { data, dims: [1, 4 + nc, anchors] }
}

const opts = (frame: FrameSize) => ({ confidence: 0.25, iou: 0.7, numClasses: 3, frame })
const WHOLE = { width: 640, height: 640 }

type TileBox = Box & { classIndex: number; score: number }

// Прогон «модели» по фрагментам кадра: рамки задаются во входных пикселях каждого фрагмента
function runTiles(frame: FrameSize, perTile: Map<string, TileBox[]>): { tiles: TileRect[]; found: FrameCandidate[] } {
  const tiles = planTiles(frame.width, frame.height, tilingForModel(640))
  const found = tiles.flatMap((tile) => {
    const boxes = perTile.get(`${tile.x},${tile.y}`) ?? []
    const { data, dims } = outputWith(boxes)
    return processTileOutput(data, dims, tile, letterbox(tile.w, tile.h), opts(frame))
  })
  return { tiles, found }
}

const inFrame = (d: RawDetection, frame: FrameSize) => [d.x * frame.width, d.y * frame.height, (d.x + d.w) * frame.width, (d.y + d.h) * frame.height]

describe('перенос рамок фрагмента в кадр', () => {
  it('фрагмент 640 в исходном масштабе: сдвиг на положение фрагмента и обрезка по его краю', () => {
    const tile = { x: 512, y: 0, w: 640, h: 640 }
    const { data, dims } = outputWith([
      { classIndex: 1, score: 0.9, x1: 80, y1: 190, x2: 120, y2: 210 },
      { classIndex: 0, score: 0.8, x1: 610, y1: 10, x2: 650, y2: 30 },
    ])
    const got = processTileOutput(data, dims, tile, letterbox(640, 640), opts({ width: 1664, height: 640 }))
    expect(got).toHaveLength(2)
    expect(got[0]).toMatchObject({ classIndex: 1, x1: 592, y1: 190, x2: 632, y2: 210, cut: 0 })
    // Упёрлась в правый край фрагмента, а за ним кадр продолжается — сторона отмечена как срезанная
    expect(got[1]).toMatchObject({ classIndex: 0, x1: 1122, x2: 1152, cut: CUT_RIGHT })
  })

  it('кадр целиком (1280×960): снимается letterbox — масштаб 0.5 и поле 80 сверху', () => {
    const frame = { width: 1280, height: 960 }
    const [tile] = planTiles(frame.width, frame.height)
    const lb = letterbox(tile.w, tile.h)
    const { data, dims } = outputWith([{ classIndex: 2, score: 0.5, x1: 270, y1: 295, x2: 370, y2: 345 }])
    const [b] = processTileOutput(data, dims, tile, lb, opts(frame))
    expect([b.x1, b.y1, b.x2, b.y2]).toEqual([540, 430, 740, 530])
    // Рамка, целиком лежащая в сером поле, пропадает при обрезке
    const inPad = outputWith([{ classIndex: 0, score: 0.9, x1: 10, y1: 5, x2: 50, y2: 60 }])
    expect(processTileOutput(inPad.data, inPad.dims, tile, lb, opts(frame))).toEqual([])
    // Рамка у самого края кадра: краёв-стыков у одного прохода нет
    const edge = outputWith([{ classIndex: 0, score: 0.9, x1: 0, y1: 80, x2: 640, y2: 560 }])
    const [whole] = processTileOutput(edge.data, edge.dims, tile, lb, opts(frame))
    expect(whole).toMatchObject({ x1: 0, y1: 0, x2: 1280, y2: 960, cut: 0 })
  })

  it('последний фрагмент кадра 8192×5460 прижат к углу: рамка у края кадра доходит ровно до 1', () => {
    const frame = { width: 8192, height: 5460 }
    const tiles = planTiles(frame.width, frame.height, tilingForModel(640))
    const last = tiles.at(-1) as TileRect
    expect(last).toEqual({ x: 7552, y: 4820, w: 640, h: 640 })
    const { data, dims } = outputWith([{ classIndex: 1, score: 0.9, x1: 0, y1: 600, x2: 660, y2: 650 }])
    const got = processTileOutput(data, dims, last, letterbox(640, 640), opts(frame))
    expect(got[0]).toMatchObject({ x1: 7552, y1: 5420, x2: 8192, y2: 5460, cut: CUT_LEFT })
    const [d] = mergeTileDetections(got, frame, ['a', 'b', 'c'], 0.7)
    expect(d.x + d.w).toBe(1)
    expect(d.y + d.h).toBe(1)
    expect(d.x).toBeCloseTo(7552 / 8192, 12)
  })

  it('узкий кадр 3000×500: фрагмент 640×500 без масштаба, поле 70 сверху снимается', () => {
    const frame = { width: 3000, height: 500 }
    const tiles = planTiles(frame.width, frame.height, tilingForModel(640))
    const last = tiles.at(-1) as TileRect
    expect(last).toEqual({ x: 2360, y: 0, w: 640, h: 500 })
    const lb = letterbox(last.w, last.h)
    expect([lb.scale, lb.newW, lb.newH, lb.padX, lb.padY]).toEqual([1, 640, 500, 0, 70])
    const { data, dims } = outputWith([{ classIndex: 0, score: 0.9, x1: 100, y1: 60, x2: 200, y2: 575 }])
    const [b] = processTileOutput(data, dims, last, lb, opts(frame))
    // Сверху и снизу — край кадра, слева — стык с соседним фрагментом, но рамка до него не доходит
    expect(b).toMatchObject({ x1: 2460, y1: 0, x2: 2560, y2: 500, cut: 0 })
  })

  it('NMS внутри фрагмента делается до переноса, как в ultralytics', () => {
    const { data, dims } = outputWith([
      { classIndex: 0, score: 0.9, x1: 100, y1: 100, x2: 200, y2: 200 },
      { classIndex: 0, score: 0.6, x1: 101, y1: 101, x2: 201, y2: 201 },
    ])
    expect(processTileOutput(data, dims, { x: 0, y: 0, w: 640, h: 640 }, letterbox(640, 640), opts(WHOLE))).toHaveLength(1)
  })
})

describe('сборка фрагментов', () => {
  it('общий NMS убирает дубль на стыке, но не трогает другой класс; итог в долях кадра', () => {
    const frame = { width: 1664, height: 640 }
    const tiles = planTiles(frame.width, frame.height, tilingForModel(640))
    expect(tiles.map((t) => t.x)).toEqual([0, 512, 1024])
    // Дефект в полосе перекрытия [512, 640): виден в фрагментах 0 и 1 с немного разными рамками
    const perTile = [
      [{ classIndex: 0, score: 0.8, x1: 560, y1: 100, x2: 620, y2: 160 }],
      [
        { classIndex: 0, score: 0.7, x1: 49, y1: 101, x2: 109, y2: 161 },
        { classIndex: 1, score: 0.6, x1: 48, y1: 100, x2: 108, y2: 160 },
      ],
      [{ classIndex: 2, score: 0.4, x1: 300, y1: 300, x2: 340, y2: 380 }],
    ]
    const found = tiles.flatMap((tile, i) => {
      const { data, dims } = outputWith(perTile[i])
      return processTileOutput(data, dims, tile, letterbox(tile.w, tile.h), opts(frame))
    })
    expect(found).toHaveLength(4)
    const merged = mergeTileDetections(found, frame, ['a', 'b', 'c'], 0.7)
    expect(merged.map((d) => [d.modelClass, d.confidence])).toEqual([
      ['a', Math.fround(0.8)],
      ['b', Math.fround(0.6)],
      ['c', Math.fround(0.4)],
    ])
    const [a, , c] = merged
    expect(a.x).toBeCloseTo(560 / 1664, 12)
    expect(a.y).toBeCloseTo(100 / 640, 12)
    expect(a.w).toBeCloseTo(60 / 1664, 12)
    expect(a.h).toBeCloseTo(60 / 640, 12)
    expect(c.x).toBeCloseTo((1024 + 300) / 1664, 12)
    expect(c.classIndex).toBe(2)
  })

  it('рамки обрезаются по кадру, вырожденные отбрасываются', () => {
    const merged = mergeTileDetections(
      [
        { classIndex: 0, score: 0.9, x1: -10, y1: -5, x2: 50, y2: 40 },
        { classIndex: 1, score: 0.8, x1: 90, y1: 10, x2: 130, y2: 20 },
        { classIndex: 2, score: 0.7, x1: 100, y1: 10, x2: 120, y2: 20 },
      ],
      { width: 100, height: 50 },
      ['a', 'b', 'c'],
      0.7,
    )
    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual({ modelClass: 'a', classIndex: 0, confidence: 0.9, x: 0, y: 0, w: 0.5, h: 0.8 })
    expect(merged[1].x + merged[1].w).toBe(1)
  })
})

describe('сборка фрагментов: крупный дефект на стыке', () => {
  // Рамки — из настоящего прогона model.onnx по мозаике 1920×1280 из эталонных фото: дефект surface_eye
  // [1501, 642, 1768, 1280] попал на стык четырёх фрагментов. Эталон ultralytics по его фото — одна рамка
  const frame = { width: 1920, height: 1280 }
  const seam = new Map<string, TileBox[]>([
    ['1280,512', [{ classIndex: 1, score: 0.795, x1: 224, y1: 124, x2: 479, y2: 640 }]],
    ['1024,512', [{ classIndex: 1, score: 0.775, x1: 467, y1: 127, x2: 640, y2: 639 }]],
    ['1280,640', [{ classIndex: 1, score: 0.714, x1: 221, y1: 2, x2: 488, y2: 640 }]],
    ['1024,640', [{ classIndex: 1, score: 0.706, x1: 456, y1: 55, x2: 640, y2: 638 }]],
  ])

  it('стороны, срезанные внутренними краями фрагментов, отмечены; края кадра — нет', () => {
    const { found } = runTiles(frame, seam)
    expect(found.map((b) => b.cut)).toEqual([CUT_RIGHT | CUT_BOTTOM, CUT_BOTTOM, CUT_RIGHT, CUT_TOP])
  })

  it('один дефект — одна рамка; срезанная стыком сторона достраивается по соседнему фрагменту', () => {
    const { found } = runTiles(frame, seam)
    // Обычный NMS оставил бы три урезанные рамки, а целую (0.714) подавил бы частичной (0.795)
    expect(nmsPerClass(found, 0.7).map((b) => b.score)).toEqual([0.795, 0.775, 0.706].map(Math.fround))
    const merged = mergeTileDetections(found, frame, ['a', 'b', 'c'], 0.7)
    expect(merged).toHaveLength(1)
    expect(merged[0].confidence).toBeCloseTo(0.795, 6)
    const [x1, y1, x2, y2] = inFrame(merged[0], frame)
    expect(x1).toBeCloseTo(1504, 9)
    expect(y1).toBeCloseTo(636, 9)
    expect(x2).toBeCloseTo(1759, 9)
    expect(y2).toBeCloseTo(1280, 9)
  })

  it('дефект шире перекрытия: две половинки с соседних фрагментов сливаются в одну рамку', () => {
    const wide = { width: 1664, height: 640 }
    // Объект [900..1400]: фрагмент 512 видит его до своего правого края 1152, фрагмент 1024 — от левого края
    const { found } = runTiles(
      wide,
      new Map([
        ['512,0', [{ classIndex: 0, score: 0.6, x1: 388, y1: 100, x2: 640, y2: 300 }]],
        ['1024,0', [{ classIndex: 0, score: 0.5, x1: 0, y1: 102, x2: 376, y2: 298 }]],
      ]),
    )
    expect(found.map((b) => b.cut)).toEqual([CUT_RIGHT, CUT_LEFT])
    const merged = mergeTileDetections(found, wide, ['a', 'b', 'c'], 0.7)
    expect(merged).toHaveLength(1)
    expect(inFrame(merged[0], wide).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([900, 100, 1400, 300])
    expect(merged[0].confidence).toBeCloseTo(0.6, 6)
  })

  it('разные объекты у стыка не сливаются: другое место в общей полосе, вне её или другой класс', () => {
    const wide = { width: 1664, height: 640 }
    const { found } = runTiles(
      wide,
      new Map([
        [
          '512,0',
          [
            { classIndex: 0, score: 0.9, x1: 520, y1: 50, x2: 620, y2: 150 },
            { classIndex: 0, score: 0.8, x1: 100, y1: 100, x2: 200, y2: 200 },
            { classIndex: 2, score: 0.7, x1: 540, y1: 300, x2: 640, y2: 400 },
          ],
        ],
        [
          '1024,0',
          [
            { classIndex: 0, score: 0.6, x1: 8, y1: 400, x2: 108, y2: 500 },
            { classIndex: 0, score: 0.5, x1: 0, y1: 100, x2: 60, y2: 200 },
            { classIndex: 1, score: 0.4, x1: 0, y1: 300, x2: 150, y2: 400 },
          ],
        ],
      ]),
    )
    const merged = mergeTileDetections(found, wide, ['a', 'b', 'c'], 0.7)
    expect(merged.map((d) => [d.modelClass, Math.round(d.confidence * 10) / 10])).toEqual([
      ['a', 0.9],
      ['a', 0.8],
      ['c', 0.7],
      ['a', 0.6],
      ['a', 0.5],
      ['b', 0.4],
    ])
  })

  it('внутри одного фрагмента — ровно NMS ultralytics, без сравнения по общей области', () => {
    const { found } = runTiles(
      WHOLE,
      new Map([
        [
          '0,0',
          [
            { classIndex: 0, score: 0.9, x1: 0, y1: 0, x2: 100, y2: 100 },
            { classIndex: 0, score: 0.8, x1: 0, y1: 0, x2: 100, y2: 60 },
          ],
        ],
      ]),
    )
    expect(found.every((b) => b.cut === 0)).toBe(true)
    expect(mergeTileDetections(found, WHOLE, ['a', 'b', 'c'], 0.7)).toHaveLength(2)
  })
})

describe('manifest.json', () => {
  it('настоящий манифест модели проходит проверку', () => {
    const m = parseManifest(JSON.parse(manifestText))
    expect(m.format).toBe('yolo-raw')
    expect(m.imgsz).toBe(640)
    expect(m.input).toBe('images')
    expect(m.output).toBe('output0')
    expect(m.classes).toHaveLength(7)
    expect(m.defaults).toEqual({ confidence: 0.25, iou: 0.7 })
    expect(m.classMap.craze).toBe('crack')
  })

  it('битый манифест — понятная ошибка', () => {
    const good = JSON.parse(manifestText)
    expect(() => parseManifest(null)).toThrow(/manifest/)
    expect(() => parseManifest({ ...good, format: 'yolo-nms' })).toThrow(/формат/)
    expect(() => parseManifest({ ...good, classes: [] })).toThrow(/classes/)
    expect(() => parseManifest({ ...good, classMap: { craze: 'scratch' } })).toThrow(/scratch/)
    expect(() => parseManifest({ ...good, defaults: { confidence: 0, iou: 0.7 } })).toThrow(/defaults/)
    expect(() => parseManifest({ ...good, imgsz: 640.5 })).toThrow(/imgsz/)
  })
})
