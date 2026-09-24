import Dexie, { type EntityTable } from 'dexie'
import type { DroneProfile, Mission } from '@/domain/types'
import type { Detection, PhotoBlobRecord, PhotoRecord } from '@/domain/detection'
import { DEFAULT_DRONE_PROFILE } from '@/domain/defaults'

export interface SettingRow {
  key: string
  value: unknown
}

// Единственный источник правды для экранов: миссии, профили дронов, фото облёта с находками и настройки.
// localStorage остаётся только для мелочей интерфейса (язык, фильтры).
export class WtmDatabase extends Dexie {
  missions!: EntityTable<Mission, 'id'>
  droneProfiles!: EntityTable<DroneProfile, 'id'>
  settings!: EntityTable<SettingRow, 'key'>
  photos!: EntityTable<PhotoRecord, 'id'>
  photoBlobs!: EntityTable<PhotoBlobRecord, 'id'>
  detections!: EntityTable<Detection, 'id'>

  constructor(name = 'wtm') {
    super(name)
    // Индексируются только поля, по которым ищем; остальное хранится как есть.
    // Новую версию схемы добавлять через this.version(n + 1).stores(...).upgrade(...)
    this.version(1).stores({
      missions: 'id, status, updatedAt, completedAt',
      droneProfiles: 'id',
      settings: 'key',
    })
    // v2: фото облёта (запись, изображение отдельно) и найденные дефекты
    this.version(2).stores({
      photos: 'id, missionId, [missionId+turbineId]',
      photoBlobs: 'id',
      detections: 'id, photoId, missionId',
    })
    this.on('populate', (tx) => {
      tx.table('droneProfiles').add(DEFAULT_DRONE_PROFILE)
    })
  }
}

export const db = new WtmDatabase()
