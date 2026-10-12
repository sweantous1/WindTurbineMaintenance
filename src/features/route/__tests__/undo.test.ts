import { describe, expect, it } from 'vitest'
import { farmEditPatch } from '../routeLogic'
import { moveTurbine, removeTurbine } from '../farmEdit'
import { stateAfter, undoPatch } from '../undo'
import { at, lineFarm, makeRoute, type MissionFields } from './helpers'

const CEILING_M = 120

// Данные из IndexedDB приходят копией, а не теми же объектами
const roundTrip = <T>(v: T): T => structuredClone(v)

describe('отмена переноса и удаления турбины', () => {
  const farm = { ...lineFarm(3), turbines: lineFarm(3).turbines.map((t) => ({ ...t, groundAltM: 150 })) }
  const route = makeRoute(['t1', 't2', 't3'])
  const base: MissionFields = { farm, takeoff: at(-300, 0), route, flightAltitudeM: 90 }

  it('возвращает ферму с высотой рельефа и маршрут как были', () => {
    const patch = farmEditPatch(base, moveTurbine(farm, 't2', at(400, 300)), CEILING_M)
    const after = stateAfter(base, patch)
    expect(after.farm?.turbines[1].groundAltM).toBeUndefined()
    expect(after.route?.source).toBe('edited')

    const current = roundTrip({ farm: after.farm, route: after.route })
    const undo = undoPatch(current, { farm, route }, after)
    expect(undo).toEqual({ farm, route })
    expect(undo?.farm?.turbines[1].groundAltM).toBe(150)
  })

  it('маршрут, сброшенный удалением последней турбины, возвращается', () => {
    const one: MissionFields = { ...base, route: makeRoute(['t1']) }
    const patch = farmEditPatch(one, removeTurbine(farm, 't1'), CEILING_M)
    const after = stateAfter(one, patch)
    expect(after.route).toBeUndefined()
    const undo = undoPatch(roundTrip({ farm: after.farm }), { farm, route: one.route }, after)
    expect(undo?.route).toEqual(one.route)
  })

  it('без маршрута до правки отмена его и не создаёт', () => {
    const noRoute: MissionFields = { ...base, route: undefined }
    const patch = farmEditPatch(noRoute, removeTurbine(farm, 't3'), CEILING_M)
    const after = stateAfter(noRoute, patch)
    const undo = undoPatch(roundTrip({ farm: after.farm }), { farm }, after)
    expect(undo).not.toBeNull()
    expect('route' in (undo ?? {})).toBe(true)
    expect(undo?.route).toBeUndefined()
  })

  it('после других правок отменять нельзя: они бы потерялись', () => {
    const patch = farmEditPatch(base, moveTurbine(farm, 't2', at(400, 300)), CEILING_M)
    const after = stateAfter(base, patch)
    const later = { farm: moveTurbine(after.farm ?? farm, 't3', at(900, 50)), route: after.route }
    expect(undoPatch(later, { farm, route }, after)).toBeNull()
    const reordered = { farm: after.farm, route: after.route && { ...after.route, order: ['t2', 't1', 't3'] } }
    expect(undoPatch(reordered, { farm, route }, after)).toBeNull()
  })
})
