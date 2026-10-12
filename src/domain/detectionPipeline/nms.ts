import type { Candidate } from './decode'
import type { Box } from './letterbox'

export function boxArea(b: Box): number {
  return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
}

export function boxIou(a: Box, b: Box): number {
  const iw = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
  const ih = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
  if (iw <= 0 || ih <= 0) return 0
  const inter = iw * ih
  const union = boxArea(a) + boxArea(b) - inter
  return union > 0 ? inter / union : 0
}

// Жадный NMS по классам как batched NMS в ultralytics (отбрасываем при IoU строго больше порога).
// Результат по убыванию score, не больше maxDet
export function nmsPerClass<T extends Candidate>(boxes: readonly T[], iou: number, maxDet = Infinity): T[] {
  const order = [...boxes].sort((a, b) => b.score - a.score)
  const keptByClass = new Map<number, T[]>()
  const kept: T[] = []
  for (const box of order) {
    if (kept.length >= maxDet) break
    const sameClass = keptByClass.get(box.classIndex)
    if (sameClass?.some((k) => boxIou(k, box) > iou)) continue
    if (sameClass) sameClass.push(box)
    else keptByClass.set(box.classIndex, [box])
    kept.push(box)
  }
  return kept
}
