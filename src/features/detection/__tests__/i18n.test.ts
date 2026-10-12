import { describe, expect, it } from 'vitest'
import ru from '@/i18n/features/detection.ru.json'
import en from '@/i18n/features/detection.en.json'
import { APP_DEFECT_CLASSES } from '@/domain/detection'
import type { PhotoIngestError } from '@/services/photoIngest'
import type { DetectBackend } from '@/services/detectionEngine'
import { ANALYSIS_ERROR_CODES } from '../analysisRunner'
import { SEVERITIES } from '../detectionView'

type Dict = { [key: string]: string | Dict }

// Ключи ищем прямо в исходниках экрана, чтобы ловить опечатки
const sources = import.meta.glob<string>(['/src/features/detection/*.{ts,tsx}', '/src/pages/{Detection,History}.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

function flatten(d: Dict, prefix = ''): string[] {
  return Object.entries(d).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)))
}

const ruKeys = new Set(flatten(ru as Dict))
const enKeys = new Set(flatten(en as Dict))
const PLURALS = ['_one', '_few', '_many', '_other']
// Ключ с плюралом пишется в коде без суффикса
const has = (keys: Set<string>, key: string) => keys.has(key) || keys.has(`${key}_one`)

// satisfies Record: новый код без перевода не соберётся
const INGEST_CODES = { notImage: true, tooLarge: true, decodeFailed: true, saveFailed: true } satisfies Record<PhotoIngestError['code'] | 'saveFailed', true>
const BACKENDS = { webgpu: true, wasm: true } satisfies Record<DetectBackend, true>

describe('словари экрана дефектов', () => {
  it('всё лежит в пространстве имён defects', () => {
    expect(Object.keys(ru)).toEqual(['defects'])
    expect(Object.keys(en)).toEqual(['defects'])
  })

  it('в русском и английском одинаковый набор ключей', () => {
    expect([...enKeys].sort()).toEqual([...ruKeys].sort())
  })

  it('значения — непустые строки', () => {
    for (const key of ruKeys) expect(key.length).toBeGreaterThan(0)
    const values = (d: Dict): string[] => Object.values(d).flatMap((v) => (typeof v === 'string' ? [v] : values(v)))
    for (const v of [...values(ru as Dict), ...values(en as Dict)]) expect(v.trim()).not.toBe('')
  })

  it('у русских плюралов есть все формы', () => {
    for (const key of ruKeys) {
      const base = PLURALS.reduce((k, s) => (k.endsWith(s) ? k.slice(0, -s.length) : k), key)
      if (base === key) continue
      for (const s of PLURALS) expect(ruKeys.has(`${base}${s}`), `${base}${s}`).toBe(true)
    }
  })

  it('все статические ключи из кода есть в обоих словарях', () => {
    const files = Object.values(sources)
    expect(files.length).toBeGreaterThan(10)
    const used = new Set<string>()
    for (const text of files) for (const m of text.matchAll(/'(defects\.[\w.]+)'/g)) used.add(m[1])
    expect(used.size).toBeGreaterThan(60)
    const missing = [...used].filter((k) => !has(ruKeys, k) || !has(enKeys, k))
    expect(missing).toEqual([])
  })

  it('ключи, собранные в коде из значений, тоже есть', () => {
    const dynamic = [
      ...APP_DEFECT_CLASSES.map((c) => `defects.classes.${c}`),
      ...SEVERITIES.map((s) => `defects.severity.${s}`),
      ...ANALYSIS_ERROR_CODES.map((c) => `defects.errors.${c}`),
      ...Object.keys(INGEST_CODES).map((c) => `defects.ingest.errors.${c}`),
      ...Object.keys(BACKENDS).map((b) => `defects.engine.backend.${b}`),
    ]
    const missing = dynamic.filter((k) => !has(ruKeys, k) || !has(enKeys, k))
    expect(missing).toEqual([])
  })
})
