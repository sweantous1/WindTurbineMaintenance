import type { Box } from './letterbox'

// Кандидат до NMS, рамка во входных пикселях модели (после переноса - в пикселях оригинала)
export interface Candidate extends Box {
  classIndex: number
  score: number
}

export interface DecodeOptions {
  confidence: number
  // Если задано, сверяем с манифестом
  numClasses?: number
}

// Выход YOLO [1, 4 + nc, anchors]: строки 0..3 - cx, cy, w, h, дальше вероятности классов (сигмоида уже в графе).
// Класс = argmax, порог строго больше, как в ultralytics
export function decodeYolo(output: ArrayLike<number>, dims: readonly number[], options: DecodeOptions): Candidate[] {
  if (dims.length !== 3 || dims[0] !== 1 || dims[1] < 5 || dims[2] < 1) {
    throw new Error(`Неожиданная форма выхода модели: [${dims.join(', ')}]`)
  }
  const channels = dims[1]
  const anchors = dims[2]
  const nc = channels - 4
  if (options.numClasses !== undefined && options.numClasses !== nc) {
    throw new Error(`Модель выдаёт ${nc} классов, а в манифесте ${options.numClasses}`)
  }
  if (output.length < channels * anchors) {
    throw new Error(`Выход модели короче ожидаемого: ${output.length} < ${channels * anchors}`)
  }

  const result: Candidate[] = []
  for (let a = 0; a < anchors; a++) {
    let best = -Infinity
    let classIndex = -1
    for (let c = 0; c < nc; c++) {
      const p = output[(4 + c) * anchors + a]
      if (p > best) {
        best = p
        classIndex = c
      }
    }
    // Так отсекается и NaN
    if (!(best > options.confidence)) continue
    const cx = output[a]
    const cy = output[anchors + a]
    const w = output[2 * anchors + a]
    const h = output[3 * anchors + a]
    if (!Number.isFinite(cx + cy + w + h)) continue
    result.push({ classIndex, score: best, x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 })
  }
  return result
}
