import type { Mission, MissionPatch, MissionStatus } from './types'

export const PRE_FLIGHT: readonly MissionStatus[] = ['draft', 'planned', 'ready']
export const POST_FLIGHT: readonly MissionStatus[] = ['flown', 'analyzed', 'archived']

export const isPreFlight = (status: MissionStatus) => PRE_FLIGHT.includes(status)

// Статус до полёта вычисляется из данных: его нельзя «забыть» обновить
export function derivePreFlightStatus(m: Pick<Mission, 'route' | 'weather' | 'departureTime'>): MissionStatus {
  if (!m.route || m.route.order.length === 0) return 'draft'
  if (!m.weather || !m.departureTime) return 'planned'
  return 'ready'
}

// После полёта полётные данные только читаются: погода, маршрут, ферма, лимиты и час вылета
// — это запись о том, что было. Менять можно только заметки (а позже — фото и детекции).
const POST_FLIGHT_EDITABLE: ReadonlySet<keyof MissionPatch> = new Set(['notes', 'name'])

export function canEdit(status: MissionStatus, field: keyof MissionPatch): boolean {
  if (isPreFlight(status)) return true
  if (status === 'archived') return false
  return POST_FLIGHT_EDITABLE.has(field)
}

export function lockedFields(status: MissionStatus, patch: MissionPatch): (keyof MissionPatch)[] {
  return (Object.keys(patch) as (keyof MissionPatch)[]).filter((f) => !canEdit(status, f))
}

export type MissionStepKey = 'mission' | 'farm' | 'route' | 'weather' | 'simulation' | 'complete' | 'detection' | 'history'

export interface MissionStep {
  key: MissionStepKey
  done: boolean
  // Шаг ещё не реализован в приложении
  upcoming?: boolean
}

// Шаги сценария для главной; статус каждого шага вычисляется из данных миссии
export function missionSteps(m: Mission | undefined): MissionStep[] {
  const flown = m ? !isPreFlight(m.status) : false
  return [
    { key: 'mission', done: !!m },
    { key: 'farm', done: !!m?.farm && m.farm.turbines.length > 0 },
    { key: 'route', done: !!m?.route && m.route.order.length > 0 },
    { key: 'weather', done: !!m?.weather && !!m?.departureTime },
    { key: 'simulation', done: false, upcoming: true },
    { key: 'complete', done: flown },
    { key: 'detection', done: m?.status === 'analyzed' || m?.status === 'archived', upcoming: true },
    { key: 'history', done: flown },
  ]
}
