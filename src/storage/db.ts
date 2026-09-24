import Dexie, { type EntityTable } from 'dexie'
import type { DroneProfile, Mission } from '@/domain/types'
import { DEFAULT_DRONE_PROFILE } from '@/domain/defaults'

export interface SettingRow {
  key: string
  value: unknown
}

// Единственный источник правды для экранов: миссии, профили дронов и настройки.
// localStorage остаётся только для мелочей интерфейса (язык, фильтры).
export class WtmDatabase extends Dexie {
  missions!: EntityTable<Mission, 'id'>
  droneProfiles!: EntityTable<DroneProfile, 'id'>
  settings!: EntityTable<SettingRow, 'key'>

  constructor(name = 'wtm') {
    super(name)
    // Индексируются только поля, по которым ищем; остальное хранится как есть.
    // Новую версию схемы добавлять через this.version(2).stores(...).upgrade(...)
    this.version(1).stores({
      missions: 'id, status, updatedAt, completedAt',
      droneProfiles: 'id',
      settings: 'key',
    })
    this.on('populate', (tx) => {
      tx.table('droneProfiles').add(DEFAULT_DRONE_PROFILE)
    })
  }
}

export const db = new WtmDatabase()
