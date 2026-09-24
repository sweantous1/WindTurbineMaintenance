import type { AppDefectClass, Detection, ModelManifest, PhotoAnalysis, PhotoRecord, Severity } from '@/domain/detection'

// Манифест как у настоящей модели (public/models/defects/manifest.json), без лишних полей
export const MANIFEST: ModelManifest = {
  name: 'grant-temp-best-turbine',
  version: '2025-03-11',
  format: 'yolo-raw',
  imgsz: 640,
  input: 'images',
  output: 'output0',
  classes: ['corrosion', 'craze', 'hide_craze', 'surface_eye', 'surface_injure', 'surface_oil', 'thunderstrike'],
  classMap: {
    corrosion: 'corrosion',
    craze: 'crack',
    hide_craze: 'crack',
    surface_eye: 'erosion',
    surface_injure: 'erosion',
    surface_oil: 'contamination',
    thunderstrike: 'lightning',
  },
  defaults: { confidence: 0.25, iou: 0.7 },
  license: 'test',
  metrics: { recall: 0.145, precision: 0.966 },
}

export const DONE: PhotoAnalysis = {
  status: 'done',
  modelName: MANIFEST.name,
  modelVersion: MANIFEST.version,
  backend: 'wasm',
  analyzedAt: '2026-09-24T12:00:00.000Z',
  minConfidence: 0.1,
  iou: 0.7,
  tiles: 176,
  durationMs: 192_000,
}

export const FAILED: PhotoAnalysis = { ...DONE, status: 'failed', backend: undefined, tiles: 0, durationMs: 0, error: 'decodeFailed: битый JPEG' }

export function photo(id: string, over: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    missionId: 'm1',
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 12_345_678,
    width: 8192,
    height: 5460,
    addedAt: '2026-09-24T10:00:00.000Z',
    ...over,
  }
}

let n = 0

export function det(photoId: string, defectClass: AppDefectClass, confidence: number, over: Partial<Detection> = {}): Detection {
  const severities: Record<AppDefectClass, Severity> = { lightning: 4, crack: 3, delamination: 3, corrosion: 3, erosion: 2, contamination: 1, other: 2 }
  return {
    id: `d${++n}`,
    photoId,
    missionId: 'm1',
    modelClass: defectClass,
    defectClass,
    confidence,
    x: 0.1,
    y: 0.2,
    w: 0.05,
    h: 0.04,
    severity: severities[defectClass],
    reviewed: false,
    ...over,
  }
}
