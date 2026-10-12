// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { toast } from 'react-toastify'
import i18n from '@/i18n'
import { db } from '@/storage/db'
import { missions } from '@/storage/missions'
import { photos, type PreparedPhoto } from '@/storage/photos'
import type { DetectHandle, DetectResult, DetectionEngine } from '@/services/detectionEngine'
import { DetectCancelledError, ModelMissingError } from '@/services/detectionEngine'
import Detection from '@/pages/Detection'
import { analysisRunner } from '@/features/detection/useAnalysis'
import { cleanup, click, getByText, queryByText, render, waitFor } from '@/features/mission/__tests__/render'
import { MANIFEST } from './helpers'

// Движок без воркера и ONNX Runtime: ответы задаёт тест
const engine = vi.hoisted(() => ({
  load: null as unknown as DetectionEngine['load'],
  detect: null as unknown as DetectionEngine['detect'],
}))

vi.mock('@/services/detectionEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/detectionEngine')>()
  return {
    ...actual,
    getDetectionEngine: () => ({
      load: () => engine.load(),
      detect: (...args: Parameters<DetectionEngine['detect']>) => engine.detect(...args),
      dispose: () => {},
    }),
  }
})

// В happy-dom снимки не декодируются
vi.mock('@/services/photoIngest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/photoIngest')>()
  return {
    ...actual,
    preparePhoto: async (file: File) => {
      if (!file.type.startsWith('image/')) throw new actual.PhotoIngestError('notImage', file.name)
      return prepared(file.name)
    },
  }
})

function prepared(name: string, over: Partial<PreparedPhoto> = {}): PreparedPhoto {
  return {
    fileName: name,
    mimeType: 'image/jpeg',
    blob: new Blob([new Uint8Array(64)], { type: 'image/jpeg' }),
    thumb: new Blob([new Uint8Array(16)], { type: 'image/jpeg' }),
    width: 8192,
    height: 5460,
    ...over,
  }
}

const RESULT: DetectResult = {
  detections: [
    { modelClass: 'thunderstrike', classIndex: 6, confidence: 0.91, x: 0.1, y: 0.1, w: 0.05, h: 0.05 },
    { modelClass: 'hide_craze', classIndex: 2, confidence: 0.42, x: 0.5, y: 0.5, w: 0.02, h: 0.03 },
    { modelClass: 'surface_eye', classIndex: 3, confidence: 0.15, x: 0.7, y: 0.2, w: 0.01, h: 0.01 },
  ],
  tiles: 176,
  durationMs: 192_000,
  backend: 'wasm',
}

const detectCalls: { confidence: number; iou: number }[] = []

function engineReady() {
  engine.load = async () => ({ backend: 'wasm', manifest: MANIFEST })
  engine.detect = (_image, opts, onProgress): DetectHandle => {
    detectCalls.push({ ...opts })
    onProgress?.({ tile: 0, tiles: RESULT.tiles })
    return { promise: Promise.resolve(RESULT), cancel: () => {} }
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('ru')
})

beforeEach(async () => {
  await db.open()
  await Promise.all([db.missions.clear(), db.settings.clear(), db.photos.clear(), db.photoBlobs.clear(), db.detections.clear()])
  detectCalls.length = 0
  engineReady()
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
})

const text = () => document.body.textContent ?? ''

async function missionWithPhotos(names: string[]) {
  const m = await missions.create({ name: 'Облёт' })
  await photos.add(m.id, names.map((n) => prepared(n)))
  return m
}

function buttonByText(label: string): HTMLButtonElement {
  const el = getByText('button', label)
  if (!(el instanceof HTMLButtonElement)) throw new Error(`«${label}» — не кнопка`)
  return el
}

async function changeValue(el: HTMLInputElement | HTMLSelectElement, value: string, event: 'input' | 'change') {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event(event, { bubbles: true }))
  })
}

describe('экран поиска дефектов', () => {
  it('строка состояния: модель, версия и процессор, без плашки о полноте модели', async () => {
    await missionWithPhotos(['a.jpg'])
    await render(createElement(Detection))
    await waitFor(() => expect(text()).toContain('grant-temp-best-turbine'))
    expect(text()).toContain('версия 2025-03-11')
    expect(text()).toContain('процессор (WASM)')
    expect(text()).not.toMatch(/находит примерно|recall/)
  })

  it('без модели — баннер «не установлена», анализ недоступен', async () => {
    engine.load = () => Promise.reject(new ModelMissingError())
    await missionWithPhotos(['a.jpg'])
    await render(createElement(Detection))
    await waitFor(() => expect(text()).toContain('Модель не установлена'))
    await waitFor(() => expect(buttonByText('Анализировать все (1)').disabled).toBe(true))
  })

  it('анализ всех фото: находки от 0,1 сохраняются, таблица и ползунок фильтруют без повторного прогона', async () => {
    const m = await missionWithPhotos(['a.jpg', 'b.jpg'])
    await render(createElement(Detection))
    await waitFor(() => expect(buttonByText('Анализировать все (2)').disabled).toBe(false))

    await click(buttonByText('Анализировать все (2)'))
    await waitFor(async () => expect(await db.detections.count()).toBe(6))
    expect(detectCalls).toEqual([
      { confidence: 0.1, iou: 0.7 },
      { confidence: 0.1, iou: 0.7 },
    ])
    const stored = await db.detections.where('missionId').equals(m.id).toArray()
    expect(stored.find((d) => d.modelClass === 'thunderstrike')).toMatchObject({ defectClass: 'lightning', severity: 4, reviewed: false })
    expect((await db.missions.get(m.id))?.status).toBe('draft')

    // Порог из манифеста 0,25, находка 0,15 скрыта
    await waitFor(() => expect(text()).toContain('Показано 2 из 3'))
    expect(text()).toContain('найдено 2')
    expect(queryByText('td', 'Эрозия')).toBeUndefined()

    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')
    if (!slider) throw new Error('Нет ползунка')
    await changeValue(slider, '0.1', 'input')
    await waitFor(() => expect(text()).toContain('Показано 3 из 3'))
    expect(getByText('td', 'Эрозия')).toBeTruthy()
    expect(detectCalls).toHaveLength(2)

    // Фильтр классов тоже мгновенный
    const lightning = getByText('label', 'Удар молнии').querySelector('input')
    if (!lightning) throw new Error('Нет чекбокса класса')
    await click(lightning)
    await waitFor(() => expect(text()).toContain('Показано 2 из 3'))
  })

  it('уход с экрана останавливает анализ', async () => {
    const info = vi.spyOn(toast, 'info')
    let cancelled = 0
    engine.detect = (_image, _opts, onProgress): DetectHandle => {
      onProgress?.({ tile: 3, tiles: 10 })
      let reject: (e: Error) => void = () => {}
      const promise = new Promise<DetectResult>((_res, rej) => {
        reject = rej
      })
      return {
        promise,
        cancel: () => {
          cancelled++
          reject(new DetectCancelledError())
        },
      }
    }
    await missionWithPhotos(['a.jpg'])
    await render(createElement(Detection))
    await waitFor(() => expect(buttonByText('Анализировать все (1)').disabled).toBe(false))
    await click(buttonByText('Анализировать все (1)'))
    await waitFor(() => expect(text()).toContain('Фото 1 из 1 · фрагмент 4 из 10'))
    expect(analysisRunner.getSnapshot().run).not.toBeNull()

    await cleanup()
    expect(cancelled).toBe(1)
    await vi.waitFor(() => expect(analysisRunner.getSnapshot().run).toBeNull())
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith('Анализ остановлен. Разобрано фото: 0'))
    // Отменённое фото не помечается ни разобранным, ни ошибкой
    expect((await db.photos.toArray()).map((p) => p.analysis)).toEqual([undefined])
  })

  it('опасность и «проверено» сохраняются в базу; опасность 4–5 подсвечена', async () => {
    const m = await missionWithPhotos(['a.jpg'])
    const [p] = await photos.listByMission(m.id)
    await photos.saveAnalysis(
      p.id,
      { status: 'done', modelName: 'm', modelVersion: '1', backend: 'wasm', analyzedAt: '2026-09-24T12:00:00Z', minConfidence: 0.1, iou: 0.7, tiles: 1, durationMs: 10 },
      [{ modelClass: 'hide_craze', defectClass: 'crack', confidence: 0.8, x: 0.1, y: 0.1, w: 0.1, h: 0.1, severity: 3, reviewed: false }],
    )
    await render(createElement(Detection))
    await waitFor(() => expect(text()).toContain('Показано 1 из 1'))

    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Опасность находки 1"]')
    if (!select) throw new Error('Нет выбора опасности')
    expect(select.className).not.toContain('text-red-800')
    await changeValue(select, '5', 'change')
    await waitFor(async () => expect((await db.detections.toArray())[0].severity).toBe(5))
    await waitFor(() => expect(document.querySelector('select[aria-label="Опасность находки 1"]')?.className).toContain('text-red-800'))

    const reviewed = document.querySelector<HTMLInputElement>('input[aria-label="Находка 1 проверена"]')
    if (!reviewed) throw new Error('Нет отметки «проверено»')
    await click(reviewed)
    await waitFor(async () => expect((await db.detections.toArray())[0].reviewed).toBe(true))
  })

  it('клик по рамке выделяет строку таблицы, клик по строке — рамку', async () => {
    const m = await missionWithPhotos(['a.jpg'])
    const [p] = await photos.listByMission(m.id)
    await photos.saveAnalysis(
      p.id,
      { status: 'done', modelName: 'm', modelVersion: '1', analyzedAt: '2026-09-24T12:00:00Z', minConfidence: 0.1, iou: 0.7, tiles: 1, durationMs: 10 },
      [
        { modelClass: 'hide_craze', defectClass: 'crack', confidence: 0.8, x: 0.1, y: 0.1, w: 0.1, h: 0.1, severity: 3, reviewed: false },
        { modelClass: 'corrosion', defectClass: 'corrosion', confidence: 0.6, x: 0.5, y: 0.5, w: 0.1, h: 0.1, severity: 3, reviewed: false },
      ],
    )
    await render(createElement(Detection))
    // Рамки только после load, в happy-dom шлём его сами
    await waitFor(() => expect(document.querySelector('img[alt="Снимок a.jpg"]')).toBeTruthy())
    expect(document.querySelectorAll('svg g[role="button"]')).toHaveLength(0)
    expect(text()).toContain('Загрузка изображения…')
    await act(async () => {
      document.querySelector('img[alt="Снимок a.jpg"]')?.dispatchEvent(new Event('load'))
    })
    await waitFor(() => expect(document.querySelectorAll('svg g[role="button"]')).toHaveLength(2))
    expect(text()).not.toContain('Загрузка изображения…')

    const box = document.querySelector<SVGGElement>('svg g[aria-label="Коррозия, уверенность 0,60"]')
    if (!box) throw new Error('Нет рамки')
    await act(async () => {
      box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(box.getAttribute('aria-pressed')).toBe('true')
    const row = (i: number) => document.querySelector<HTMLButtonElement>(`button[aria-label="Показать находку ${i} на снимке"]`)!
    expect(row(2).getAttribute('aria-pressed')).toBe('true')
    expect(row(1).getAttribute('aria-pressed')).toBe('false')

    await click(row(1))
    expect(document.querySelector('svg g[aria-label="Трещина, уверенность 0,80"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(box.getAttribute('aria-pressed')).toBe('false')
  })

  it('не изображение при загрузке — понятный тост, изображение добавляется', async () => {
    const error = vi.spyOn(toast, 'error')
    const success = vi.spyOn(toast, 'success')
    await missionWithPhotos([])
    await render(createElement(Detection))
    await waitFor(() => expect(text()).toContain('Перетащите фото облёта сюда'))

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('Нет поля выбора файлов')
    const files = [new File(['x'], 'report.pdf', { type: 'application/pdf' }), new File(['y'], 'DJI_0001.JPG', { type: 'image/jpeg' })]
    Object.defineProperty(input, 'files', { configurable: true, value: files })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(success).toHaveBeenCalledWith('Добавлено 1 фото'))
    expect(error).toHaveBeenCalledWith('Это не изображения, пропущены: report.pdf')
    await waitFor(() => expect(text()).toContain('DJI_0001.JPG'))
  })

  it('удаление фото — через подтверждение', async () => {
    const m = await missionWithPhotos(['a.jpg', 'b.jpg'])
    await render(createElement(Detection))
    await waitFor(() => expect(document.querySelector('button[aria-label="Удалить фото"]')).toBeTruthy())
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Удалить фото"]')!)
    expect(text()).toContain('Фото «a.jpg» и его находки будут удалены')
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => b.textContent === 'Удалить')
    if (!confirm) throw new Error('Нет кнопки подтверждения')
    await click(confirm)
    await waitFor(async () => expect((await photos.listByMission(m.id)).map((p) => p.fileName)).toEqual(['b.jpg']))
    // Выбрано соседнее фото
    await waitFor(() => expect(document.querySelector('h2')?.textContent).toBe('b.jpg'))
  })

  it('архивная миссия — только просмотр', async () => {
    const m = await missionWithPhotos(['a.jpg'])
    const [p] = await photos.listByMission(m.id)
    await photos.saveAnalysis(
      p.id,
      { status: 'done', modelName: 'm', modelVersion: '1', analyzedAt: '2026-09-24T12:00:00Z', minConfidence: 0.1, iou: 0.7, tiles: 1, durationMs: 10 },
      [{ modelClass: 'hide_craze', defectClass: 'crack', confidence: 0.8, x: 0.1, y: 0.1, w: 0.1, h: 0.1, severity: 3, reviewed: false }],
    )
    await missions.complete(m.id, { force: true })
    await missions.archive(m.id)
    await missions.setActive(m.id)
    await render(createElement(Detection))
    await waitFor(() => expect(text()).toContain('Миссия в архиве: фото и находки только для просмотра.'))
    expect(queryByText('button', 'Добавить фото')).toBeUndefined()
    expect(queryByText('button', 'Анализировать все')).toBeUndefined()
    expect(document.querySelector('button[aria-label="Удалить фото"]')).toBeNull()
    expect(queryByText('button', 'Удалить все фото')).toBeUndefined()
    await waitFor(() => expect(document.querySelector('select[aria-label="Опасность находки 1"]')).toBeTruthy())
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Опасность находки 1"]')?.disabled).toBe(true)
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Находка 1 проверена"]')?.disabled).toBe(true)
    expect(queryByText('button', 'Повторить анализ')).toBeUndefined()
    // Выгрузка у архивной миссии остаётся
    expect(buttonByText('JSON миссии').disabled).toBe(false)
  })
})
