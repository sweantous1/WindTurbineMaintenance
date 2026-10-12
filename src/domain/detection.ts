import type { GeoPoint } from './types'

// Классы дефектов приложения; имена из модели сопоставляются через manifest.classMap
export const APP_DEFECT_CLASSES = ['crack', 'corrosion', 'erosion', 'lightning', 'contamination', 'delamination', 'other'] as const
export type AppDefectClass = (typeof APP_DEFECT_CLASSES)[number]

export type Severity = 1 | 2 | 3 | 4 | 5

// Описание модели рядом с model.onnx (public/models/defects/manifest.json)
export interface ModelManifest {
  name: string
  version: string
  // Сырой выход YOLO: [1, 4 + число классов, число якорей], без NMS
  format: 'yolo-raw'
  imgsz: number
  input: string
  output: string
  classes: string[]
  classMap: Record<string, AppDefectClass>
  defaults: { confidence: number; iou: number }
  license: string
  metrics?: Record<string, unknown>
}

// Анализ фото: что и чем искали
export interface PhotoAnalysis {
  status: 'done' | 'failed'
  modelName: string
  modelVersion: string
  backend?: 'webgpu' | 'wasm'
  analyzedAt: string
  // Порог при сохранении; ползунок в UI фильтрует выше него без повторного прогона
  minConfidence: number
  iou: number
  tiles: number
  durationMs: number
  error?: string
}

export interface PhotoRecord {
  id: string
  missionId: string
  turbineId?: string
  fileName: string
  mimeType: string
  sizeBytes: number
  width: number
  height: number
  // Из EXIF, если есть
  takenAt?: string
  gps?: GeoPoint
  addedAt: string
  analysis?: PhotoAnalysis
}

// Картинка и миниатюра отдельно от записи, чтобы списки не тянули мегабайты
export interface PhotoBlobRecord {
  id: string
  blob: Blob
  thumb: Blob
}

export interface Detection {
  id: string
  photoId: string
  missionId: string
  // Класс, как его назвала модель, и класс приложения
  modelClass: string
  defectClass: AppDefectClass
  confidence: number
  // Рамка в долях ширины и высоты оригинала: 0..1
  x: number
  y: number
  w: number
  h: number
  severity: Severity
  reviewed: boolean
  note?: string
}

export type DetectionPatch = Partial<Pick<Detection, 'severity' | 'reviewed' | 'note' | 'defectClass'>>

// Опасность по умолчанию зависит от класса, а не от уверенности модели; оператор потом правит
const DEFAULT_SEVERITY: Record<AppDefectClass, Severity> = {
  lightning: 4,
  crack: 3,
  delamination: 3,
  corrosion: 3,
  erosion: 2,
  contamination: 1,
  other: 2,
}

export function defaultSeverity(cls: AppDefectClass): Severity {
  return DEFAULT_SEVERITY[cls]
}

export function toAppClass(manifest: Pick<ModelManifest, 'classMap'>, modelClass: string): AppDefectClass {
  return manifest.classMap[modelClass] ?? 'other'
}

// Цвета рамок по классам: различимы между собой и на фото лопастей (белые/серые)
export const DEFECT_COLORS: Record<AppDefectClass, string> = {
  crack: '#dc2626',
  corrosion: '#ea580c',
  erosion: '#ca8a04',
  lightning: '#7c3aed',
  contamination: '#0891b2',
  delamination: '#db2777',
  other: '#4b5563',
}
