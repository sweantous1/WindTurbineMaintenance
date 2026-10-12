import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WtmDatabase } from '../db'
import { createMissionRepository } from '../missions'
import { createPhotoRepository, type NewDetection, type PreparedPhoto } from '../photos'
import type { PhotoAnalysis } from '@/domain/detection'

const prepared = (name: string): PreparedPhoto => ({
  fileName: name,
  mimeType: 'image/jpeg',
  blob: new Blob([new Uint8Array(1000)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  width: 8192,
  height: 5460,
})

const analysis: PhotoAnalysis = {
  status: 'done', modelName: 'm', modelVersion: '1', backend: 'wasm', analyzedAt: '2026-09-24T20:00:00Z',
  minConfidence: 0.1, iou: 0.7, tiles: 176, durationMs: 5000,
}

const found = (n: number): NewDetection[] =>
  Array.from({ length: n }, (_, i) => ({
    modelClass: 'hide_craze', defectClass: 'crack', confidence: 0.5 + i / 100,
    x: 0.1, y: 0.1, w: 0.05, h: 0.05, severity: 3, reviewed: false,
  }))

let database: WtmDatabase
let missions: ReturnType<typeof createMissionRepository>
let photos: ReturnType<typeof createPhotoRepository>
let n = 0

beforeEach(async () => {
  database = new WtmDatabase(`photos-test-${n++}`)
  await database.open()
  missions = createMissionRepository(database)
  photos = createPhotoRepository(database)
})

afterEach(async () => {
  await database.delete()
})

describe('фото и находки', () => {
  it('фото сохраняется вместе с изображением и миниатюрой отдельно от записи', async () => {
    const m = await missions.create({ name: 'М' })
    const [p] = await photos.add(m.id, [prepared('a.jpg')])
    expect(p.sizeBytes).toBe(1000)
    expect((await photos.listByMission(m.id)).map((x) => x.fileName)).toEqual(['a.jpg'])
    expect((await photos.getBlob(p.id))?.thumb.size).toBe(100)
  })

  it('повторный анализ заменяет находки фото, а не добавляет к ним', async () => {
    const m = await missions.create({ name: 'М' })
    const [p] = await photos.add(m.id, [prepared('a.jpg')])
    await photos.saveAnalysis(p.id, analysis, found(3))
    await photos.saveAnalysis(p.id, analysis, found(2))
    expect(await photos.detectionsByMission(m.id)).toHaveLength(2)
    expect((await photos.listByMission(m.id))[0].analysis?.tiles).toBe(176)
  })

  it('облетанная миссия становится «разобранной», когда разобраны все фото', async () => {
    const m = await missions.create({ name: 'М' })
    await missions.complete(m.id, { force: true })
    const [a, b] = await photos.add(m.id, [prepared('a.jpg'), prepared('b.jpg')])
    await photos.saveAnalysis(a.id, analysis, found(1))
    expect((await missions.get(m.id))?.status).toBe('flown')
    await photos.saveAnalysis(b.id, analysis, [])
    expect((await missions.get(m.id))?.status).toBe('analyzed')
    // Новое фото, снова есть что разбирать
    await photos.add(m.id, [prepared('c.jpg')])
    expect((await missions.get(m.id))?.status).toBe('flown')
  })

  it('миссия до полёта не меняет статус от анализа фото', async () => {
    const m = await missions.create({ name: 'М' })
    const [a] = await photos.add(m.id, [prepared('a.jpg')])
    await photos.saveAnalysis(a.id, analysis, found(1))
    expect((await missions.get(m.id))?.status).toBe('draft')
  })

  it('удаление фото удаляет изображение и находки', async () => {
    const m = await missions.create({ name: 'М' })
    const [a] = await photos.add(m.id, [prepared('a.jpg')])
    await photos.saveAnalysis(a.id, analysis, found(2))
    await photos.remove(a.id)
    expect(await photos.listByMission(m.id)).toEqual([])
    expect(await photos.getBlob(a.id)).toBeUndefined()
    expect(await photos.detectionsByMission(m.id)).toEqual([])
  })

  it('удаление миссии удаляет её фото и находки', async () => {
    const m = await missions.create({ name: 'М' })
    const [a] = await photos.add(m.id, [prepared('a.jpg')])
    await photos.saveAnalysis(a.id, analysis, found(2))
    await missions.remove(m.id)
    expect(await database.photos.count()).toBe(0)
    expect(await database.photoBlobs.count()).toBe(0)
    expect(await database.detections.count()).toBe(0)
  })

  it('к архивной миссии фото не добавляются', async () => {
    const m = await missions.create({ name: 'М' })
    await missions.complete(m.id, { force: true })
    await missions.archive(m.id)
    await expect(photos.add(m.id, [prepared('a.jpg')])).rejects.toThrow()
  })

  it('правка находки: опасность и отметка «проверено»', async () => {
    const m = await missions.create({ name: 'М' })
    const [a] = await photos.add(m.id, [prepared('a.jpg')])
    await photos.saveAnalysis(a.id, analysis, found(1))
    const [d] = await photos.detectionsByMission(m.id)
    await photos.updateDetection(d.id, { severity: 5, reviewed: true })
    expect((await photos.detectionsByMission(m.id))[0]).toMatchObject({ severity: 5, reviewed: true })
    await expect(photos.updateDetection('нет-такой', { severity: 1 })).rejects.toThrow()
  })
})
