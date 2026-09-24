// Геометрия рамок поверх снимка. Координаты — в пикселях оригинала (viewBox SVG совпадает
// с натуральным размером), поэтому толщина линий и шрифт задаются через «единиц на пиксель экрана»

export interface Size {
  width: number
  height: number
}

// Рамка в долях ширины и высоты оригинала
export interface FracBox {
  x: number
  y: number
  w: number
  h: number
}

export interface OverlayStyle {
  strokeWidth: number
  selectedStrokeWidth: number
  fontSize: number
  labelPadX: number
  labelHeight: number
}

// unitsPerPx — сколько пикселей оригинала приходится на пиксель экрана (или готового PNG)
export function overlayStyle(unitsPerPx: number): OverlayStyle {
  const u = Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? unitsPerPx : 1
  return {
    strokeWidth: 2 * u,
    selectedStrokeWidth: 4 * u,
    fontSize: 12 * u,
    labelPadX: 4 * u,
    labelHeight: 18 * u,
  }
}

// Ширина подписи — оценка: в SVG текст до отрисовки не измерить, а подпись короткая («Трещина 0,87»)
export function labelWidth(text: string, fontSize: number): number {
  return Array.from(text).length * fontSize * 0.62
}

export interface OverlayLabel {
  x: number
  y: number
  width: number
  height: number
  textX: number
  // Середина плашки: текст рисуется с базовой линией по центру
  textY: number
  text: string
}

export interface OverlayItem<T> {
  item: T
  x: number
  y: number
  w: number
  h: number
  label: OverlayLabel
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))

export function layoutOverlay<T extends FracBox>(
  items: readonly T[],
  size: Size,
  style: OverlayStyle,
  labelText: (item: T) => string,
): OverlayItem<T>[] {
  const laid = items.map((item) => {
    const x0 = clamp01(item.x) * size.width
    const y0 = clamp01(item.y) * size.height
    const x1 = clamp01(item.x + item.w) * size.width
    const y1 = clamp01(item.y + item.h) * size.height
    const text = labelText(item)
    const width = Math.min(size.width, labelWidth(text, style.fontSize) + 2 * style.labelPadX)
    const height = style.labelHeight
    // Подпись над рамкой, а у верхнего края кадра — внутри рамки; по ширине не выходит за кадр
    const lx = Math.max(0, Math.min(x0, size.width - width))
    const ly = y0 - height >= 0 ? y0 - height : Math.min(y0, Math.max(0, size.height - height))
    return {
      item,
      x: x0,
      y: y0,
      w: Math.max(0, x1 - x0),
      h: Math.max(0, y1 - y0),
      label: { x: lx, y: ly, width, height, textX: lx + style.labelPadX, textY: ly + height / 2, text },
    }
  })
  // Большие рамки рисуются первыми: маленькая внутри большой остаётся сверху и по ней можно кликнуть
  return laid.sort((a, b) => b.w * b.h - a.w * a.h)
}

// Масштаб, с которым object-contain вписывает снимок в область просмотра
export function fitScale(natural: Size, box: Size): number {
  if (natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) return 0
  return Math.min(box.width / natural.width, box.height / natural.height)
}

// CSS-преобразование обёртки со снимком и рамками: translate(tx, ty) scale(scale), начало — левый верхний угол
export interface ZoomTransform {
  scale: number
  tx: number
  ty: number
}

export const NO_ZOOM: ZoomTransform = { scale: 1, tx: 0, ty: 0 }

export interface ZoomOptions {
  // Какую долю области просмотра займёт рамка
  fill: number
  // Не крупнее, чем столько экранных пикселей на пиксель оригинала: дальше видно только размытие
  maxPixelScale: number
  maxScale: number
}

const DEFAULT_ZOOM: ZoomOptions = { fill: 0.45, maxPixelScale: 4, maxScale: 64 }

// По одной оси: центр рамки — в центр области, но снимок, если он крупнее области, не отъезжает от края
function axisShift(center: number, scale: number, container: number, imgStart: number, imgLength: number): number {
  const scaledLength = imgLength * scale
  if (scaledLength <= container) return (container - scaledLength) / 2 - imgStart * scale
  const t = container / 2 - center * scale
  const min = container - (imgStart + imgLength) * scale
  const max = -imgStart * scale
  return Math.min(max, Math.max(min, t))
}

export function zoomToBox(box: FracBox, natural: Size, container: Size, options: Partial<ZoomOptions> = {}): ZoomTransform {
  const o = { ...DEFAULT_ZOOM, ...options }
  const fit = fitScale(natural, container)
  if (fit <= 0) return NO_ZOOM
  const dispW = natural.width * fit
  const dispH = natural.height * fit
  const offX = (container.width - dispW) / 2
  const offY = (container.height - dispH) / 2
  const bw = Math.max(clamp01(box.w) * dispW, 1)
  const bh = Math.max(clamp01(box.h) * dispH, 1)
  const wanted = Math.min((o.fill * container.width) / bw, (o.fill * container.height) / bh)
  const scale = Math.max(1, Math.min(wanted, o.maxPixelScale / fit, o.maxScale))
  const cx = offX + clamp01(box.x + box.w / 2) * dispW
  const cy = offY + clamp01(box.y + box.h / 2) * dispH
  return {
    scale,
    tx: axisShift(cx, scale, container.width, offX, dispW),
    ty: axisShift(cy, scale, container.height, offY, dispH),
  }
}

// PNG для выгрузки: в размере оригинала, но не больше 4096 по большей стороне
export const PNG_MAX_SIDE = 4096

export function exportSize(natural: Size, maxSide = PNG_MAX_SIDE): Size {
  const longest = Math.max(natural.width, natural.height)
  const scale = longest > maxSide ? maxSide / longest : 1
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  }
}

// Линии и подписи в PNG — как на экране, где снимок занимает около 1600 px по большей стороне
export function exportUnitsPerPx(size: Size): number {
  return Math.max(1, Math.max(size.width, size.height) / 1600)
}
