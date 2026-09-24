import { describe, expect, it } from 'vitest'
import { createRouteModel, pathCost, pathFromVisit, visitCost, visitLengthM } from '../matrix'
import { mulberry32, shuffleInPlace } from '../random'
import { countTurnViolations, turnAngleDeg } from '../turns'

const P = (x: number, y: number) => ({ x, y })

describe('угол поворота', () => {
  it('отклонение от прямой: 0 — прямо, 90 — под прямым углом, 180 — разворот', () => {
    expect(turnAngleDeg(P(0, 0), P(1, 0), P(2, 0))).toBeCloseTo(0, 9)
    expect(turnAngleDeg(P(0, 0), P(1, 0), P(1, 5))).toBeCloseTo(90, 9)
    expect(turnAngleDeg(P(0, 0), P(1, 0), P(1, -5))).toBeCloseTo(90, 9)
    expect(turnAngleDeg(P(0, 0), P(1, 0), P(0, 0))).toBeCloseTo(180, 9)
    expect(turnAngleDeg(P(0, 0), P(10, 0), P(20, 10))).toBeCloseTo(45, 9)
  })

  it('у отрезка нулевой длины поворота нет', () => {
    expect(turnAngleDeg(P(0, 0), P(0, 0), P(5, 5))).toBe(0)
    expect(turnAngleDeg(P(0, 0), P(5, 5), P(5, 5))).toBe(0)
  })

  it('нарушения считаются только во внутренних вершинах; поворот ровно на предел — не нарушение', () => {
    // Взлёт (0,0) → (100,0) → (100,100) → (0,100) → обратно на взлёт: четыре прямых угла,
    // но в точке взлёта поворот не считается
    const pts = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)]
    const closed = createRouteModel(pts, true, 60)
    expect(countTurnViolations(closed, [1, 2, 3])).toBe(3)
    expect(countTurnViolations(createRouteModel(pts, false, 60), [1, 2, 3])).toBe(2)
    expect(countTurnViolations(createRouteModel(pts, true, 90), [1, 2, 3])).toBe(0)
    expect(countTurnViolations(createRouteModel(pts, true, 180), [1, 2, 3])).toBe(0)
  })

  // Модель считает повороты через скалярные произведения (таблица при ≤ 65 точках, на лету —
  // при большем числе); сверяем с независимым подсчётом через atan2 по тем же вершинам
  it.each([
    [30, 120],
    [30, 45],
    [80, 90],
    [80, 20],
  ])('нарушения и штрафы совпадают с подсчётом углов напрямую (%s точек, θmax=%s°)', (count, theta) => {
    const rng = mulberry32(count * 1000 + theta)
    const pts = Array.from({ length: count }, () => P(rng() * 1000, rng() * 1000))
    let maxDist = 0
    for (const a of pts) for (const b of pts) maxDist = Math.max(maxDist, Math.hypot(a.x - b.x, a.y - b.y))
    for (const closed of [false, true]) {
      const model = createRouteModel(pts, closed, theta)
      const visit = shuffleInPlace(Int32Array.from({ length: count - 1 }, (_, k) => k + 1), rng)
      const route = [0, ...visit, ...(closed ? [0] : [])]
      let violations = 0
      let penalty = 0
      for (let q = 1; q < route.length - 1; q++) {
        const angle = turnAngleDeg(pts[route[q - 1]], pts[route[q]], pts[route[q + 1]])
        if (angle > theta) {
          violations++
          penalty += maxDist * (1 + (angle - theta) / 180)
        }
      }
      expect(violations).toBeGreaterThan(0)
      expect(countTurnViolations(model, visit)).toBe(violations)
      expect(visitCost(model, visit)).toBeCloseTo(visitLengthM(model, visit) + penalty, 6)
    }
  })

  it('стоимость = длина + штрафы, и две формы записи маршрута дают одно и то же', () => {
    const rng = mulberry32(7)
    for (const closed of [false, true]) {
      for (const theta of [180, 120, 45]) {
        const pts = Array.from({ length: 9 }, () => P(rng() * 1000, rng() * 1000))
        const model = createRouteModel(pts, closed, theta)
        const visit = shuffleInPlace(Int32Array.from({ length: 8 }, (_, k) => k + 1), rng)
        const cost = visitCost(model, visit)
        expect(pathCost(model, pathFromVisit(model, visit))).toBeCloseTo(cost, 6)
        expect(cost).toBeGreaterThanOrEqual(visitLengthM(model, visit) - 1e-9)
        if (theta === 180) expect(cost).toBeCloseTo(visitLengthM(model, visit), 9)
        if (countTurnViolations(model, visit) > 0) expect(cost).toBeGreaterThan(visitLengthM(model, visit))
      }
    }
  })
})
