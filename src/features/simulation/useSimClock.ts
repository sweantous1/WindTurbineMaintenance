import { useCallback, useSyncExternalStore } from 'react'
import { sampleAt, type Trajectory } from '@/domain/flightPath'
import type { SimClock, SimSnapshot } from './simClock'
import { currentVisitIndex } from './simView'

// Интерфейс перерисовывается по уведомлениям часов (не чаще 10 раз в секунду), а не каждый кадр
export function useSimSnapshot(clock: SimClock): SimSnapshot {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot)
}

// Номер текущей турбины: число, поэтому перерисовка только при его смене
export function useCurrentVisit(clock: SimClock, trajectory: Trajectory): number | null {
  const read = useCallback(() => currentVisitIndex(sampleAt(trajectory, clock.getSnapshot().timeS)), [clock, trajectory])
  return useSyncExternalStore(clock.subscribe, read)
}
