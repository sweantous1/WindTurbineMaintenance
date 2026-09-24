import { describe, expect, it } from 'vitest'
import { DEFAULT_DRONE_PROFILE } from '@/domain/defaults'
import { DRONE_FIELD_RANGES, DRONE_NUMERIC_FIELDS, droneToForm, validateDroneForm, type DroneFormValues } from '../droneProfileForm'

const { id: _id, ...base } = DEFAULT_DRONE_PROFILE
void _id
const form = (patch: Partial<DroneFormValues> = {}): DroneFormValues => ({ ...droneToForm(base), ...patch })

describe('форма профиля дрона', () => {
  it('профиль по умолчанию проходит проверку без изменений', () => {
    expect(validateDroneForm(form())).toEqual({ ok: true, profile: base })
  })

  it('дробные через запятую, лишние пробелы в названии схлопываются', () => {
    const result = validateDroneForm(form({ name: '  Mavic   3E ', maxWindMs: '11,5', cruiseSpeedMs: ' 9.5 ' }))
    expect(result).toEqual({ ok: true, profile: { ...base, name: 'Mavic 3E', maxWindMs: 11.5, cruiseSpeedMs: 9.5 } })
  })

  it('пустое название и пустые поля', () => {
    const result = validateDroneForm(form({ name: '   ', enduranceMin: '' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.name?.key).toBe('settings.errors.nameRequired')
    expect(result.errors.enduranceMin?.key).toBe('settings.errors.required')
  })

  it('слишком длинное название', () => {
    const result = validateDroneForm(form({ name: 'x'.repeat(81) }))
    expect(!result.ok && result.errors.name).toEqual({ key: 'settings.errors.nameTooLong', params: { max: 80 } })
  })

  it('не число и вне диапазона — с границами для подсказки', () => {
    const result = validateDroneForm(form({ maxWindMs: 'двенадцать', reservePct: '100', maxAltitudeM: '5' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.maxWindMs?.key).toBe('settings.errors.notNumber')
    expect(result.errors.reservePct).toEqual({ key: 'settings.errors.range', params: DRONE_FIELD_RANGES.reservePct })
    expect(result.errors.maxAltitudeM).toEqual({ key: 'settings.errors.range', params: DRONE_FIELD_RANGES.maxAltitudeM })
  })

  it('резерв 100% и нулевые скорость или время полёта недопустимы: оценка заряда потеряла бы смысл', () => {
    for (const [field, value] of [
      ['reservePct', '100'],
      ['cruiseSpeedMs', '0'],
      ['enduranceMin', '0'],
    ] as const) {
      expect(validateDroneForm(form({ [field]: value })).ok).toBe(false)
    }
    expect(validateDroneForm(form({ reservePct: '0' })).ok).toBe(true)
  })

  it('лимит порывов не ниже лимита ветра', () => {
    const result = validateDroneForm(form({ maxWindMs: '14', maxGustMs: '12' }))
    expect(!result.ok && result.errors.maxGustMs?.key).toBe('settings.errors.gustBelowWind')
    expect(validateDroneForm(form({ maxWindMs: '12', maxGustMs: '12' })).ok).toBe(true)
  })

  it('у каждого числового поля есть диапазон', () => {
    for (const f of DRONE_NUMERIC_FIELDS) {
      const range = DRONE_FIELD_RANGES[f]
      expect(range.min).toBeLessThan(range.max)
      const value = String(DEFAULT_DRONE_PROFILE[f])
      expect(validateDroneForm(form({ [f]: value })).ok).toBe(true)
    }
  })
})
