import { describe, expect, it } from 'vitest'
import type { Farm } from '@/domain/types'
import { offsetGeo } from '@/lib/geo'
import { GPS_MATCH_RADIUS_M, gpsAssignments, nearestTurbine, sortedTurbines, turbineRef } from '../turbineMatch'
import { photo } from './helpers'

const BASE = { lat: 47.5, lon: 39.7 }
const at = (east: number, north: number) => offsetGeo(BASE, east, north)

const farm: Farm = {
  center: BASE,
  defaults: { hubHeightM: 100, rotorDiameterM: 120, safeDistanceM: 30 },
  turbines: [
    { id: 't1', name: 'T1', ...at(0, 0) },
    { id: 't2', name: 'T2', ...at(500, 0) },
    { id: 't10', name: 'T10', ...at(1000, 0) },
  ],
}

describe('турбина по GPS', () => {
  it('выбирает ближайшую турбину в пределах 300 м', () => {
    const s = nearestTurbine(at(420, 30), farm.turbines)
    expect(s?.turbine.id).toBe('t2')
    expect(s?.distanceM).toBeCloseTo(Math.hypot(80, 30), 0)
  })

  it('дальше 300 м — подсказки нет', () => {
    expect(nearestTurbine(at(0, GPS_MATCH_RADIUS_M + 5), farm.turbines)).toBeUndefined()
    expect(nearestTurbine(at(0, GPS_MATCH_RADIUS_M - 5), farm.turbines)?.turbine.id).toBe('t1')
  })

  it('без GPS, без фермы или с битой точкой — подсказки нет', () => {
    expect(nearestTurbine(undefined, farm.turbines)).toBeUndefined()
    expect(nearestTurbine(at(0, 0), undefined)).toBeUndefined()
    expect(nearestTurbine(at(0, 0), [])).toBeUndefined()
    expect(nearestTurbine({ lat: Number.NaN, lon: 0 }, farm.turbines)).toBeUndefined()
  })

  it('массовое назначение не трогает фото, где турбину уже выбрали', () => {
    const photos = [
      photo('a', { gps: at(10, 10) }),
      photo('b', { gps: at(990, 0), turbineId: 't1' }),
      photo('c', { gps: at(1005, 0) }),
      photo('d'),
      photo('e', { gps: at(260, 0) }),
    ]
    expect(gpsAssignments(photos, farm).map((a) => [a.photoId, a.turbineId])).toEqual([
      ['a', 't1'],
      ['c', 't10'],
      ['e', 't2'],
    ])
    expect(gpsAssignments(photos, undefined)).toEqual([])
  })

  it('состояние турбины фото: выбрана, удалена, подсказана, нет', () => {
    expect(turbineRef(photo('a', { turbineId: 't2' }), farm)).toMatchObject({ kind: 'assigned', turbine: { name: 'T2' } })
    expect(turbineRef(photo('a', { turbineId: 'gone' }), farm)).toEqual({ kind: 'missing', turbineId: 'gone' })
    expect(turbineRef(photo('a', { gps: at(5, 5) }), farm)).toMatchObject({ kind: 'suggested', suggestion: { turbine: { id: 't1' } } })
    expect(turbineRef(photo('a'), farm)).toEqual({ kind: 'none' })
  })

  it('турбины в списке идут по номеру: T2 раньше T10', () => {
    expect(sortedTurbines([...farm.turbines].reverse()).map((tb) => tb.name)).toEqual(['T1', 'T2', 'T10'])
  })
})
