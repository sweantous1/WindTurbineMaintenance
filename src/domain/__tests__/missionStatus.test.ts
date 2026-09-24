import { describe, expect, it } from 'vitest'
import { canEdit, derivePreFlightStatus, lockedFields, missionSteps } from '../missionStatus'
import type { Mission, MissionStatus } from '../types'

describe('статусы миссии', () => {
  it('до полёта статус следует из данных', () => {
    expect(derivePreFlightStatus({})).toBe('draft')
    const route = { order: ['a'] } as never
    expect(derivePreFlightStatus({ route })).toBe('planned')
    expect(derivePreFlightStatus({ route, weather: {} as never })).toBe('planned')
    expect(derivePreFlightStatus({ route, weather: {} as never, departureTime: 'x' })).toBe('ready')
  })

  it('после полёта правятся только заметки и название', () => {
    expect(canEdit('ready', 'weather')).toBe(true)
    expect(canEdit('flown', 'weather')).toBe(false)
    expect(canEdit('flown', 'notes')).toBe(true)
    expect(canEdit('archived', 'notes')).toBe(false)
    expect(lockedFields('analyzed', { notes: 'x', route: undefined, farm: undefined })).toEqual(['route', 'farm'])
  })

  it('шаги сценария без миссии все не выполнены', () => {
    expect(missionSteps(undefined).every((s) => !s.done)).toBe(true)
  })

  it('3D-облёт — по желанию и позади после полёта; поиск дефектов — обычный шаг', () => {
    const step = (status: MissionStatus, key: string) =>
      missionSteps({ status, route: { order: ['a'] } } as unknown as Mission).find((s) => s.key === key)
    expect(step('ready', 'simulation')).toEqual({ key: 'simulation', done: false, optional: true })
    expect(step('flown', 'simulation')).toEqual({ key: 'simulation', done: true, optional: true })
    expect(step('flown', 'detection')).toEqual({ key: 'detection', done: false })
    expect(step('analyzed', 'detection')).toEqual({ key: 'detection', done: true })
    // Необязательный шаг один — остальные текущими становятся по порядку
    expect(missionSteps(undefined).filter((s) => s.optional).map((s) => s.key)).toEqual(['simulation'])
  })
})
