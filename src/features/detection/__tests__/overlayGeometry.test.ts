import { describe, expect, it } from 'vitest'
import { NO_ZOOM, exportSize, exportUnitsPerPx, fitScale, labelWidth, layoutOverlay, overlayStyle, zoomToBox } from '../overlayGeometry'

const size = { width: 8000, height: 5000 }
const label = () => 'Трещина 0,87'

describe('рамки поверх снимка', () => {
  it('доли переводятся в пиксели оригинала (viewBox SVG)', () => {
    const [it0] = layoutOverlay([{ x: 0.25, y: 0.5, w: 0.1, h: 0.2 }], size, overlayStyle(1), label)
    expect([it0.x, it0.y, it0.w, it0.h]).toEqual([2000, 2500, 800, 1000])
  })

  it('рамка за краем кадра обрезается по кадру', () => {
    const [it0] = layoutOverlay([{ x: 0.95, y: -0.1, w: 0.2, h: 0.3 }], size, overlayStyle(1), label)
    expect(it0.x).toBe(7600)
    expect(it0.y).toBe(0)
    expect(it0.x + it0.w).toBe(8000)
    expect(it0.h).toBeCloseTo(1000, 6)
  })

  it('подпись над рамкой, у верхнего края — внутри; по ширине не выходит за кадр', () => {
    const style = overlayStyle(10)
    const [top] = layoutOverlay([{ x: 0.5, y: 0, w: 0.1, h: 0.1 }], size, style, label)
    expect(top.label.y).toBe(0)
    const [mid] = layoutOverlay([{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], size, style, label)
    expect(mid.label.y).toBe(2500 - style.labelHeight)
    expect(mid.label.textY).toBe(mid.label.y + style.labelHeight / 2)
    const [right] = layoutOverlay([{ x: 0.99, y: 0.5, w: 0.01, h: 0.1 }], size, style, label)
    expect(right.label.x + right.label.width).toBeLessThanOrEqual(8000)
    expect(right.label.width).toBeCloseTo(labelWidth('Трещина 0,87', style.fontSize) + 2 * style.labelPadX, 6)
  })

  it('маленькие рамки рисуются позже больших: по ним можно кликнуть', () => {
    const laid = layoutOverlay(
      [
        { id: 'small', x: 0.3, y: 0.3, w: 0.01, h: 0.01 },
        { id: 'big', x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
      ],
      size,
      overlayStyle(1),
      label,
    )
    expect(laid.map((l) => l.item.id)).toEqual(['big', 'small'])
  })

  it('толщина линий и шрифт растут вместе с числом пикселей оригинала на пиксель экрана', () => {
    expect(overlayStyle(10)).toEqual({ strokeWidth: 20, selectedStrokeWidth: 40, fontSize: 120, labelPadX: 40, labelHeight: 180 })
    expect(overlayStyle(0).strokeWidth).toBe(2)
  })
})

describe('вписывание и приближение', () => {
  const box = { width: 800, height: 600 }

  it('масштаб object-contain', () => {
    expect(fitScale(size, box)).toBe(0.1)
    expect(fitScale({ width: 0, height: 10 }, box)).toBe(0)
  })

  it('центр рамки оказывается в центре области', () => {
    const b = { x: 0.5, y: 0.5, w: 0.01, h: 0.01 }
    const z = zoomToBox(b, size, box)
    // Снимок 800×500 в области 800×600: сверху и снизу поля по 50 px
    const cx = (0.505 * 800) * z.scale + z.tx
    const cy = (50 + 0.505 * 500) * z.scale + z.ty
    expect(cx).toBeCloseTo(400, 6)
    expect(cy).toBeCloseTo(300, 6)
    expect(z.scale).toBeGreaterThan(1)
  })

  it('не крупнее 4 экранных пикселей на пиксель оригинала', () => {
    const z = zoomToBox({ x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 }, size, box)
    expect(z.scale * fitScale(size, box)).toBeCloseTo(4, 6)
  })

  it('у края кадра снимок не отъезжает от края области', () => {
    const z = zoomToBox({ x: 0, y: 0.45, w: 0.02, h: 0.1 }, size, box)
    expect(z.scale).toBeGreaterThan(1)
    // Левый край снимка остаётся у левого края области
    expect(z.tx).toBeCloseTo(0, 6)
  })

  it('крупная рамка — без приближения, снимок по центру', () => {
    expect(zoomToBox({ x: 0, y: 0, w: 1, h: 1 }, size, box)).toEqual({ scale: 1, tx: 0, ty: 0 })
    expect(zoomToBox({ x: 0, y: 0, w: 1, h: 1 }, size, { width: 0, height: 0 })).toBe(NO_ZOOM)
  })
})

describe('PNG для выгрузки', () => {
  it('не больше 4096 по большей стороне, пропорции сохраняются', () => {
    expect(exportSize({ width: 8192, height: 5460 })).toEqual({ width: 4096, height: 2730 })
    expect(exportSize({ width: 3000, height: 4000 })).toEqual({ width: 3000, height: 4000 })
    expect(exportSize({ width: 2000, height: 9000 })).toEqual({ width: 910, height: 4096 })
  })

  it('линии в PNG — как на экране шириной 1600 px', () => {
    expect(exportUnitsPerPx({ width: 4096, height: 2730 })).toBeCloseTo(2.56, 6)
    expect(exportUnitsPerPx({ width: 800, height: 600 })).toBe(1)
  })
})
