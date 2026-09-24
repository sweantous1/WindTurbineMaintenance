import { describe, expect, it } from 'vitest'
import {
  FALLBACK_CONFIDENCE,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  classOptions,
  clampThreshold,
  countByClass,
  groupByPhoto,
  hasOperatorEdits,
  isVisible,
  namesPreview,
  neighborAfterRemoval,
  pendingPhotoIds,
  photoStatus,
  sortPhotos,
  summarize,
  visibleDetections,
  type DetectionFilter,
} from '../detectionView'
import { DONE, FAILED, MANIFEST, det, photo } from './helpers'

const all = (minConfidence: number): DetectionFilter => ({ minConfidence, hidden: new Set() })

describe('порог и фильтр классов', () => {
  it('порог включает границу: 0,25 видна при пороге 0,25', () => {
    expect(isVisible(det('p', 'crack', 0.25), all(0.25))).toBe(true)
    expect(isVisible(det('p', 'crack', 0.2499), all(0.25))).toBe(false)
  })

  it('скрытый класс не виден при любой уверенности', () => {
    expect(isVisible(det('p', 'crack', 0.99), { minConfidence: 0.1, hidden: new Set(['crack']) })).toBe(false)
    expect(isVisible(det('p', 'erosion', 0.99), { minConfidence: 0.1, hidden: new Set(['crack']) })).toBe(true)
  })

  it('видимые находки идут от самой уверенной, исходный список не меняется', () => {
    const list = [det('p', 'crack', 0.3), det('p', 'erosion', 0.9), det('p', 'lightning', 0.15), det('p', 'corrosion', 0.5)]
    const before = list.map((d) => d.id)
    expect(visibleDetections(list, all(0.25)).map((d) => d.confidence)).toEqual([0.9, 0.5, 0.3])
    expect(list.map((d) => d.id)).toEqual(before)
  })

  it('ползунок держится в пределах 0,1–0,9 и в сотых', () => {
    expect(clampThreshold(0.05)).toBe(THRESHOLD_MIN)
    expect(clampThreshold(0.95)).toBe(THRESHOLD_MAX)
    expect(clampThreshold(0.1 + 0.2)).toBe(0.3)
    expect(clampThreshold(Number.NaN)).toBe(FALLBACK_CONFIDENCE)
  })

  it('классы фильтра — из classMap модели и из находок, в порядке приложения', () => {
    expect(classOptions(MANIFEST, [])).toEqual(['crack', 'corrosion', 'erosion', 'lightning', 'contamination'])
    // Модели нет, но есть старые находки
    expect(classOptions(undefined, [det('p', 'other', 0.5), det('p', 'crack', 0.5)])).toEqual(['crack', 'other'])
    expect(classOptions(undefined, [])).toEqual([])
  })
})

describe('сводка', () => {
  it('считает по видимым находкам своих фото: классы, опасность, проверенные, фото', () => {
    const photos = [photo('a', { analysis: DONE }), photo('b', { analysis: FAILED }), photo('c'), photo('d', { analysis: DONE })]
    const visible = [
      det('a', 'crack', 0.9, { reviewed: true }),
      det('a', 'lightning', 0.8),
      det('a', 'erosion', 0.7, { severity: 5 }),
      det('d', 'contamination', 0.6),
      // Чужое фото в сводку не попадает
      det('zzz', 'crack', 0.9),
    ]
    const s = summarize(photos, visible)
    expect(s.total).toBe(4)
    expect(s.byClass).toMatchObject({ crack: 1, lightning: 1, erosion: 1, contamination: 1, corrosion: 0 })
    expect(s.bySeverity).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 1 })
    expect(s.high).toBe(2)
    expect(s.reviewed).toBe(1)
    expect(s.photos).toEqual({ total: 4, analyzed: 2, failed: 1, pending: 1, withFindings: 2 })
  })

  it('countByClass возвращает все классы, даже нулевые', () => {
    expect(Object.values(countByClass([]))).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})

describe('состояние фото', () => {
  it('не разобрано, ошибка, найдено N с опасностью 4–5', () => {
    expect(photoStatus(photo('a'), [])).toEqual({ kind: 'pending' })
    expect(photoStatus(photo('a', { analysis: FAILED }), [])).toEqual({ kind: 'failed' })
    expect(photoStatus(photo('a', { analysis: DONE }), [])).toEqual({ kind: 'done', found: 0, high: false })
    expect(photoStatus(photo('a', { analysis: DONE }), [det('a', 'crack', 0.5), det('a', 'lightning', 0.4)])).toEqual({
      kind: 'done',
      found: 2,
      high: true,
    })
  })

  it('«Анализировать все» берёт только неразобранные, фото с ошибкой — нет', () => {
    expect(pendingPhotoIds([photo('a', { analysis: DONE }), photo('b'), photo('c', { analysis: FAILED }), photo('d')])).toEqual(['b', 'd'])
  })

  it('лента — по времени добавления, одна пачка — по имени с учётом чисел', () => {
    const t1 = '2026-09-24T10:00:00.000Z'
    const t2 = '2026-09-24T11:00:00.000Z'
    const list = [
      photo('x', { fileName: 'DJI_0010.JPG', addedAt: t1 }),
      photo('y', { fileName: 'A.jpg', addedAt: t2 }),
      photo('z', { fileName: 'DJI_0002.JPG', addedAt: t1 }),
    ]
    expect(sortPhotos(list).map((p) => p.id)).toEqual(['z', 'x', 'y'])
  })

  it('группировка по фото сохраняет порядок', () => {
    const [x, y, z] = [det('a', 'crack', 0.9), det('b', 'crack', 0.8), det('a', 'erosion', 0.7)]
    const g = groupByPhoto([x, y, z])
    expect(g.get('a')).toEqual([x, z])
    expect(g.get('b')).toEqual([y])
  })
})

describe('правки оператора', () => {
  it('отметка «проверено», заметка или изменённая опасность — это правки', () => {
    expect(hasOperatorEdits([det('a', 'crack', 0.5)])).toBe(false)
    expect(hasOperatorEdits([det('a', 'crack', 0.5, { reviewed: true })])).toBe(true)
    expect(hasOperatorEdits([det('a', 'crack', 0.5, { severity: 5 })])).toBe(true)
    expect(hasOperatorEdits([det('a', 'crack', 0.5, { note: 'скол' })])).toBe(true)
    expect(hasOperatorEdits([det('a', 'crack', 0.5, { note: '  ' })])).toBe(false)
  })
})

describe('вспомогательное', () => {
  it('после удаления фото выбирается следующее, у последнего — предыдущее', () => {
    expect(neighborAfterRemoval(['a', 'b', 'c'], 'b')).toBe('c')
    expect(neighborAfterRemoval(['a', 'b', 'c'], 'c')).toBe('b')
    expect(neighborAfterRemoval(['a'], 'a')).toBeNull()
    expect(neighborAfterRemoval(['a', 'b'], 'x')).toBe('a')
  })

  it('список имён в тосте обрезается', () => {
    expect(namesPreview(['a', 'b'])).toEqual({ shown: 'a, b', more: 0 })
    expect(namesPreview(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: 'a, b, c', more: 2 })
  })
})
