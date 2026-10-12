import { describe, expect, it } from 'vitest'
import { DEFECTS_EXPORT_FORMAT, buildDefectsExport, defectsExportJson, exportFileName, photoBaseName } from '../detectionExport'
import { DONE, det, photo } from './helpers'

const mission = {
  id: 'm1',
  name: 'Облёт 24.09',
  status: 'flown' as const,
  farm: { turbines: [{ id: 't1', name: 'T1', lat: 47.5, lon: 39.7 }] },
}

describe('выгрузка находок в JSON', () => {
  const photos = [
    photo('a', { analysis: DONE, turbineId: 't1', gps: { lat: 47.5, lon: 39.7 }, takenAt: '2026-09-24T09:00:00.000Z' }),
    photo('b'),
    photo('c', { turbineId: 'gone' }),
  ]
  const detections = [
    det('a', 'crack', 0.87, { x: 0.1, y: 0.2, w: 0.03, h: 0.04, reviewed: true, note: 'скол кромки' }),
    det('a', 'erosion', 0.15),
    det('a', 'lightning', 0.6),
    det('other', 'crack', 0.9),
  ]
  const filter = { minConfidence: 0.25, hidden: new Set(['lightning'] as const) }

  it('находки — как на экране: выше порога, без скрытых классов, рамки в долях', () => {
    const out = buildDefectsExport({ mission, photos, detections, filter, exportedAt: '2026-09-24T20:00:00.000Z' })
    expect(out.format).toBe(DEFECTS_EXPORT_FORMAT)
    expect(out.filter).toEqual({ minConfidence: 0.25, classes: ['crack', 'corrosion', 'erosion', 'contamination', 'delamination', 'other'] })
    const [a, b, c] = out.photos
    expect(a.detections).toEqual([
      { id: detections[0].id, defectClass: 'crack', modelClass: 'crack', confidence: 0.87, x: 0.1, y: 0.2, w: 0.03, h: 0.04, severity: 3, reviewed: true, note: 'скол кромки' },
    ])
    expect(b.detections).toEqual([])
    expect(out.summary).toMatchObject({ photos: 3, analyzed: 1, detections: 1, reviewed: 1 })
    expect(out.summary.byClass.crack).toBe(1)
    expect(c.turbine).toEqual({ id: 'gone' })
  })

  it('фото: имя, размеры, турбина с именем, анализ целиком', () => {
    const [a, b] = buildDefectsExport({ mission, photos, detections, filter, exportedAt: 'x' }).photos
    expect(a).toMatchObject({
      fileName: 'a.jpg',
      width: 8192,
      height: 5460,
      turbine: { id: 't1', name: 'T1' },
      takenAt: '2026-09-24T09:00:00.000Z',
      gps: { lat: 47.5, lon: 39.7 },
      analysis: DONE,
    })
    expect(b.analysis).toBeNull()
    expect(b.turbine).toBeNull()
    expect('gps' in b).toBe(false)
  })

  it('JSON одного фото — тот же формат с одним фото', () => {
    const json = JSON.parse(defectsExportJson({ mission, photos: [photos[0]], detections, filter, exportedAt: 'x' }))
    expect(json.photos).toHaveLength(1)
    expect(json.summary.photos).toBe(1)
  })
})

describe('имена файлов', () => {
  it('убирает запрещённые в Windows символы и зарезервированные имена', () => {
    expect(exportFileName('defects-Облёт: 24/09*', 'json')).toBe('defects-Облёт 24 09.json')
    expect(exportFileName('CON', 'png')).toBe('defects-CON.png')
    expect(exportFileName('  ', 'json')).toBe('defects.json')
    expect(exportFileName('a'.repeat(200), 'json')).toHaveLength(80 + 5)
  })

  it('имя снимка без расширения', () => {
    expect(photoBaseName('DJI_0042.JPG')).toBe('DJI_0042')
    expect(photoBaseName('.hidden')).toBe('.hidden')
    expect(photoBaseName('no-ext')).toBe('no-ext')
  })
})
