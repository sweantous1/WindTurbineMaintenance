import { describe, expect, it } from 'vitest'
import { canEdit, derivePreFlightStatus, lockedFields, missionSteps } from '../missionStatus'

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
})
