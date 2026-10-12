import type { DroneFormValues } from '@/features/weather/droneProfileForm'

// Черновик профиля держим вне React: секция размонтируется при переходе по шапке,
// а HashRouter не умеет блокировать навигацию
export interface DroneDraft {
  // id профиля или метка нового, ещё не сохранённого
  selectedId: string
  // версия профиля, к которой относятся правки; к изменённому профилю их не подставляем
  baseKey: string
  values: DroneFormValues
}

let current: DroneDraft | null = null

export function getDroneDraft(): DroneDraft | null {
  return current
}

export function setDroneDraft(draft: DroneDraft | null): void {
  current = draft
}

// Правки для открытой формы, если они к ней относятся
export function draftValuesFor(selectedId: string, baseKey: string): DroneFormValues | undefined {
  return current && current.selectedId === selectedId && current.baseKey === baseKey ? current.values : undefined
}
