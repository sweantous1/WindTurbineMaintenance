import type { Mission, MissionPatch, MissionType } from '@/domain/types'
import { DEFAULT_DRONE_PROFILE_ID, DEFAULT_FLIGHT_ALTITUDE_M, DEFAULT_LIMITS } from '@/domain/defaults'
import { derivePreFlightStatus, isPreFlight, lockedFields } from '@/domain/missionStatus'
import { makeId } from '@/utils/id'
import { db, type WtmDatabase } from './db'

const ACTIVE_KEY = 'activeMissionId'

export class MissionLockedError extends Error {
  readonly fields: string[]
  constructor(fields: string[]) {
    super(`Миссия уже облетана, эти поля только для чтения: ${fields.join(', ')}`)
    this.name = 'MissionLockedError'
    this.fields = fields
  }
}

export interface NewMissionInput {
  name: string
  type?: MissionType
  droneProfileId?: string
  flightAltitudeM?: number
}

export function createMissionRepository(database: WtmDatabase = db) {
  const now = () => new Date().toISOString()

  async function getActiveId(): Promise<string | null> {
    const row = await database.settings.get(ACTIVE_KEY)
    return typeof row?.value === 'string' ? row.value : null
  }

  async function setActive(id: string | null): Promise<void> {
    if (id === null) await database.settings.delete(ACTIVE_KEY)
    else await database.settings.put({ key: ACTIVE_KEY, value: id })
  }

  // Новая миссия сразу становится активной
  async function create(input: NewMissionInput): Promise<Mission> {
    const ts = now()
    const mission: Mission = {
      id: makeId(),
      schemaVersion: 1,
      name: input.name.trim() || 'Миссия',
      type: input.type ?? 'planned',
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
      droneProfileId: input.droneProfileId ?? DEFAULT_DRONE_PROFILE_ID,
      flightAltitudeM: input.flightAltitudeM ?? DEFAULT_FLIGHT_ALTITUDE_M,
      limits: { ...DEFAULT_LIMITS },
    }
    await database.transaction('rw', database.missions, database.settings, async () => {
      await database.missions.add(mission)
      await setActive(mission.id)
    })
    return mission
  }

  function get(id: string) {
    return database.missions.get(id)
  }

  function list() {
    return database.missions.orderBy('updatedAt').reverse().toArray()
  }

  // Правка с проверкой статуса: облетанную миссию нельзя «переписать задним числом»
  async function update(id: string, patch: MissionPatch): Promise<Mission> {
    return database.transaction('rw', database.missions, async () => {
      const current = await database.missions.get(id)
      if (!current) throw new Error(`Миссия ${id} не найдена`)
      const locked = lockedFields(current.status, patch)
      if (locked.length > 0) throw new MissionLockedError(locked)
      const next: Mission = { ...current, ...patch, updatedAt: now() }
      // undefined в patch означает «очистить поле»
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (next as unknown as Record<string, unknown>)[k]
      }
      if (isPreFlight(current.status)) next.status = derivePreFlightStatus(next)
      await database.missions.put(next)
      return next
    })
  }

  // Завершение одной транзакцией: статус, дата и сброс активной миссии.
  // Ничего не удаляется. Без force сначала сообщает, чего не хватает.
  async function complete(id: string, opts: { force?: boolean } = {}): Promise<CompleteResult> {
    return database.transaction('rw', database.missions, database.settings, async () => {
      const current = await database.missions.get(id)
      if (!current) throw new Error(`Миссия ${id} не найдена`)
      if (!isPreFlight(current.status)) return { ok: true as const, mission: current }
      const missing: ('route' | 'weather')[] = []
      if (!current.route) missing.push('route')
      if (!current.weather) missing.push('weather')
      if (missing.length > 0 && !opts.force) return { ok: false as const, missing }
      const ts = now()
      const next: Mission = { ...current, status: 'flown', completedAt: ts, updatedAt: ts }
      await database.missions.put(next)
      if ((await getActiveId()) === id) await setActive(null)
      return { ok: true as const, mission: next }
    })
  }

  async function archive(id: string): Promise<void> {
    await database.transaction('rw', database.missions, async () => {
      const current = await database.missions.get(id)
      if (!current) return
      if (isPreFlight(current.status)) throw new Error('Архивировать можно только облетанную миссию')
      await database.missions.put({ ...current, status: 'archived', updatedAt: now() })
    })
  }

  async function remove(id: string): Promise<void> {
    await database.transaction('rw', database.missions, database.settings, async () => {
      await database.missions.delete(id)
      if ((await getActiveId()) === id) await setActive(null)
    })
  }

  return { create, get, list, update, complete, archive, remove, getActiveId, setActive }
}

export type CompleteResult =
  | { ok: true; mission: Mission }
  | { ok: false; missing: ('route' | 'weather')[] }

export const missions = createMissionRepository()
