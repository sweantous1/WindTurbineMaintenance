import type { TFunction } from 'i18next'
import { DEFAULT_DRONE_PROFILE, DEFAULT_DRONE_PROFILE_ID, LEGACY_DEFAULT_DRONE_NAME } from '@/domain/defaults'
import type { DroneProfile } from '@/domain/types'

// Старое имя осталось в существующих базах и в снимках профиля у облетанных миссий
const BUILTIN_NAMES = new Set([DEFAULT_DRONE_PROFILE.name, LEGACY_DEFAULT_DRONE_NAME])

// Встроенный профиль, который не переименовывали: его имя показываем на языке интерфейса
export function hasBuiltinName(p: Pick<DroneProfile, 'id' | 'name'>): boolean {
  return p.id === DEFAULT_DRONE_PROFILE_ID && BUILTIN_NAMES.has(p.name)
}

export function droneDisplayName(p: Pick<DroneProfile, 'id' | 'name'>, t: TFunction): string {
  return hasBuiltinName(p) ? t('settings.drones.defaultName') : p.name
}
