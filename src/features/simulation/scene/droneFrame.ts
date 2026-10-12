import { Vector3 } from 'three'
import type { TrajectorySample } from '@/domain/flightPath'

// Положение дрона на кадр. Считает SimDriver, дрон, путь и камера только читают, без state React

export interface DroneFrame {
  // Точка траектории в координатах сцены
  position: Vector3
  // Сглаженный поворот вокруг вертикали (при нуле нос на север, -Z)
  rotationY: number
  // Во сколько раз время полёта шло быстрее реального в последнем кадре (на паузе 1)
  pace: number
  sample: TrajectorySample | null
}

export function createDroneFrame(): DroneFrame {
  return { position: new Vector3(), rotationY: 0, pace: 1, sample: null }
}

// Порядок useFrame по возрастанию: часы -> объекты -> камера -> подписи.
// Положительный приоритет отключает автоотрисовку R3F
export const FRAME_PRIORITY = { driver: -3, objects: -2, camera: -1 } as const

// Выше этого дрон считается в воздухе: винты крутятся, под ним тень и отвес
export const AIRBORNE_M = 0.3

// Элементы подписей турбин: слой в DOM регистрирует их, проектор в кадре двигает
export interface LabelRegistry {
  elements: Map<string, HTMLElement>
}

export function createLabelRegistry(): LabelRegistry {
  return { elements: new Map() }
}
