import type { DroneProfile } from '@/domain/types'
import { DEFAULT_DRONE_PROFILE } from '@/domain/defaults'
import { makeId } from '@/utils/id'
import { db, type WtmDatabase } from './db'

export function createDroneProfileRepository(database: WtmDatabase = db) {
  function list() {
    return database.droneProfiles.toArray()
  }

  // Профиль по id; если его удалили — профиль по умолчанию, чтобы расчёты не ломались
  async function getOrDefault(id: string | undefined): Promise<DroneProfile> {
    if (id) {
      const found = await database.droneProfiles.get(id)
      if (found) return found
    }
    return (await database.droneProfiles.get(DEFAULT_DRONE_PROFILE.id)) ?? DEFAULT_DRONE_PROFILE
  }

  async function save(profile: Omit<DroneProfile, 'id'> & { id?: string }): Promise<DroneProfile> {
    const next: DroneProfile = { ...profile, id: profile.id ?? makeId() }
    await database.droneProfiles.put(next)
    return next
  }

  async function remove(id: string): Promise<void> {
    if (id === DEFAULT_DRONE_PROFILE.id) throw new Error('Профиль по умолчанию удалить нельзя')
    await database.droneProfiles.delete(id)
  }

  return { list, getOrDefault, save, remove }
}

export const droneProfiles = createDroneProfileRepository()
