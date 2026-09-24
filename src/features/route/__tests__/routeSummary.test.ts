// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import i18n from '@/i18n'
import { DEFAULT_DRONE_PROFILE } from '@/domain/defaults'
import { cleanup, render } from '@/features/mission/__tests__/render'
import RouteSummary from '../RouteSummary'
import { planFor } from '../routeLogic'
import { at, lineFarm, makeFarm, makeRoute } from './helpers'

beforeAll(async () => {
  await i18n.changeLanguage('ru')
})

afterEach(async () => {
  await cleanup()
})

describe('сводка маршрута: конфликты', () => {
  it('облёт, задевший соседнюю турбину, назван облётом, а не «T1 → T1», и с отдельной подсказкой', async () => {
    // T1 и T3 в 140 м: облёт T1 на высоте ступицы проходит сквозь зону ротора T3
    const farm = makeFarm([
      [0, 0],
      [600, 600],
      [140, 0],
      [700, -300],
    ])
    const order = ['t1', 't2', 't3', 't4']
    const plan = planFor({ farm, takeoff: at(-600, 0), flightAltitudeM: 90, maxAltitudeM: 120 }, order, true)
    await render(
      createElement(RouteSummary, {
        farm,
        route: makeRoute(order, { lengthM: plan.lengthM }),
        plan,
        drone: DEFAULT_DRONE_PROFILE,
        flightAltitudeM: 90,
        ceilingM: 120,
      }),
    )
    const text = document.body.textContent ?? ''
    expect(text).toContain('Облёт T1: проходит в')
    expect(text).not.toContain('T1 → T1')
    expect(text).toContain('Облёт задевает соседнюю турбину')
  })

  it('без конфликтов на облётах подсказки про облёт нет', async () => {
    const farm = lineFarm(4)
    const order = ['t4', 't3', 't2', 't1']
    // Перелёт взлёт → дальняя турбина идёт над рядом: конфликты только на транзите
    const plan = planFor({ farm, takeoff: at(-300, 0), flightAltitudeM: 90, maxAltitudeM: 120 }, order, false)
    expect(plan.conflicts.length).toBeGreaterThan(0)
    await render(
      createElement(RouteSummary, {
        farm,
        route: makeRoute(order, { lengthM: plan.lengthM, returnToTakeoff: false }),
        plan,
        drone: DEFAULT_DRONE_PROFILE,
        flightAltitudeM: 90,
        ceilingM: 120,
      }),
    )
    const text = document.body.textContent ?? ''
    expect(text).toContain('Перенесите точку взлёта')
    expect(text).not.toContain('Облёт задевает соседнюю турбину')
  })
})
