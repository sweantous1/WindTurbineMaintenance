import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/storage/db'
import { DEFAULT_DRONE_PROFILE } from '@/domain/defaults'
import { isPreFlight, PRE_FLIGHT } from '@/domain/missionStatus'
import type { DroneProfile, Mission } from '@/domain/types'

// Живые запросы: любой экран обновится сам, когда миссию поменяли на другом экране

// Полная выборка со фермой, маршрутом и погодой каждой миссии — только там, где нужен весь список
// (история). Запрос перечитывается после любой записи в миссии, и с длинной историей это сотни мс
export function useMissions(): Mission[] | undefined {
  return useLiveQuery(() => db.missions.orderBy('updatedAt').reverse().toArray(), [])
}

// Сколько всего миссий: count() не читает и не копирует сами записи
export function useMissionCount(): number | undefined {
  return useLiveQuery(() => db.missions.count(), [])
}

export interface MissionMenu {
  // Миссии до полёта, свежие сверху
  inWork: Mission[]
  // Последние облетанные, не больше flownLimit
  flown: Mission[]
  // Всего облетанных, включая не попавшие в список
  flownTotal: number
}

// Для меню в шапке: миссии в работе и несколько последних облетанных, а не вся история
export async function loadMissionMenu(flownLimit: number): Promise<MissionMenu> {
  const inWork = await db.missions.where('status').anyOf([...PRE_FLIGHT]).toArray()
  inWork.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  // Курсор по дате останавливается, как только набрал flownLimit облетанных
  const flown = await db.missions
    .orderBy('updatedAt')
    .reverse()
    .filter((m) => !isPreFlight(m.status))
    .limit(flownLimit)
    .toArray()
  // Облетанные — всё, что не до полёта, как и в фильтре выше: так учитываются и статусы из старой базы
  const flownTotal = (await db.missions.count()) - inWork.length
  return { inWork, flown, flownTotal }
}

export function useMissionMenu(flownLimit: number): MissionMenu | undefined {
  return useLiveQuery(() => loadMissionMenu(flownLimit), [flownLimit])
}

// undefined — ещё загружается; null — активной миссии нет
export function useActiveMission(): Mission | null | undefined {
  return useLiveQuery(async () => {
    const row = await db.settings.get('activeMissionId')
    if (typeof row?.value !== 'string') return null
    return (await db.missions.get(row.value)) ?? null
  }, [])
}

export function useDroneProfiles(): DroneProfile[] | undefined {
  return useLiveQuery(() => db.droneProfiles.toArray(), [])
}

// Профиль дрона для расчётов по миссии: у облетанной — снимок на момент полёта,
// у остальных — текущий профиль из настроек
export function useMissionDrone(mission: Mission): DroneProfile | undefined {
  const live = useDroneProfile(mission.droneSnapshot ? undefined : mission.droneProfileId)
  return mission.droneSnapshot ?? live
}

export function useDroneProfile(id: string | undefined): DroneProfile | undefined {
  return useLiveQuery(async () => {
    if (id) {
      const found = await db.droneProfiles.get(id)
      if (found) return found
    }
    return (await db.droneProfiles.get(DEFAULT_DRONE_PROFILE.id)) ?? DEFAULT_DRONE_PROFILE
  }, [id])
}
