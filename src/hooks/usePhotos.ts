import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/storage/db'
import type { Detection, PhotoRecord } from '@/domain/detection'

// Живые запросы: список обновится сам после анализа, удаления или смены турбины

export function usePhotos(missionId: string | undefined): PhotoRecord[] | undefined {
  return useLiveQuery(
    () => (missionId ? db.photos.where('missionId').equals(missionId).sortBy('addedAt') : []),
    [missionId],
  )
}

export function useDetections(missionId: string | undefined): Detection[] | undefined {
  return useLiveQuery(
    () => (missionId ? db.detections.where('missionId').equals(missionId).toArray() : []),
    [missionId],
  )
}

// Число находок по миссиям для истории и главной
export function useDetectionCounts(): Map<string, number> | undefined {
  return useLiveQuery(async () => {
    const counts = new Map<string, number>()
    await db.detections.each((d) => counts.set(d.missionId, (counts.get(d.missionId) ?? 0) + 1))
    return counts
  }, [])
}
