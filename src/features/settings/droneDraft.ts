import type { DroneFormValues } from '@/features/weather/droneProfileForm'

// Несохранённые правки профиля дрона живут вне React-дерева: при переходе по шапке секция
// размонтируется вместе со страницей, и правки пропали бы молча. Спрашивать «уйти?» нечем:
// HashRouter не умеет блокировать переход. Поэтому правки просто дожидаются возвращения
export interface DroneDraft {
  // id профиля или метка нового, ещё не сохранённого
  selectedId: string
  // Версия профиля из базы, к которой относятся правки: к изменённому с тех пор профилю
  // старые правки не подставляются
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
