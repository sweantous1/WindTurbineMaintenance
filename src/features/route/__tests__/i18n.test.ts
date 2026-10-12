import { describe, expect, it } from 'vitest'
import ru from '@/i18n/features/route.ru.json'
import en from '@/i18n/features/route.en.json'
import routerSource from '@/pages/Router.tsx?raw'
import type { KmlImportErrorCode } from '@/lib/kml'
import { ALGORITHMS, PARAM_DEFS } from '../optimizerParams'

type Dict = { [key: string]: string | Dict }

// ключи перевода ищем прямо в исходниках экрана, чтобы опечатка не дошла до UI
const featureSources = import.meta.glob<string>(['../*.tsx', '../*.ts'], { query: '?raw', import: 'default', eager: true })
const sources = [routerSource, ...Object.values(featureSources)]

function flatten(d: Dict, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(d)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv)
  }
  return out
}

const ruKeys = flatten(ru as Dict)
const enKeys = flatten(en as Dict)

// плюральные ключи хранятся как key_one, key_few..., а в коде пишутся без суффикса
const exists = (keys: Map<string, string>, key: string) => keys.has(key) || keys.has(`${key}_other`)

// satisfies Record: новый код ошибки импорта без перевода не соберётся
const IMPORT_ERROR_CODES = {
  noTurbines: true,
  notKml: true,
  invalidXml: true,
  kmzBroken: true,
  kmzNoKml: true,
  tooLarge: true,
  readFailed: true,
} satisfies Record<KmlImportErrorCode, true>

describe('словари экрана маршрута', () => {
  it('в русском и английском одинаковый набор ключей', () => {
    expect([...ruKeys.keys()].sort()).toEqual([...enKeys.keys()].sort())
  })

  it('всё лежит в пространстве имён routePlan', () => {
    expect(Object.keys(ru)).toEqual(['routePlan'])
    expect(Object.keys(en)).toEqual(['routePlan'])
  })

  it('значения — непустые строки', () => {
    for (const [key, value] of [...ruKeys, ...enKeys]) expect(value.trim(), key).not.toBe('')
  })

  it('у русских плюралов есть все формы', () => {
    const bases = [...ruKeys.keys()].filter((k) => /_(one|few|many|other)$/.test(k)).map((k) => k.replace(/_(one|few|many|other)$/, ''))
    expect(bases.length).toBeGreaterThan(0)
    for (const base of new Set(bases)) {
      for (const form of ['one', 'few', 'many', 'other']) expect(ruKeys.has(`${base}_${form}`), `${base}_${form}`).toBe(true)
    }
  })

  it('каждый ключ, написанный в коде строкой, есть в обоих словарях', () => {
    const used = new Set<string>()
    for (const src of sources) for (const m of src.matchAll(/'(routePlan\.[A-Za-z0-9_.]+)'/g)) used.add(m[1])
    expect(used.size).toBeGreaterThan(50)
    for (const key of used) {
      expect(exists(ruKeys, key), `ru: ${key}`).toBe(true)
      expect(exists(enKeys, key), `en: ${key}`).toBe(true)
    }
  })

  it('подстановки в текстах одинаковы на обоих языках', () => {
    const vars = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort()
    for (const [key, value] of ruKeys) expect(vars(enKeys.get(key) ?? ''), key).toEqual(vars(value))
    // в ошибке импорта есть имя файла, чтобы после пары неудачных попыток было понятно, о каком речь
    expect(vars(ruKeys.get('routePlan.importErrors.withFile') ?? '')).toEqual(['name', 'reason'])
    expect(vars(ruKeys.get('routePlan.import.weatherReset') ?? '')).toEqual(['km'])
  })

  it('тексты ошибок не называют архивом KMZ то, что пользователь им не выбирал', () => {
    for (const keys of [ruKeys, enKeys]) {
      expect(keys.get('routePlan.importErrors.kmzNoKml')).not.toMatch(/^(В архиве KMZ|The KMZ archive)/)
      expect(keys.get('routePlan.importErrors.notKml')).toBeTruthy()
    }
  })

  it('ключи, собираемые в коде из частей, тоже есть', () => {
    const dynamic = [
      ...ALGORITHMS.flatMap((a) => [`routePlan.settings.algorithms.${a}`, `routePlan.settings.algorithmHints.${a}`]),
      ...Object.values(PARAM_DEFS).flatMap((defs) => defs.map((d) => `routePlan.settings.params.${d.key}`)),
      ...Object.keys(IMPORT_ERROR_CODES).map((code) => `routePlan.importErrors.${code}`),
      'routePlan.summary.endpoints.takeoff',
      'routePlan.summary.endpoints.landing',
    ]
    for (const key of dynamic) {
      expect(exists(ruKeys, key), `ru: ${key}`).toBe(true)
      expect(exists(enKeys, key), `en: ${key}`).toBe(true)
    }
  })
})
