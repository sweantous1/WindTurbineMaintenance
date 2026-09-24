import { describe, expect, it } from 'vitest'
import ru from '@/i18n/features/sim.ru.json'
import en from '@/i18n/features/sim.en.json'
import { CAMERA_MODES, PATH_KINDS, PHASE_KEYS } from '../simView'

type Dict = { [key: string]: string | Dict }

// Исходники экрана: ключи ищутся прямо в коде, чтобы опечатка в ключе не дошла до интерфейса
const sources = import.meta.glob<string>(['/src/features/simulation/**/*.{ts,tsx}', '/src/pages/Simulation.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

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
const PLURALS = ['_one', '_few', '_many', '_other']
// Ключ с плюралом пишется в коде без суффикса
const exists = (keys: Map<string, string>, key: string) => keys.has(key) || keys.has(`${key}_other`)

describe('словари экрана 3D-облёта', () => {
  it('всё в пространстве имён sim, плюс пункт меню', () => {
    expect(Object.keys(ru)).toEqual(['nav', 'sim'])
    expect(Object.keys(en)).toEqual(['nav', 'sim'])
    expect(ruKeys.get('nav.simulation')).toBe('3D-облёт')
    expect(enKeys.get('nav.simulation')).toBe('3D flight')
  })

  it('в русском и английском одинаковый набор ключей, значения непустые', () => {
    expect([...enKeys.keys()].sort()).toEqual([...ruKeys.keys()].sort())
    for (const [key, value] of [...ruKeys, ...enKeys]) expect(value.trim(), key).not.toBe('')
  })

  it('у плюралов все формы', () => {
    for (const keys of [ruKeys, enKeys]) {
      for (const key of keys.keys()) {
        const base = PLURALS.reduce((k, s) => (k.endsWith(s) ? k.slice(0, -s.length) : k), key)
        if (base === key) continue
        for (const s of PLURALS) expect(keys.has(`${base}${s}`), `${base}${s}`).toBe(true)
      }
    }
  })

  it('подстановки одинаковы на обоих языках', () => {
    const vars = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort()
    for (const [key, value] of ruKeys) expect(vars(enKeys.get(key) ?? ''), key).toEqual(vars(value))
  })

  it('каждый ключ, написанный в коде строкой, есть в обоих словарях', () => {
    const files = Object.values(sources)
    expect(files.length).toBeGreaterThan(10)
    const used = new Set<string>()
    for (const text of files) for (const m of text.matchAll(/'(sim\.[A-Za-z0-9_.]+)'/g)) used.add(m[1])
    expect(used.size).toBeGreaterThan(50)
    const missing = [...used].filter((k) => !exists(ruKeys, k) || !exists(enKeys, k))
    expect(missing).toEqual([])
  })

  it('ключи, собираемые в коде из частей, тоже есть', () => {
    const dynamic = [
      ...PHASE_KEYS,
      ...CAMERA_MODES.map((m) => `sim.controls.cameraModes.${m}`),
      ...PATH_KINDS.map((k) => `sim.legend.${k}`),
      ...['farm', 'route', 'speed'].flatMap((g) => ['title', 'body', 'link'].map((p) => `sim.gaps.${g}.${p}`)),
    ]
    const missing = dynamic.filter((k) => !exists(ruKeys, k) || !exists(enKeys, k))
    expect(missing).toEqual([])
  })
})
