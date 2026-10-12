import { describe, expect, it } from 'vitest'
import { fromLetterbox, letterbox, rgbaToChw, toLetterbox, LETTERBOX_FILL, type Box } from '../letterbox'

// Детерминированный rng для "случайных" размеров
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('letterbox', () => {
  it('квадратный фрагмент 640 — без масштаба и полей', () => {
    expect(letterbox(640, 640)).toEqual({ size: 640, srcW: 640, srcH: 640, scale: 1, newW: 640, newH: 640, padX: 0, padY: 0 })
  })

  it('кадр 1280×960 уменьшается вдвое, поля сверху и снизу по 80', () => {
    const lb = letterbox(1280, 960)
    expect(lb.scale).toBe(0.5)
    expect([lb.newW, lb.newH, lb.padX, lb.padY]).toEqual([640, 480, 0, 80])
  })

  it('маленький кадр увеличивается до входа, как в ultralytics', () => {
    const lb = letterbox(500, 300)
    expect(lb.scale).toBeCloseTo(1.28, 12)
    expect([lb.newW, lb.newH, lb.padX, lb.padY]).toEqual([640, 384, 0, 128])
  })

  it('нечётное поле: лишний пиксель уходит вправо (round(dw/2 − 0.1))', () => {
    const lb = letterbox(333, 517)
    expect(lb.newH).toBe(640)
    expect(lb.newW).toBe(412)
    expect(lb.padX).toBe(114)
    const odd = letterbox(641, 640)
    expect(odd.newH).toBe(639)
    expect(odd.padY).toBe(0)
  })

  it('туда и обратно — точнее 1 px и совпадает с scale_boxes ultralytics в пределах пикселя', () => {
    const rnd = lcg(7)
    for (let i = 0; i < 500; i++) {
      const srcW = 50 + Math.floor(rnd() * 1900)
      const srcH = 50 + Math.floor(rnd() * 1900)
      const lb = letterbox(srcW, srcH)
      const x1 = rnd() * srcW
      const y1 = rnd() * srcH
      const box: Box = { x1, y1, x2: x1 + rnd() * (srcW - x1), y2: y1 + rnd() * (srcH - y1) }
      const input = toLetterbox(lb, box)
      // Во входе рамка не вылезает за картинку
      expect(input.x1).toBeGreaterThanOrEqual(lb.padX - 1e-9)
      expect(input.x2).toBeLessThanOrEqual(lb.padX + lb.newW + 1e-9)
      expect(input.y2).toBeLessThanOrEqual(lb.padY + lb.newH + 1e-9)
      const back = fromLetterbox(lb, input)
      for (const k of ['x1', 'y1', 'x2', 'y2'] as const) {
        expect(Math.abs(back[k] - box[k])).toBeLessThan(1e-6)
      }
      // Расхождение с идеальным масштабом только из-за округления, меньше пикселя
      expect(Math.abs(input.x2 - input.x1 - (box.x2 - box.x1) * lb.scale)).toBeLessThan(1)
      expect(Math.abs(input.y2 - input.y1 - (box.y2 - box.y1) * lb.scale)).toBeLessThan(1)
    }
  })

  it('край области изображения во входе переводится точно в край фрагмента', () => {
    const lb = letterbox(1280, 960)
    expect(fromLetterbox(lb, { x1: lb.padX, y1: lb.padY, x2: lb.padX + lb.newW, y2: lb.padY + lb.newH })).toEqual({
      x1: 0,
      y1: 0,
      x2: 1280,
      y2: 960,
    })
    // Центр входа = центр кадра
    const c = fromLetterbox(lb, { x1: 320, y1: 320, x2: 320, y2: 320 })
    expect(c.x1).toBe(640)
    expect(c.y1).toBe(480)
  })

  it('RGBA → CHW 0..1 по плоскостям R, G, B; альфа отбрасывается', () => {
    const size = 2
    // 4 пикселя: красный, зелёный, синий, серый
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 114, 114, 114, 255])
    const chw = rgbaToChw(rgba, size)
    expect(Array.from(chw.subarray(0, 4))).toEqual([1, 0, 0, LETTERBOX_FILL].map(Math.fround))
    expect(Array.from(chw.subarray(4, 8))).toEqual([0, 1, 0, LETTERBOX_FILL].map(Math.fround))
    expect(Array.from(chw.subarray(8, 12))).toEqual([0, 0, 1, LETTERBOX_FILL].map(Math.fround))
    // Буфер подходящего размера переиспользуется
    const out = new Float32Array(12)
    expect(rgbaToChw(rgba, size, out)).toBe(out)
    expect(() => rgbaToChw(new Uint8ClampedArray(8), size)).toThrow(RangeError)
  })

  it('некорректные размеры — ошибка', () => {
    expect(() => letterbox(0, 10)).toThrow(RangeError)
    expect(() => letterbox(10, Number.NaN)).toThrow(RangeError)
  })
})
