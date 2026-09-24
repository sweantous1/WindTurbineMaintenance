import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/storage/db'
import { DEFAULT_DRONE_PROFILE } from '@/domain/defaults'
import type { DroneProfile, Mission } from '@/domain/types'

// Живые запросы: любой экран обновится сам, когда миссию поменяли на другом экране

export function useMissions(): Mission[] | undefined {
  return useLiveQuery(() => db.missions.orderBy('updatedAt').reverse().toArray(), [])
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
