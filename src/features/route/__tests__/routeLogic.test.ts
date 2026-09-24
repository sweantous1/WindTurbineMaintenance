import { describe, expect, it } from 'vitest'
import { solveRoute } from '@/domain/route'
import { buildFlightPlan } from '@/domain/flightPlan'
import { haversineM } from '@/lib/geo'
import {
  altitudePatch,
  cleanOrder,
  countOrderTurnViolations,
  effectiveTakeoff,
  farmEditPatch,
  lengthDrifted,
  moveIdInOrder,
  moveInOrder,
  orderFromVisit,
  orderPatch,
  planFor,
  recomputeRoute,
  routeContext,
  routeFromSolve,
  solveSignature,
  takeoffPatch,
  toSolvePoints,
  type OptimizerSettings,
  type RouteContext,
} from '../routeLogic'
import { moveTurbine, removeTurbine } from '../farmEdit'
import { at, lineFarm, makeFarm, makeRoute, type MissionFields } from './helpers'

const CEILING_M = 120

function ctxOf(farm = lineFarm(5), takeoff = at(-300, 0), flightAltitudeM = 90): RouteContext {
  return { farm, takeoff, flightAltitudeM, maxAltitudeM: CEILING_M }
}

const AUTO: OptimizerSettings = { algorithm: 'auto', params: { seed: 1 }, thetaMaxDeg: 180, returnToTakeoff: false }

describe('точки для решателя', () => {
  it('взлёт первым, затем турбины в порядке фермы, в метрах от центра фермы', () => {
    const farm = lineFarm(3)
    const pts = toSolvePoints(farm, farm.center)
    expect(pts).toHaveLength(4)
    expect(pts[0].x).toBeCloseTo(0, 6)
    expect(pts[0].y).toBeCloseTo(0, 6)
    // Ряд 0, 400, 800 м — центр на 400 м
    expect(pts[1].x).toBeCloseTo(-400, 0)
    expect(pts[2].x).toBeCloseTo(0, 0)
    expect(pts[3].x).toBeCloseTo(400, 0)
    for (const p of pts) expect(Math.abs(p.y)).toBeLessThan(0.5)
  })

  it('индексы решателя 1..n превращаются в id турбин', () => {
    const farm = lineFarm(3)
    expect(orderFromVisit(farm, [3, 1, 2])).toEqual(['t3', 't1', 't2'])
  })

  it('неверный индекс или повтор — ошибка, а не молча испорченный порядок', () => {
    const farm = lineFarm(3)
    expect(() => orderFromVisit(farm, [0, 1, 2])).toThrow()
    expect(() => orderFromVisit(farm, [1, 2, 4])).toThrow()
    expect(() => orderFromVisit(farm, [1, 1, 2])).toThrow()
    expect(() => orderFromVisit(farm, [1.5])).toThrow()
  })
})

describe('порядок облёта', () => {
  it('cleanOrder убирает неизвестные id и повторы, сохраняя порядок', () => {
    const farm = lineFarm(3)
    expect(cleanOrder(farm, ['t2', 'x', 't1', 't2', 't3'])).toEqual(['t2', 't1', 't3'])
  })

  it('moveInOrder двигает на соседнюю позицию, за краями ничего не меняет', () => {
    const order = ['a', 'b', 'c', 'd']
    expect(moveInOrder(order, 2, -1)).toEqual(['a', 'c', 'b', 'd'])
    expect(moveInOrder(order, 0, 1)).toEqual(['b', 'a', 'c', 'd'])
    expect(moveInOrder(order, 0, -1)).toEqual(order)
    expect(moveInOrder(order, 3, 1)).toEqual(order)
    expect(moveInOrder(order, 7, -1)).toEqual(order)
    // Исходный массив не меняется
    expect(order).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moveIdInOrder двигает турбину по id: два быстрых нажатия подряд сдвигают её дважды', () => {
    const once = moveIdInOrder(['a', 'b', 'c'], 'a', 1)
    expect(once).toEqual(['b', 'a', 'c'])
    expect(moveIdInOrder(once, 'a', 1)).toEqual(['b', 'c', 'a'])
    // Неизвестный id и край списка — без изменений
    expect(moveIdInOrder(['a', 'b'], 'x', 1)).toEqual(['a', 'b'])
    expect(moveIdInOrder(['a', 'b'], 'b', 1)).toEqual(['a', 'b'])
  })

  it('взлёт по умолчанию — центр фермы', () => {
    const farm = lineFarm(2)
    expect(effectiveTakeoff({ farm })).toBe(farm.center)
    const takeoff = at(-100, 0)
    expect(effectiveTakeoff({ farm, takeoff })).toBe(takeoff)
    expect(effectiveTakeoff({})).toBeUndefined()
    expect(routeContext({ flightAltitudeM: 90 }, CEILING_M)).toBeUndefined()
  })
})

describe('сборка RoutePlan из результата решателя', () => {
  it('ряд турбин без возврата облетается по порядку; длина — длина плана полёта', () => {
    const ctx = ctxOf()
    const result = solveRoute({
      points: toSolvePoints(ctx.farm, ctx.takeoff),
      closed: false,
      algorithm: 'auto',
      params: AUTO.params,
      thetaMaxDeg: 180,
    })
    const { route, plan } = routeFromSolve(ctx, result, AUTO, '2026-09-24T12:00:00.000Z')
    expect(route.order).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(route.source).toBe('auto')
    expect(route.algorithm).toBe('auto')
    expect(route.returnToTakeoff).toBe(false)
    expect(route.computedAt).toBe('2026-09-24T12:00:00.000Z')
    expect(route.turnViolations).toBe(result.turnViolations)
    // Длина — всего плана с облётами и подъёмами, она больше ломаной решателя
    expect(route.lengthM).toBe(plan.lengthM)
    expect(route.lengthM).toBeGreaterThan(result.lengthM)
    const direct = buildFlightPlan({
      farm: ctx.farm,
      takeoff: ctx.takeoff,
      order: route.order,
      flightAltitudeM: 90,
      maxAltitudeM: CEILING_M,
      returnToTakeoff: false,
    })
    expect(route.lengthM).toBeCloseTo(direct.lengthM, 9)
    // Параметры копируются, а не делятся ссылкой с черновиком формы
    expect(route.params).toEqual(AUTO.params)
    expect(route.params).not.toBe(AUTO.params)
  })

  it('с ACO и GA получается перестановка всех турбин', () => {
    const farm = makeFarm([
      [0, 0],
      [500, 100],
      [900, -200],
      [300, 600],
      [-400, 300],
      [700, 700],
    ])
    const ctx = ctxOf(farm, farm.center)
    for (const algorithm of ['aco', 'ga'] as const) {
      const settings: OptimizerSettings = { algorithm, params: { iterations: 20, generations: 20, seed: 3 }, thetaMaxDeg: 180, returnToTakeoff: true }
      const result = solveRoute({ points: toSolvePoints(farm, ctx.takeoff), closed: true, algorithm, params: settings.params, thetaMaxDeg: 180 })
      const { route } = routeFromSolve(ctx, result, settings, 'now')
      expect([...route.order].sort()).toEqual(farm.turbines.map((t) => t.id).sort())
      expect(route.algorithm).toBe(algorithm)
      expect(route.returnToTakeoff).toBe(true)
    }
  })
})

describe('нарушения угла для ручного порядка', () => {
  const grid = makeFarm([
    [0, 0],
    [400, 30],
    [800, -20],
    [10, 420],
    [390, 400],
    [810, 380],
    [-20, 800],
    [420, 810],
    [790, 790],
  ])

  it('совпадают с тем, что насчитал решатель для его порядка', () => {
    const takeoff = at(-300, -300)
    for (const closed of [false, true]) {
      for (const theta of [45, 90, 120]) {
        const result = solveRoute({ points: toSolvePoints(grid, takeoff), closed, algorithm: 'auto', params: { seed: 7 }, thetaMaxDeg: theta })
        const order = orderFromVisit(grid, result.visit)
        expect(countOrderTurnViolations({ farm: grid, takeoff }, order, closed, theta)).toBe(result.turnViolations)
      }
    }
  })

  it('без ограничения угла нарушений нет, зигзаг при 45° — есть', () => {
    const farm = lineFarm(4)
    const takeoff = at(-300, 0)
    const zigzag = ['t4', 't1', 't3', 't2']
    expect(countOrderTurnViolations({ farm, takeoff }, zigzag, false, 180)).toBe(0)
    // Разворот на 180° в t4, t1 и t3
    expect(countOrderTurnViolations({ farm, takeoff }, zigzag, false, 45)).toBe(3)
    // По ряду — прямо, ни одного поворота
    expect(countOrderTurnViolations({ farm, takeoff }, ['t1', 't2', 't3', 't4'], false, 45)).toBe(0)
    expect(countOrderTurnViolations({ farm, takeoff }, [], false, 45)).toBe(0)
  })
})

describe('пересчёт после правки', () => {
  const ctx = ctxOf()
  const route = makeRoute(['t1', 't2', 't3', 't4', 't5'], { returnToTakeoff: false, thetaMaxDeg: 90 })

  it('порядок сохраняется, длина — по новому плану, маршрут помечается изменённым', () => {
    const farm = moveTurbine(ctx.farm, 't3', at(800, 500))
    const next = recomputeRoute(route, { ...ctx, farm }, { edited: true })
    expect(next?.order).toEqual(route.order)
    expect(next?.source).toBe('edited')
    expect(next?.lengthM).toBeCloseTo(planFor({ ...ctx, farm }, route.order, false).lengthM, 9)
    expect(next?.lengthM).toBeGreaterThan(planFor(ctx, route.order, false).lengthM)
    // Время расчёта остаётся временем автоматического расчёта
    expect(next?.computedAt).toBe(route.computedAt)
    // Турбина ушла в сторону — на ней появились повороты круче 90°
    expect(next?.turnViolations).toBeGreaterThan(0)
  })

  it('удалённая турбина выпадает из порядка, без турбин маршрута нет', () => {
    const farm = removeTurbine(ctx.farm, 't2')
    expect(recomputeRoute(route, { ...ctx, farm }, { edited: true })?.order).toEqual(['t1', 't3', 't4', 't5'])
    const empty = ['t1', 't2', 't3', 't4', 't5'].reduce((f, id) => removeTurbine(f, id), ctx.farm)
    expect(recomputeRoute(route, { ...ctx, farm: empty }, { edited: true })).toBeUndefined()
  })

  it('edited = false сохраняет источник', () => {
    expect(recomputeRoute(route, ctx, { edited: false })?.source).toBe('auto')
  })
})

describe('патчи миссии', () => {
  const farm = lineFarm(4)
  const takeoff = at(-300, 0)
  const base: MissionFields = { farm, takeoff, flightAltitudeM: 90 }
  const route = makeRoute(['t1', 't2', 't3', 't4'], { lengthM: planFor(ctxOf(farm, takeoff), ['t1', 't2', 't3', 't4'], true).lengthM })

  it('правка фермы без маршрута не трогает маршрут', () => {
    const next = moveTurbine(farm, 't1', at(10, 10))
    const patch = farmEditPatch(base, next, CEILING_M)
    expect(patch).toEqual({ farm: next })
    expect('route' in patch).toBe(false)
  })

  it('правка фермы с маршрутом пересчитывает его, удаление всех турбин маршрута сбрасывает его', () => {
    const next = removeTurbine(farm, 't4')
    const patch = farmEditPatch({ ...base, route }, next, CEILING_M)
    expect(patch.farm).toBe(next)
    expect(patch.route?.order).toEqual(['t1', 't2', 't3'])
    expect(patch.route?.source).toBe('edited')

    const onlyT1 = makeRoute(['t1'])
    const cleared = farmEditPatch({ ...base, route: onlyT1 }, removeTurbine(farm, 't1'), CEILING_M)
    // Ключ есть и равен undefined — missions.update поймёт это как «очистить маршрут»
    expect('route' in cleared).toBe(true)
    expect(cleared.route).toBeUndefined()
  })

  it('перенос взлёта сохраняет точку и помечает маршрут изменённым', () => {
    const moved = at(2000, 0)
    const patch = takeoffPatch({ ...base, route }, moved, CEILING_M)
    expect(patch.takeoff).toBe(moved)
    expect(patch.route?.source).toBe('edited')
    expect(patch.route?.lengthM).toBeCloseTo(planFor(ctxOf(farm, moved), route.order, true).lengthM, 9)
    expect(takeoffPatch(base, moved, CEILING_M)).toEqual({ takeoff: moved })
  })

  it('высота меняет длину, но не источник маршрута', () => {
    const patch = altitudePatch({ ...base, route }, 60, CEILING_M)
    expect(patch.flightAltitudeM).toBe(60)
    expect(patch.route?.source).toBe('auto')
    // Подъём и спуск на 30 м короче с каждой стороны, плюс подъёмы от транзита к ступице длиннее
    expect(patch.route?.lengthM).toBeCloseTo(planFor(ctxOf(farm, takeoff, 60), route.order, true).lengthM, 9)
    expect(patch.route?.lengthM).not.toBeCloseTo(route.lengthM, 3)
  })

  it('высота выше потолка — транзит прижат к потолку', () => {
    const high = altitudePatch({ ...base, route }, 500, CEILING_M)
    const atCeiling = altitudePatch({ ...base, route }, CEILING_M, CEILING_M)
    expect(high.route?.lengthM).toBeCloseTo(atCeiling.route?.lengthM ?? NaN, 9)
  })

  it('перестановка порядка', () => {
    const patch = orderPatch({ ...base, route: { ...route, thetaMaxDeg: 45 } }, ['t2', 't1', 't3', 't4'], CEILING_M)
    expect(patch.route?.order).toEqual(['t2', 't1', 't3', 't4'])
    expect(patch.route?.source).toBe('edited')
    // Разворот в t2 и в t1
    expect(patch.route?.turnViolations).toBeGreaterThanOrEqual(2)
    expect(Object.keys(patch)).toEqual(['route'])
    expect(orderPatch(base, ['t1'], CEILING_M)).toEqual({})
  })

  it('lengthDrifted замечает устаревшую длину', () => {
    const plan = planFor(ctxOf(farm, takeoff), route.order, true)
    expect(lengthDrifted(route, plan)).toBe(false)
    expect(lengthDrifted({ ...route, lengthM: route.lengthM + 5 }, plan)).toBe(true)
  })
})

describe('отпечаток входа решателя', () => {
  it('меняется при сдвиге турбины и взлёта, но не от параметров фермы', () => {
    const farm = lineFarm(3)
    const takeoff = at(-300, 0)
    const sig = solveSignature(farm, takeoff)
    expect(solveSignature({ ...farm, defaults: { ...farm.defaults, hubHeightM: 150 } }, takeoff)).toBe(sig)
    expect(solveSignature(moveTurbine(farm, 't2', at(400, 3)), takeoff)).not.toBe(sig)
    expect(solveSignature(farm, at(-301, 0))).not.toBe(sig)
    expect(haversineM(at(-301, 0), takeoff)).toBeCloseTo(1, 1)
  })
})
