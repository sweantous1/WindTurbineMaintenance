import { describe, expect, it } from 'vitest'
import { STATUS_ORDER, statusLook } from '../flightWindow'
import { COMPASS_POINTS } from '../format'
import { DRONE_NUMERIC_FIELDS } from '../droneProfileForm'
import { dictionaries, flatKeys } from './testI18n'

const PLURAL = /_(zero|one|two|few|many|other)$/

const keys = {
  ru: new Set(dictionaries.ru.flatMap((d) => flatKeys(d))),
  en: new Set(dictionaries.en.flatMap((d) => flatKeys(d))),
}

// Ключ есть сам по себе или во всех формах множественного числа языка
function has(lang: 'ru' | 'en', key: string): boolean {
  const set = keys[lang]
  if (set.has(key)) return true
  const forms = lang === 'ru' ? ['one', 'few', 'many', 'other'] : ['one', 'other']
  return forms.every((f) => set.has(`${key}_${f}`))
}

// Исходники экрана погоды, карточки прогноза и настроек как текст
const sources = import.meta.glob<string>(
  [
    '/src/pages/{Weather,Settings}.tsx',
    '/src/features/forecast/FlightForecastCard.tsx',
    '/src/features/weather/*.{ts,tsx}',
    '/src/features/settings/*.{ts,tsx}',
  ],
  { query: '?raw', import: 'default', eager: true },
)

describe('словари экрана погоды и настроек', () => {
  it('в русском и английском один и тот же набор ключей', () => {
    expect([...keys.en].sort()).toEqual([...keys.ru].sort())
  })

  it('у русских плюралов есть все четыре формы', () => {
    const plurals = [...new Set([...keys.ru].filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, '')))]
    expect(plurals.length).toBeGreaterThan(5)
    for (const k of plurals) expect(has('ru', k), k).toBe(true)
  })

  it('каждый ключ, написанный в коде строкой, есть в обоих словарях', () => {
    const literal = /['`]((?:weatherScreen|flightForecast|settings)\.[A-Za-z0-9_.]+)['`]/g
    const used = new Set<string>()
    expect(Object.keys(sources).length).toBeGreaterThan(15)
    for (const text of Object.values(sources)) {
      for (const m of text.matchAll(literal)) used.add(m[1])
    }
    expect(used.size).toBeGreaterThan(50)
    for (const key of used) {
      expect(has('ru', key), `ru: ${key}`).toBe(true)
      expect(has('en', key), `en: ${key}`).toBe(true)
    }
  })

  it('ключи, собранные из частей, тоже есть', () => {
    const dynamic = [
      ...COMPASS_POINTS.map((p) => `weatherScreen.compass.${p}`),
      ...['farm', 'geocode', 'manual'].map((m) => `weatherScreen.location.modes.${m}`),
      ...['geocode', 'manual'].map((m) => `weatherScreen.location.hint.${m}`),
      ...['empty', 'notNumber', 'range'].map((e) => `weatherScreen.location.errors.${e}`),
      ...['empty', 'notInteger', 'range'].map((e) => `weatherScreen.request.hoursErrors.${e}`),
      'weatherScreen.age.justNow',
      ...['minutes', 'hours', 'days'].map((u) => `weatherScreen.age.${u}`),
      ...STATUS_ORDER.map((s) => statusLook(s).labelKey),
      ...STATUS_ORDER.map((s) => `flightForecast.verdict.${s}`),
      ...['route', 'weather', 'departure', 'departureMissing'].flatMap((g) => [
        `flightForecast.gaps.${g}`,
        `flightForecast.gapLinks.${g}`,
      ]),
      ...['takeoff', 'staleRoute'].map((p) => `flightForecast.planIssues.${p}`),
      ...DRONE_NUMERIC_FIELDS.flatMap((f) => [`settings.drones.fields.${f}`, `settings.drones.hints.${f}`]),
      ...['B', 'KB', 'MB', 'GB'].map((u) => `settings.about.units.${u}`),
    ]
    for (const key of dynamic) {
      expect(has('ru', key), `ru: ${key}`).toBe(true)
      expect(has('en', key), `en: ${key}`).toBe(true)
    }
  })

  it('ключи ошибок Open-Meteo, которые показывает экран, есть в словаре wmo', () => {
    for (const code of ['badPoint', 'network', 'timeout', 'http', 'httpStatus', 'badJson', 'badShape', 'units', 'unitsMissing']) {
      expect(has('ru', `wmo.errors.${code}`), code).toBe(true)
      expect(has('en', `wmo.errors.${code}`), code).toBe(true)
    }
  })
})
