import { describe, expect, it } from 'vitest'
import { DEFAULT_FARM_DEFAULTS } from '@/domain/defaults'
import type { Farm, WeatherSnapshot } from '@/domain/types'
import {
  DEFAULT_FORECAST_HOURS,
  distanceToFarmM,
  FAR_FROM_FARM_M,
  farmPoint,
  forecastDistanceM,
  formatCoords,
  geocodeLabel,
  initialForecastHours,
  initialPoint,
  isFarFromFarm,
  parseDecimal,
  parseForecastHours,
  parseLatitude,
  parseLongitude,
} from '../location'

const farm: Farm = {
  name: 'Каменская ВЭС',
  center: { lat: 48.215, lon: 40.284 },
  defaults: { ...DEFAULT_FARM_DEFAULTS },
  turbines: [],
}

function snapshot(patch: Partial<WeatherSnapshot>): WeatherSnapshot {
  return {
    fetchedAt: '2026-09-24T16:20:00.000Z',
    source: 'geocode',
    location: { lat: 47.23, lon: 39.72, name: 'Ростов-на-Дону' },
    timezone: 'Europe/Moscow',
    utcOffsetSeconds: 10800,
    current: {
      time: '2026-09-24T19:15',
      temperatureC: null,
      windMs10: null,
      windDirDeg10: null,
      gustMs10: null,
      weatherCode: null,
      precipitationMm: null,
    },
    hourly: [],
    ...patch,
  }
}

describe('числа из поля ввода', () => {
  it('точка и запятая, знак, типографский минус', () => {
    expect(parseDecimal('48.215')).toBe(48.215)
    expect(parseDecimal('48,215')).toBe(48.215)
    expect(parseDecimal(' -12.5 ')).toBe(-12.5)
    expect(parseDecimal('−12,5')).toBe(-12.5)
    expect(parseDecimal('+3')).toBe(3)
    expect(parseDecimal('.5')).toBe(0.5)
  })

  it('мусор — не число', () => {
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('1.2.3')).toBeNull()
    expect(parseDecimal('1,2.3')).toBeNull()
    expect(parseDecimal('48°')).toBeNull()
    expect(parseDecimal('1e3')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
  })
})

describe('координаты', () => {
  it('широта в пределах ±90, долгота ±180', () => {
    expect(parseLatitude('48,215')).toEqual({ ok: true, value: 48.215 })
    expect(parseLatitude('90')).toEqual({ ok: true, value: 90 })
    expect(parseLatitude('90.01')).toEqual({ ok: false, error: 'range' })
    expect(parseLongitude('-180')).toEqual({ ok: true, value: -180 })
    expect(parseLongitude('181')).toEqual({ ok: false, error: 'range' })
  })

  it('пустое поле и не число — разные ошибки', () => {
    expect(parseLatitude('  ')).toEqual({ ok: false, error: 'empty' })
    expect(parseLongitude('сорок')).toEqual({ ok: false, error: 'notNumber' })
  })

  it('координаты показываются с точкой: их вставляют в карты', () => {
    expect(formatCoords({ lat: 48.1875, lon: 40.3125 })).toBe('48.1875, 40.3125')
  })
})

describe('часы прогноза', () => {
  it('целое от 1 до 168', () => {
    expect(parseForecastHours('48')).toEqual({ ok: true, value: 48 })
    expect(parseForecastHours(' 1 ')).toEqual({ ok: true, value: 1 })
    expect(parseForecastHours('168')).toEqual({ ok: true, value: 168 })
    expect(parseForecastHours('0')).toEqual({ ok: false, error: 'range' })
    expect(parseForecastHours('169')).toEqual({ ok: false, error: 'range' })
    expect(parseForecastHours('24.5')).toEqual({ ok: false, error: 'notInteger' })
    expect(parseForecastHours('-5')).toEqual({ ok: false, error: 'notInteger' })
    expect(parseForecastHours('')).toEqual({ ok: false, error: 'empty' })
  })
})

describe('период прогноза по умолчанию', () => {
  const hours = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ time: `2026-09-${String(24 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00` }))

  it('как у сохранённого снимка, чтобы «Обновить» спрашивало тот же горизонт', () => {
    expect(initialForecastHours({ weather: snapshot({ hourly: hours(168) as WeatherSnapshot['hourly'] }) })).toBe(168)
    expect(initialForecastHours({ weather: snapshot({ hourly: hours(24) as WeatherSnapshot['hourly'] }) })).toBe(24)
  })

  it('без снимка или с пустым рядом — по умолчанию, длиннее максимума — максимум', () => {
    expect(initialForecastHours({})).toBe(DEFAULT_FORECAST_HOURS)
    expect(initialForecastHours({ weather: snapshot({}) })).toBe(DEFAULT_FORECAST_HOURS)
    expect(initialForecastHours({ weather: snapshot({ hourly: hours(200) as WeatherSnapshot['hourly'] }) })).toBe(168)
  })
})

describe('точка прогноза по умолчанию', () => {
  it('есть ферма — её центр с подписью', () => {
    expect(initialPoint({ farm })).toEqual({ lat: 48.215, lon: 40.284, source: 'farm', name: 'Каменская ВЭС' })
    expect(farmPoint({ ...farm, name: undefined })).toEqual({ lat: 48.215, lon: 40.284, source: 'farm' })
  })

  it('фермы нет — место прошлого прогноза, чтобы обновление спрашивало то же', () => {
    expect(initialPoint({ weather: snapshot({}) })).toEqual({
      lat: 47.23,
      lon: 39.72,
      source: 'geocode',
      name: 'Ростов-на-Дону',
    })
    expect(initialPoint({ weather: snapshot({ source: 'manual', location: { lat: 1, lon: 2 } }) })).toEqual({
      lat: 1,
      lon: 2,
      source: 'manual',
    })
  })

  it('прошлый прогноз был по ферме, а фермы больше нет — точку выбирает пользователь', () => {
    expect(initialPoint({ weather: snapshot({ source: 'farm' }) })).toBeNull()
    expect(initialPoint({})).toBeNull()
  })
})

describe('геокодер', () => {
  it('подпись без повторов', () => {
    expect(geocodeLabel({ name: 'Москва', admin1: 'Москва', country: 'Россия', lat: 55.75, lon: 37.62 })).toBe('Москва, Россия')
    expect(geocodeLabel({ name: 'Каменск-Шахтинский', admin1: 'Ростовская область', country: 'Россия', lat: 48.3, lon: 40.3 })).toBe(
      'Каменск-Шахтинский, Ростовская область, Россия',
    )
    expect(geocodeLabel({ name: 'Nowhere', lat: 0, lon: 0 })).toBe('Nowhere')
  })

  it('расстояние до фермы только при наличии фермы и точки', () => {
    expect(distanceToFarmM({ lat: 48.215, lon: 40.284 }, farm)).toBe(0)
    expect(distanceToFarmM({ lat: 48.3, lon: 40.284 }, farm)).toBeCloseTo(9452, -1)
    expect(distanceToFarmM(null, farm)).toBeUndefined()
    expect(distanceToFarmM({ lat: 0, lon: 0 }, undefined)).toBeUndefined()
  })

  it('расстояние от места прогноза — до нынешнего центра фермы, а не из снимка', () => {
    const weather = snapshot({ source: 'farm', location: { lat: 48.215, lon: 40.284 }, distanceToFarmM: 0 })
    const moved: Farm = { ...farm, center: { lat: 51.8, lon: 40.284 } }
    const d = forecastDistanceM({ farm: moved, weather })
    expect(d).toBeCloseTo(398_600, -3)
    expect(isFarFromFarm(d)).toBe(true)
    expect(isFarFromFarm(forecastDistanceM({ farm, weather }))).toBe(false)
    expect(isFarFromFarm(FAR_FROM_FARM_M)).toBe(false)
    expect(forecastDistanceM({ farm })).toBeUndefined()
    expect(forecastDistanceM({ weather })).toBeUndefined()
    expect(isFarFromFarm(undefined)).toBe(false)
  })
})
