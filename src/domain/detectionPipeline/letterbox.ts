// Рамка x1, y1 — левый верхний угол, x2, y2 — правый нижний, в пикселях
export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

// Серый фон полей, как в LetterBox ultralytics: на нём модель и обучалась
export const LETTERBOX_FILL_BYTE = 114
export const LETTERBOX_FILL = LETTERBOX_FILL_BYTE / 255

// Как фрагмент srcW×srcH вписан в квадратный вход size×size
export interface Letterbox {
  size: number
  srcW: number
  srcH: number
  scale: number
  // Размер уменьшенного (увеличенного) фрагмента внутри входа
  newW: number
  newH: number
  // Отступ слева и сверху; остаток поля — справа и снизу
  padX: number
  padY: number
}

export function letterbox(srcW: number, srcH: number, size = 640): Letterbox {
  if (!(srcW > 0 && srcH > 0 && size > 0)) throw new RangeError(`Некорректные размеры: ${srcW}×${srcH} → ${size}`)
  const scale = Math.min(size / srcW, size / srcH)
  const newW = Math.min(size, Math.max(1, Math.round(srcW * scale)))
  const newH = Math.min(size, Math.max(1, Math.round(srcH * scale)))
  // −0.1 повторяет ultralytics: при нечётном поле лишний пиксель уходит вправо и вниз
  const padX = Math.max(0, Math.round((size - newW) / 2 - 0.1))
  const padY = Math.max(0, Math.round((size - newH) / 2 - 0.1))
  return { size, srcW, srcH, scale, newW, newH, padX, padY }
}

// Масштаб по каждой оси берётся от фактического размера после округления: фрагмент рисуется ровно в newW×newH
function axisScale(lb: Letterbox): { sx: number; sy: number } {
  return { sx: lb.newW / lb.srcW, sy: lb.newH / lb.srcH }
}

// Координаты фрагмента → координаты входа модели
export function toLetterbox(lb: Letterbox, box: Box): Box {
  const { sx, sy } = axisScale(lb)
  return {
    x1: box.x1 * sx + lb.padX,
    y1: box.y1 * sy + lb.padY,
    x2: box.x2 * sx + lb.padX,
    y2: box.y2 * sy + lb.padY,
  }
}

// Координаты входа модели → координаты фрагмента (без обрезки по краям)
export function fromLetterbox(lb: Letterbox, box: Box): Box {
  const { sx, sy } = axisScale(lb)
  return {
    x1: (box.x1 - lb.padX) / sx,
    y1: (box.y1 - lb.padY) / sy,
    x2: (box.x2 - lb.padX) / sx,
    y2: (box.y2 - lb.padY) / sy,
  }
}

// RGBA size×size (как из getImageData) → плоский CHW float32 RGB 0..1 для входа [1, 3, size, size].
// out можно передать повторно, чтобы не выделять 5 МБ на каждый фрагмент
export function rgbaToChw(rgba: ArrayLike<number>, size: number, out?: Float32Array): Float32Array {
  const plane = size * size
  if (rgba.length < plane * 4) throw new RangeError(`Ожидалось ${plane * 4} байт RGBA, получено ${rgba.length}`)
  const chw = out && out.length === plane * 3 ? out : new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    const p = i * 4
    chw[i] = rgba[p] / 255
    chw[plane + i] = rgba[p + 1] / 255
    chw[2 * plane + i] = rgba[p + 2] / 255
  }
  return chw
}
