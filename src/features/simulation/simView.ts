import type { FlightPhase, TrajectorySample } from '@/domain/flightPath'
import { SPEED_OPTIONS } from './simClock'

// Помощники экрана 3D-облёта без React и three.js: форматирование, ключи перевода, цвета.
// Экран и сцена берут их отсюда, чтобы легенда и путь в сцене не разошлись

// Реальный дрон в полметра рядом с ротором 120 м не разглядеть — в сцене он крупнее
export const DRONE_VISUAL_SPAN_M = 7

// ---------- Камера ----------

export type CameraMode = 'follow' | 'free' | 'top'
export const CAMERA_MODES: readonly CameraMode[] = ['follow', 'free', 'top']

export function nextCameraMode(mode: CameraMode): CameraMode {
  return CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length]
}

// Расстояние, с которого прямоугольник width × depth целиком виден камерой с вертикальным углом
// обзора fovDeg и соотношением сторон aspect (вид почти сверху)
export function topViewDistance(width: number, depth: number, fovDeg: number, aspect: number, margin = 1.05): number {
  const tanV = Math.tan((fovDeg * Math.PI) / 360)
  const tanH = tanV * (aspect > 0 ? aspect : 1)
  return Math.max(depth / 2 / tanV, width / 2 / tanH) * margin
}

// Экспоненциальное сглаживание угла кратчайшим путём: с 350° на 10° — через 0°, а не назад на 340°
export function smoothAngle(current: number, target: number, dtS: number, ratePerS: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  if (!(dtS > 0)) return current
  return current + delta * (1 - Math.exp(-ratePerS * dtS))
}

// ---------- Время и скорость ----------

// «1:05:07» — часы без ведущего нуля, минуты и секунды двумя цифрами
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Соседняя скорость из списка; скорость не из списка сдвигается к ближайшей в нужную сторону
export function nextSpeed(current: number, step: 1 | -1): number {
  if (step > 0) return SPEED_OPTIONS.find((s) => s > current) ?? SPEED_OPTIONS[SPEED_OPTIONS.length - 1]
  return SPEED_OPTIONS.findLast((s) => s < current) ?? SPEED_OPTIONS[0]
}

// ---------- Фаза полёта ----------

export interface PhaseText {
  key: string
  params?: Record<string, string | number>
}

// Турбина, к которой сейчас летим, на высоту ступицы которой выходим или которую облетаем
export function currentVisitIndex(sample: TrajectorySample): number | null {
  if (sample.finished || sample.visitIndex === undefined) return null
  return sample.phase === 'transit' || sample.phase === 'approach' || sample.phase === 'orbit' ? sample.visitIndex : null
}

export function phaseText(sample: TrajectorySample, totalVisits: number, nameOf: (turbineId: string) => string): PhaseText {
  if (sample.finished) return { key: 'sim.phase.finished' }
  const visit = currentVisitIndex(sample)
  if (visit !== null && sample.turbineId !== undefined) {
    return { key: `sim.phase.${sample.phase}`, params: { n: visit + 1, total: totalVisits, name: nameOf(sample.turbineId) } }
  }
  // Перелёт без турбины траектория и так называет возвратом; здесь — на случай снимка без номера
  if (sample.phase === 'transit') return { key: 'sim.phase.return' }
  return { key: `sim.phase.${sample.phase}` }
}

export const PHASE_KEYS: readonly string[] = ['takeoff', 'transit', 'approach', 'orbit', 'return', 'landing', 'finished'].map(
  (p) => `sim.phase.${p}`,
)

// ---------- Цвета пути ----------

export type PathKind = 'transit' | 'orbit' | 'conflict'
export const PATH_KINDS: readonly PathKind[] = ['transit', 'orbit', 'conflict']

// plan — весь маршрут тонкой линией, passed — пройденная часть поверх, толще и насыщеннее
export const PATH_COLORS: Readonly<Record<PathKind, { plan: string; passed: string }>> = {
  transit: { plan: '#93c5fd', passed: '#2563eb' },
  orbit: { plan: '#fcd34d', passed: '#f59e0b' },
  conflict: { plan: '#fca5a5', passed: '#dc2626' },
}

// Кольца у основания башен
export const RING_COLORS = { conflict: '#dc2626', current: '#06b6d4' } as const

export function pathKind(phase: FlightPhase, conflict: boolean): PathKind {
  if (conflict) return 'conflict'
  return phase === 'orbit' ? 'orbit' : 'transit'
}

// ---------- Заряд ----------

export type BatteryLevel = 'ok' | 'reserve' | 'empty'

// Остаток ниже резерва — ещё долетели бы, но нарушив запас; ниже нуля — не долетели бы
export function batteryLevel(remainingPct: number, reservePct: number): BatteryLevel {
  if (!(remainingPct >= 0)) return 'empty'
  return remainingPct < reservePct ? 'reserve' : 'ok'
}
