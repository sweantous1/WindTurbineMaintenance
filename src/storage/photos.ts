import type { Detection, DetectionPatch, PhotoAnalysis, PhotoRecord } from '@/domain/detection'
import type { GeoPoint } from '@/domain/types'
import { makeId } from '@/utils/id'
import { db, type WtmDatabase } from './db'

// Фото, подготовленное к сохранению (размеры, миниатюра и EXIF — src/services/photoIngest.ts)
export interface PreparedPhoto {
  fileName: string
  mimeType: string
  blob: Blob
  thumb: Blob
  width: number
  height: number
  takenAt?: string
  gps?: GeoPoint
}

export type NewDetection = Omit<Detection, 'id' | 'photoId' | 'missionId'>

export function createPhotoRepository(database: WtmDatabase = db) {
  const now = () => new Date().toISOString()

  // Фото можно добавлять и к облетанной миссии: разбор фото после полёта — основной сценарий
  async function add(missionId: string, prepared: PreparedPhoto[]): Promise<PhotoRecord[]> {
    const records: PhotoRecord[] = prepared.map((p) => ({
      id: makeId(),
      missionId,
      fileName: p.fileName,
      mimeType: p.mimeType,
      sizeBytes: p.blob.size,
      width: p.width,
      height: p.height,
      takenAt: p.takenAt,
      gps: p.gps,
      addedAt: now(),
    }))
    await database.transaction('rw', database.missions, database.photos, database.photoBlobs, async () => {
      const mission = await database.missions.get(missionId)
      if (!mission) throw new Error(`Миссия ${missionId} не найдена`)
      if (mission.status === 'archived') throw new Error('Миссия в архиве: добавлять фото нельзя')
      await database.photos.bulkAdd(records)
      await database.photoBlobs.bulkAdd(records.map((r, i) => ({ id: r.id, blob: prepared[i].blob, thumb: prepared[i].thumb })))
      // Новое неразобранное фото возвращает миссию из «разобрано» в «облетана»
      if (mission.status === 'analyzed') {
        await database.missions.put({ ...mission, status: 'flown', updatedAt: now() })
      }
    })
    return records
  }

  function listByMission(missionId: string) {
    return database.photos.where('missionId').equals(missionId).sortBy('addedAt')
  }

  function getBlob(photoId: string) {
    return database.photoBlobs.get(photoId)
  }

  function detectionsByMission(missionId: string) {
    return database.detections.where('missionId').equals(missionId).toArray()
  }

  async function setTurbine(photoId: string, turbineId: string | undefined): Promise<void> {
    await database.transaction('rw', database.photos, async () => {
      const photo = await database.photos.get(photoId)
      if (!photo) throw new Error(`Фото ${photoId} не найдено`)
      const next = { ...photo, turbineId }
      if (turbineId === undefined) delete next.turbineId
      await database.photos.put(next)
    })
  }

  // Результат анализа заменяет прежние находки фото целиком — одной транзакцией
  async function saveAnalysis(photoId: string, analysis: PhotoAnalysis, found: NewDetection[]): Promise<void> {
    await database.transaction('rw', [database.missions, database.photos, database.detections], async () => {
      const photo = await database.photos.get(photoId)
      if (!photo) throw new Error(`Фото ${photoId} не найдено`)
      await database.detections.where('photoId').equals(photoId).delete()
      await database.detections.bulkAdd(found.map((d) => ({ ...d, id: makeId(), photoId, missionId: photo.missionId })))
      await database.photos.put({ ...photo, analysis })
      await refreshAnalyzedStatus(photo.missionId)
    })
  }

  async function updateDetection(id: string, patch: DetectionPatch): Promise<void> {
    const updated = await database.detections.update(id, patch)
    if (updated === 0) throw new Error(`Находка ${id} не найдена`)
  }

  async function remove(photoId: string): Promise<void> {
    await database.transaction('rw', [database.missions, database.photos, database.photoBlobs, database.detections], async () => {
      const photo = await database.photos.get(photoId)
      if (!photo) return
      await database.detections.where('photoId').equals(photoId).delete()
      await database.photoBlobs.delete(photoId)
      await database.photos.delete(photoId)
      await refreshAnalyzedStatus(photo.missionId)
    })
  }

  async function removeAllOfMission(missionId: string): Promise<void> {
    await database.transaction('rw', [database.missions, database.photos, database.photoBlobs, database.detections], async () => {
      const ids = await database.photos.where('missionId').equals(missionId).primaryKeys()
      await database.detections.where('missionId').equals(missionId).delete()
      await database.photoBlobs.bulkDelete(ids)
      await database.photos.bulkDelete(ids)
      await refreshAnalyzedStatus(missionId)
    })
  }

  // Облетанная миссия становится «разобранной», когда разобраны все её фото (и есть хотя бы одно)
  async function refreshAnalyzedStatus(missionId: string): Promise<void> {
    const mission = await database.missions.get(missionId)
    if (!mission || (mission.status !== 'flown' && mission.status !== 'analyzed')) return
    const photos = await database.photos.where('missionId').equals(missionId).toArray()
    const allDone = photos.length > 0 && photos.every((p) => p.analysis?.status === 'done')
    const status = allDone ? 'analyzed' : 'flown'
    if (status !== mission.status) await database.missions.put({ ...mission, status, updatedAt: now() })
  }

  return { add, listByMission, getBlob, detectionsByMission, setTurbine, saveAnalysis, updateDetection, remove, removeAllOfMission }
}

export const photos = createPhotoRepository()
