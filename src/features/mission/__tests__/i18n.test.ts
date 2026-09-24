import { describe, expect, it } from 'vitest'
import ru from '@/i18n/features/mission.ru.json'
import en from '@/i18n/features/mission.en.json'
import { missionSteps } from '@/domain/missionStatus'
import type { MissionStatus } from '@/domain/types'
import { HISTORY_FILTERS, LIMIT_FIELDS, MISSION_TYPES } from '../missionView'

type Dict = { [key: string]: string | Dict }

function flatten(obj: Dict, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)))
}

const ruKeys = new Set(flatten(ru as Dict))
const enKeys = new Set(flatten(en as Dict))
const PLURALS = ['_one', '_few', '_many', '_other']

// Ключ с count разрешается через плюральные формы
const has = (keys: Set<string>, key: string) => keys.has(key) || keys.has(`${key}_one`)

// Исходники экранов миссии: статические ключи t('...') должны быть в словаре
const sources = import.meta.glob<string>(['/src/features/mission/*.{ts,tsx}', '/src/pages/{Home,History}.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('переводы миссии', () => {
  it('в русском и английском одинаковый набор ключей', () => {
    expect([...enKeys].sort()).toEqual([...ruKeys].sort())
  })

  it('у русских плюралов есть все формы', () => {
    for (const key of ruKeys) {
      const base = PLURALS.reduce((k, s) => (k.endsWith(s) ? k.slice(0, -s.length) : k), key)
      if (base === key) continue
      for (const s of PLURALS) expect(ruKeys.has(`${base}${s}`), `${base}${s}`).toBe(true)
    }
  })

  it('все статические ключи из кода есть в словаре', () => {
    const files = Object.entries(sources)
    expect(files.length).toBeGreaterThan(5)
    const used = new Set<string>()
    for (const [, text] of files) {
      for (const m of text.matchAll(/\bt\(\s*'((?:mission|missionHistory)\.[\w.]+)'/g)) used.add(m[1])
    }
    expect(used.size).toBeGreaterThan(50)
    const missing = [...used].filter((k) => !has(ruKeys, k) || !has(enKeys, k))
    expect(missing).toEqual([])
  })

  it('ключи, которые собираются в коде по значениям, тоже есть', () => {
    const statuses: MissionStatus[] = ['draft', 'planned', 'ready', 'flown', 'analyzed', 'archived']
    const dynamic = [
      ...statuses.map((s) => `common.statuses.${s}`),
      ...MISSION_TYPES.map((x) => `mission.types.${x}`),
      ...LIMIT_FIELDS.map((f) => `mission.fields.${f}`),
      ...missionSteps(undefined).flatMap((s) => [`mission.steps.${s.key}.title`, `mission.steps.${s.key}.hint`]),
      ...HISTORY_FILTERS.map((f) => `missionHistory.filters.${f}`),
      ...['name', 'type', 'status', 'created', 'completed', 'turbines', 'routeKm', 'departure', 'weather'].map((c) => `missionHistory.columns.${c}`),
      ...(['route', 'weather', 'departure', 'both', 'routeDeparture'] as const).map((w) => `mission.complete.missing.${w}`),
      ...['name', 'type', 'droneProfileId', 'flightAltitudeM', 'limits', 'farm', 'takeoff', 'route', 'weather', 'departureTime', 'notes'].map(
        (f) => `mission.fieldNames.${f}`,
      ),
      ...['required', 'notNumber', 'range', 'nameRequired', 'tempOrder', 'gustBelowWind'].map((e) => `mission.errors.${e}`),
    ]
    const missing = dynamic.filter((k) => !has(ruKeys, k) || !has(enKeys, k))
    expect(missing).toEqual([])
  })
})
