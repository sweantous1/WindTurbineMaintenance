import {
  APP_DEFECT_CLASSES,
  defaultSeverity,
  type AppDefectClass,
  type Detection,
  type ModelManifest,
  type PhotoRecord,
  type Severity,
} from '@/domain/detection'

// Храним находки от этого порога, чтобы ползунок работал без перезапуска модели
export const STORED_MIN_CONFIDENCE = 0.1
export const THRESHOLD_MIN = 0.1
export const THRESHOLD_MAX = 0.9
export const THRESHOLD_STEP = 0.01
// Дефолтный порог ultralytics, пока нет манифеста
export const FALLBACK_CONFIDENCE = 0.25

export const SEVERITIES: readonly Severity[] = [1, 2, 3, 4, 5]
// С этой опасности находку подсвечиваем
export const HIGH_SEVERITY = 4

export const isHighSeverity = (s: Severity) => s >= HIGH_SEVERITY

export interface DetectionFilter {
  minConfidence: number
  hidden: ReadonlySet<AppDefectClass>
}

type Scored = Pick<Detection, 'confidence' | 'defectClass'>

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return FALLBACK_CONFIDENCE
  const clamped = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, value))
  // До сотых, иначе вылезает 0.30000000000000004
  return Math.round(clamped * 100) / 100
}

// Порог включительно
export function isVisible(d: Scored, filter: DetectionFilter): boolean {
  return d.confidence >= filter.minConfidence && !filter.hidden.has(d.defectClass)
}

// Видимые находки, самые уверенные первыми
export function visibleDetections<T extends Scored>(list: readonly T[], filter: DetectionFilter): T[] {
  return list.filter((d) => isVisible(d, filter)).sort((a, b) => b.confidence - a.confidence)
}

export function groupByPhoto<T extends Pick<Detection, 'photoId'>>(list: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const d of list) {
    const bucket = out.get(d.photoId)
    if (bucket) bucket.push(d)
    else out.set(d.photoId, [d])
  }
  return out
}

// Классы для фильтра: что знает модель плюс что уже есть в находках
export function classOptions(
  manifest: Pick<ModelManifest, 'classMap'> | undefined,
  detections: readonly Pick<Detection, 'defectClass'>[],
): AppDefectClass[] {
  const present = new Set<AppDefectClass>(manifest ? Object.values(manifest.classMap) : [])
  for (const d of detections) present.add(d.defectClass)
  return APP_DEFECT_CLASSES.filter((c) => present.has(c))
}

export function countByClass(list: readonly Pick<Detection, 'defectClass'>[]): Record<AppDefectClass, number> {
  const out = Object.fromEntries(APP_DEFECT_CLASSES.map((c) => [c, 0])) as Record<AppDefectClass, number>
  for (const d of list) out[d.defectClass] += 1
  return out
}

export function countBySeverity(list: readonly Pick<Detection, 'severity'>[]): Record<Severity, number> {
  const out: Record<Severity, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const d of list) out[d.severity] += 1
  return out
}

export interface PhotoCounts {
  total: number
  analyzed: number
  failed: number
  pending: number
  withFindings: number
}

export interface DefectSummary {
  total: number
  byClass: Record<AppDefectClass, number>
  bySeverity: Record<Severity, number>
  high: number
  reviewed: number
  photos: PhotoCounts
}

// Считаем по уже отфильтрованным находкам, чтобы цифры совпадали со снимками
export function summarize(
  photos: readonly Pick<PhotoRecord, 'id' | 'analysis'>[],
  visible: readonly Pick<Detection, 'photoId' | 'defectClass' | 'severity' | 'reviewed'>[],
): DefectSummary {
  const ids = new Set(photos.map((p) => p.id))
  const own = visible.filter((d) => ids.has(d.photoId))
  const withFindings = new Set(own.map((d) => d.photoId))
  const bySeverity = countBySeverity(own)
  return {
    total: own.length,
    byClass: countByClass(own),
    bySeverity,
    high: SEVERITIES.filter(isHighSeverity).reduce((sum, s) => sum + bySeverity[s], 0),
    reviewed: own.filter((d) => d.reviewed).length,
    photos: {
      total: photos.length,
      analyzed: photos.filter((p) => p.analysis?.status === 'done').length,
      failed: photos.filter((p) => p.analysis?.status === 'failed').length,
      pending: photos.filter((p) => !p.analysis).length,
      withFindings: photos.filter((p) => withFindings.has(p.id)).length,
    },
  }
}

export type PhotoStatus =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'done'; found: number; high: boolean }

export function photoStatus(photo: Pick<PhotoRecord, 'analysis'>, visibleOfPhoto: readonly Pick<Detection, 'severity'>[]): PhotoStatus {
  if (!photo.analysis) return { kind: 'pending' }
  if (photo.analysis.status === 'failed') return { kind: 'failed' }
  return { kind: 'done', found: visibleOfPhoto.length, high: visibleOfPhoto.some((d) => isHighSeverity(d.severity)) }
}

// По времени добавления, внутри пачки по имени (DJI_0002 раньше DJI_0010)
export function sortPhotos<T extends Pick<PhotoRecord, 'addedAt' | 'fileName'>>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) => a.addedAt.localeCompare(b.addedAt) || a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

// "Анализировать все" берёт только неразобранные, упавшие повторяют по одному
export function pendingPhotoIds(photos: readonly Pick<PhotoRecord, 'id' | 'analysis'>[]): string[] {
  return photos.filter((p) => !p.analysis).map((p) => p.id)
}

// Повторный анализ затирает находки вместе с правками оператора
export function hasOperatorEdits(list: readonly Pick<Detection, 'defectClass' | 'severity' | 'reviewed' | 'note'>[]): boolean {
  return list.some((d) => d.reviewed || !!d.note?.trim() || d.severity !== defaultSeverity(d.defectClass))
}

// После удаления на следующее фото, с последнего на предыдущее
export function neighborAfterRemoval(ids: readonly string[], removedId: string): string | null {
  const i = ids.indexOf(removedId)
  if (i < 0) return ids[0] ?? null
  return ids[i + 1] ?? ids[i - 1] ?? null
}

// Для тоста: первые имена и сколько ещё
export function namesPreview(names: readonly string[], max = 3): { shown: string; more: number } {
  return { shown: names.slice(0, max).join(', '), more: Math.max(0, names.length - max) }
}
