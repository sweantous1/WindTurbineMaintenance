import type { DroneProfile } from '@/domain/types'
import { formatInputNumber } from '@/features/route/format'
import { parseDecimal } from './location'

// Форма профиля дрона для настроек. Лежит рядом с погодой: эти числа — лимиты,
// с которыми сравнивается прогноз, и основа оценки заряда

export type DroneNumericField = 'maxWindMs' | 'maxGustMs' | 'cruiseSpeedMs' | 'enduranceMin' | 'reservePct' | 'maxAltitudeM'

export const DRONE_NUMERIC_FIELDS: readonly DroneNumericField[] = [
  'maxWindMs',
  'maxGustMs',
  'cruiseSpeedMs',
  'enduranceMin',
  'reservePct',
  'maxAltitudeM',
]

// Границы правдоподобия, а не паспорт конкретного дрона: отсекают опечатки вроде 350 м/с.
// Резерв меньше 100%: иначе на полёт не остаётся заряда вовсе
export const DRONE_FIELD_RANGES: Record<DroneNumericField, { min: number; max: number }> = {
  maxWindMs: { min: 1, max: 40 },
  maxGustMs: { min: 1, max: 50 },
  cruiseSpeedMs: { min: 1, max: 40 },
  enduranceMin: { min: 1, max: 240 },
  reservePct: { min: 0, max: 90 },
  maxAltitudeM: { min: 10, max: 1000 },
}

export const MAX_DRONE_NAME_LENGTH = 80

export type DroneFormValues = { name: string } & Record<DroneNumericField, string>

export interface FieldError {
  key: string
  params?: Record<string, number>
}

export type DroneFormErrors = Partial<Record<'name' | DroneNumericField, FieldError>>

export type DroneFormResult =
  | { ok: true; profile: Omit<DroneProfile, 'id'> }
  | { ok: false; errors: DroneFormErrors }

// Дроби — с десятичным разделителем языка: в русском интерфейсе «12,5», как во всех полях
export function droneToForm(p: Omit<DroneProfile, 'id'>, lang: string): DroneFormValues {
  const num = (v: number) => formatInputNumber(v, lang)
  return {
    name: p.name,
    maxWindMs: num(p.maxWindMs),
    maxGustMs: num(p.maxGustMs),
    cruiseSpeedMs: num(p.cruiseSpeedMs),
    enduranceMin: num(p.enduranceMin),
    reservePct: num(p.reservePct),
    maxAltitudeM: num(p.maxAltitudeM),
  }
}

export function validateDroneForm(v: DroneFormValues): DroneFormResult {
  const errors: DroneFormErrors = {}
  const name = v.name.trim().replace(/\s+/g, ' ')
  if (name === '') errors.name = { key: 'settings.errors.nameRequired' }
  else if (name.length > MAX_DRONE_NAME_LENGTH) {
    errors.name = { key: 'settings.errors.nameTooLong', params: { max: MAX_DRONE_NAME_LENGTH } }
  }

  const numbers: Partial<Record<DroneNumericField, number>> = {}
  for (const field of DRONE_NUMERIC_FIELDS) {
    const text = v[field]
    const range = DRONE_FIELD_RANGES[field]
    const n = parseDecimal(text)
    if (text.trim() === '') errors[field] = { key: 'settings.errors.required' }
    else if (n === null) errors[field] = { key: 'settings.errors.notNumber' }
    else if (n < range.min || n > range.max) errors[field] = { key: 'settings.errors.range', params: range }
    else numbers[field] = n
  }

  // Порыв не бывает слабее среднего ветра: при таком лимите запрет по ветру не наступит никогда
  const { maxWindMs, maxGustMs } = numbers
  if (maxWindMs !== undefined && maxGustMs !== undefined && maxGustMs < maxWindMs) {
    errors.maxGustMs = { key: 'settings.errors.gustBelowWind' }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    profile: {
      name,
      maxWindMs: numbers.maxWindMs!,
      maxGustMs: numbers.maxGustMs!,
      cruiseSpeedMs: numbers.cruiseSpeedMs!,
      enduranceMin: numbers.enduranceMin!,
      reservePct: numbers.reservePct!,
      maxAltitudeM: numbers.maxAltitudeM!,
    },
  }
}
