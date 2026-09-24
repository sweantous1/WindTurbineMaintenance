import {
  APP_DEFECT_CLASSES,
  type AppDefectClass,
  type Detection,
  type PhotoAnalysis,
  type PhotoRecord,
  type Severity,
} from '@/domain/detection'
import type { Farm, GeoPoint, Mission } from '@/domain/types'
import { countByClass, countBySeverity, visibleDetections, type DetectionFilter } from './detectionView'

// Выгрузка находок для отчёта или другой программы. Рамки — в долях ширины и высоты
// оригинала (0..1), поэтому не зависят от того, в каком размере снимок откроют

export const DEFECTS_EXPORT_FORMAT = 'wtm-defects'
export const DEFECTS_EXPORT_VERSION = 1

export interface ExportDetection {
  id: string
  defectClass: AppDefectClass
  modelClass: string
  confidence: number
  x: number
  y: number
  w: number
  h: number
  severity: Severity
  reviewed: boolean
  note?: string
}

export interface ExportPhoto {
  id: string
  fileName: string
  width: number
  height: number
  sizeBytes: number
  takenAt?: string
  gps?: GeoPoint
  turbine: { id: string; name?: string } | null
  analysis: PhotoAnalysis | null
  detections: ExportDetection[]
}

export interface DefectsExport {
  format: typeof DEFECTS_EXPORT_FORMAT
  version: typeof DEFECTS_EXPORT_VERSION
  exportedAt: string
  mission: { id: string; name: string; status: Mission['status'] }
  // Находки выгружаются так, как их видно на экране: с этим порогом и этими классами
  filter: { minConfidence: number; classes: AppDefectClass[] }
  summary: {
    photos: number
    analyzed: number
    detections: number
    reviewed: number
    byClass: Record<AppDefectClass, number>
    bySeverity: Record<Severity, number>
  }
  photos: ExportPhoto[]
}

export interface DefectsExportInput {
  mission: Pick<Mission, 'id' | 'name' | 'status'> & { farm?: Pick<Farm, 'turbines'> }
  photos: readonly PhotoRecord[]
  detections: readonly Detection[]
  filter: DetectionFilter
  exportedAt: string
}

function exportDetection(d: Detection): ExportDetection {
  return {
    id: d.id,
    defectClass: d.defectClass,
    modelClass: d.modelClass,
    confidence: d.confidence,
    x: d.x,
    y: d.y,
    w: d.w,
    h: d.h,
    severity: d.severity,
    reviewed: d.reviewed,
    ...(d.note ? { note: d.note } : {}),
  }
}

export function buildDefectsExport({ mission, photos, detections, filter, exportedAt }: DefectsExportInput): DefectsExport {
  const photoIds = new Set(photos.map((p) => p.id))
  const visible = visibleDetections(
    detections.filter((d) => photoIds.has(d.photoId)),
    filter,
  )
  const turbineName = (id: string) => mission.farm?.turbines.find((tb) => tb.id === id)?.name
  return {
    format: DEFECTS_EXPORT_FORMAT,
    version: DEFECTS_EXPORT_VERSION,
    exportedAt,
    mission: { id: mission.id, name: mission.name, status: mission.status },
    filter: { minConfidence: filter.minConfidence, classes: APP_DEFECT_CLASSES.filter((c) => !filter.hidden.has(c)) },
    summary: {
      photos: photos.length,
      analyzed: photos.filter((p) => p.analysis?.status === 'done').length,
      detections: visible.length,
      reviewed: visible.filter((d) => d.reviewed).length,
      byClass: countByClass(visible),
      bySeverity: countBySeverity(visible),
    },
    photos: photos.map((p) => {
      const name = p.turbineId ? turbineName(p.turbineId) : undefined
      return {
        id: p.id,
        fileName: p.fileName,
        width: p.width,
        height: p.height,
        sizeBytes: p.sizeBytes,
        ...(p.takenAt ? { takenAt: p.takenAt } : {}),
        ...(p.gps ? { gps: p.gps } : {}),
        turbine: p.turbineId ? { id: p.turbineId, ...(name ? { name } : {}) } : null,
        analysis: p.analysis ?? null,
        detections: visible.filter((d) => d.photoId === p.id).map(exportDetection),
      }
    }),
  }
}

export function defectsExportJson(input: DefectsExportInput): string {
  return JSON.stringify(buildDefectsExport(input), null, 2)
}

const MAX_BASE_LENGTH = 80
// Символы, запрещённые в именах файлов Windows, и управляющие
const isForbiddenFileChar = (ch: string) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || '<>:"/\\|?*'.includes(ch)
// Зарезервированные имена устройств Windows: такой файл не создать
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i

export function exportFileName(base: string, ext: 'json' | 'png'): string {
  const replaced = Array.from(base.normalize('NFKC'), (ch) => (isForbiddenFileChar(ch) ? ' ' : ch)).join('')
  // Режем по символам, а не по UTF-16: суррогатная пара не разрывается
  const clean = Array.from(replaced.replace(/\s+/g, ' ').trim())
    .slice(0, MAX_BASE_LENGTH)
    .join('')
    .replace(/[. ]+$/, '')
  const safe = !clean || RESERVED_NAMES.test(clean) ? `defects${clean ? `-${clean}` : ''}` : clean
  return `${safe}.${ext}`
}

// Имя снимка без расширения: «DJI_0042.JPG» → «DJI_0042»
export function photoBaseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
