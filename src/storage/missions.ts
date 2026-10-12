import type { DroneProfile, Mission, MissionPatch, MissionType, RoutePlan } from '@/domain/types'
import { DEFAULT_DRONE_PROFILE, DEFAULT_DRONE_PROFILE_ID, DEFAULT_FLIGHT_ALTITUDE_M, DEFAULT_LIMITS } from '@/domain/defaults'
import { missionPlanLengthM } from '@/domain/flightPlan'
import { derivePreFlightStatus, isPreFlight, lockedFields, PRE_FLIGHT } from '@/domain/missionStatus'
import { makeId } from '@/utils/id'
import { db, type WtmDatabase } from './db'

const ACTIVE_KEY = 'activeMissionId'
// Тот же допуск, что у пересчёта длины на экране маршрута (lengthDrifted)
const LENGTH_DRIFT_M = 0.01

// Длина плана зависит от потолка дрона. Если пересчитывать нечего, возвращает тот же объект
function syncedRoute(m: Mission, drone: DroneProfile): RoutePlan | undefined {
  if (!m.route) return m.route
  let lengthM: number | undefined
  try {
    lengthM = missionPlanLengthM(m, drone)
  } catch (e) {
    // Битая высота не должна мешать записать полёт или сохранить профиль, длина остаётся прежней
    if (e instanceof RangeError) return m.route
    throw e
  }
  if (lengthM === undefined || Math.abs(lengthM - m.route.lengthM) <= LENGTH_DRIFT_M) return m.route
  return { ...m.route, lengthM }
}

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

  // Облетанную миссию задним числом не переписать
  async function update(id: string, patch: MissionPatch): Promise<Mission> {
    return database.transaction('rw', database.missions, async () => {
      const current = await database.missions.get(id)
      if (!current) throw new Error(`Миссия ${id} не найдена`)
      const locked = lockedFields(current.status, patch)
      if (locked.length > 0) throw new MissionLockedError(locked)
      const next: Mission = { ...current, ...patch, updatedAt: now() }
      // undefined в patch очищает поле
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (next as unknown as Record<string, unknown>)[k]
      }
      if (isPreFlight(current.status)) next.status = derivePreFlightStatus(next)
      await database.missions.put(next)
      return next
    })
  }

  // Одной транзакцией: статус, дата, снимок профиля и сброс активной миссии.
  // Без force сначала возвращает, чего не хватает
  async function complete(id: string, opts: { force?: boolean } = {}): Promise<CompleteResult> {
    return database.transaction('rw', database.missions, database.settings, database.droneProfiles, async () => {
      const current = await database.missions.get(id)
      if (!current) throw new Error(`Миссия ${id} не найдена`)
      if (!isPreFlight(current.status)) return { ok: true as const, mission: current }
      const missing: ('route' | 'weather')[] = []
      if (!current.route || current.route.order.length === 0) missing.push('route')
      if (!current.weather) missing.push('weather')
      if (missing.length > 0 && !opts.force) return { ok: false as const, missing }
      const ts = now()
      const drone =
        (await database.droneProfiles.get(current.droneProfileId)) ??
        (await database.droneProfiles.get(DEFAULT_DRONE_PROFILE_ID)) ??
        DEFAULT_DRONE_PROFILE
      // Длина по тому же профилю, что уходит в снимок: его могли поменять в настройках,
      // а после полёта маршрут уже не пересчитать
      const route = syncedRoute(current, drone)
      const next: Mission = {
        ...current,
        ...(route ? { route } : {}),
        status: 'flown',
        completedAt: ts,
        updatedAt: ts,
        droneSnapshot: { ...drone },
      }
      await database.missions.put(next)
      if ((await getActiveId()) === id) await setActive(null)
      return { ok: true as const, mission: next }
    })
  }

  // После правки профиля пересчитываем длину у миссий до полёта с ним (без id - у всех), миссии
  // удалённого профиля считаем по профилю по умолчанию. Возвращает число изменённых
  async function recomputeRouteLengths(droneProfileId?: string): Promise<number> {
    return database.transaction('rw', database.missions, database.droneProfiles, async () => {
      const profiles = new Map((await database.droneProfiles.toArray()).map((p) => [p.id, p]))
      const fallback = profiles.get(DEFAULT_DRONE_PROFILE_ID) ?? DEFAULT_DRONE_PROFILE
      const candidates = await database.missions.where('status').anyOf([...PRE_FLIGHT]).toArray()
      let changed = 0
      for (const m of candidates) {
        const own = profiles.get(m.droneProfileId)
        const affected =
          droneProfileId === undefined ||
          m.droneProfileId === droneProfileId ||
          // Профиль миссии удалён, она летит на профиле по умолчанию
          (droneProfileId === DEFAULT_DRONE_PROFILE_ID && !own)
        if (!affected) continue
        const route = syncedRoute(m, own ?? fallback)
        if (route === m.route) continue
        // updatedAt не трогаем: длина производная, а список по updatedAt не должен прыгать
        await database.missions.put({ ...m, route })
        changed++
      }
      return changed
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

  // Вместе с миссией удаляем её фото и находки, чтобы не висели сиротами
  async function remove(id: string): Promise<void> {
    await database.transaction('rw', [database.missions, database.settings, database.photos, database.photoBlobs, database.detections], async () => {
      const photoIds = await database.photos.where('missionId').equals(id).primaryKeys()
      await database.detections.where('missionId').equals(id).delete()
      await database.photoBlobs.bulkDelete(photoIds)
      await database.photos.bulkDelete(photoIds)
      await database.missions.delete(id)
      if ((await getActiveId()) === id) await setActive(null)
    })
  }

  return { create, get, list, update, complete, recomputeRouteLengths, archive, remove, getActiveId, setActive }
}

export type CompleteResult =
  | { ok: true; mission: Mission }
  | { ok: false; missing: ('route' | 'weather')[] }

export const missions = createMissionRepository()
