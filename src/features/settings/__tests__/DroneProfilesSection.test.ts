// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { toast } from 'react-toastify'
import i18n from '@/i18n'
import { DEFAULT_DRONE_PROFILE, LEGACY_DEFAULT_DRONE_NAME } from '@/domain/defaults'
import { db } from '@/storage/db'
import { missions } from '@/storage/missions'
import { cleanup, click, getByText, queryByText, render, submit, typeInto, waitFor } from '@/features/mission/__tests__/render'
import DroneProfilesSection from '../DroneProfilesSection'
import { setDroneDraft } from '../droneDraft'

beforeAll(async () => {
  await i18n.changeLanguage('ru')
})

beforeEach(async () => {
  await db.open()
  await db.droneProfiles.clear()
  await db.droneProfiles.put({ ...DEFAULT_DRONE_PROFILE })
  await db.missions.clear()
  await db.settings.clear()
  setDroneDraft(null)
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
  await i18n.changeLanguage('ru')
})

// Поле формы по началу подписи: id полей строит useId
function field(label: string): HTMLInputElement {
  const l = Array.from(document.querySelectorAll('label')).find((e) => e.textContent?.startsWith(label))
  const input = l && document.getElementById(l.htmlFor)
  if (!(input instanceof HTMLInputElement)) throw new Error(`Нет поля «${label}»`)
  return input
}

function form(): HTMLFormElement {
  const f = document.querySelector('form')
  if (!f) throw new Error('Нет формы')
  return f
}

function dialog(): HTMLElement {
  const d = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!d) throw new Error('Нет окна')
  return d
}

describe('профили дронов', () => {
  it('после сохранения профиля пересчитываются длины маршрутов его миссий', async () => {
    const recompute = vi.spyOn(missions, 'recomputeRouteLengths')
    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Потолок высоты').value).toBe('120'))
    await typeInto(field('Потолок высоты'), '80')
    await submit(form())
    await waitFor(() => expect(recompute).toHaveBeenCalledWith(DEFAULT_DRONE_PROFILE.id))
    expect((await db.droneProfiles.get(DEFAULT_DRONE_PROFILE.id))?.maxAltitudeM).toBe(80)
  })

  it('после удаления профиля пересчитываются миссии, которые на нём были', async () => {
    const recompute = vi.spyOn(missions, 'recomputeRouteLengths')
    await db.droneProfiles.put({ ...DEFAULT_DRONE_PROFILE, id: 'mavic', name: 'Mavic 3E' })
    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(getByText('button', 'Mavic 3E')).toBeTruthy())
    await click(getByText('button', 'Mavic 3E'))
    await waitFor(() => expect(field('Название').value).toBe('Mavic 3E'))
    await click(getByText('button', 'Удалить'))
    await click(Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent === 'Удалить')!)
    await waitFor(() => expect(recompute).toHaveBeenCalledWith('mavic'))
    expect(await db.droneProfiles.get('mavic')).toBeUndefined()
  })

  // cleanup() здесь как переход по шапке: секция размонтируется
  it('несохранённые правки переживают уход с экрана', async () => {
    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Макс. ветер').value).toBe('12'))
    await typeInto(field('Макс. ветер'), '10,5')
    await cleanup()

    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Макс. ветер').value).toBe('10,5'))
    expect(getByText('p', 'Есть несохранённые изменения')).toBeTruthy()

    // "Отменить изменения" стирает и черновик
    await click(getByText('button', 'Отменить изменения'))
    expect(field('Макс. ветер').value).toBe('12')
    await cleanup()
    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Макс. ветер').value).toBe('12'))
    expect(queryByText('p', 'Есть несохранённые изменения')).toBeUndefined()
  })

  it('правки к профилю, который с тех пор изменили, не подставляются', async () => {
    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Макс. ветер').value).toBe('12'))
    await typeInto(field('Макс. ветер'), '10')
    await cleanup()
    await db.droneProfiles.update(DEFAULT_DRONE_PROFILE.id, { maxWindMs: 11 })

    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Макс. ветер').value).toBe('11'))
  })

  it('дроби в полях — через запятую в русском интерфейсе', async () => {
    await db.droneProfiles.update(DEFAULT_DRONE_PROFILE.id, { maxWindMs: 12.5 })
    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Макс. ветер').value).toBe('12,5'))
  })

  it('встроенный профиль — на языке интерфейса, а сохранение не записывает перевод в базу', async () => {
    const success = vi.spyOn(toast, 'success')
    await db.droneProfiles.update(DEFAULT_DRONE_PROFILE.id, { name: LEGACY_DEFAULT_DRONE_NAME })
    await i18n.changeLanguage('en')
    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Name').value).toBe('Quadcopter'))
    expect(getByText('button', 'Quadcopter')).toBeTruthy()

    await typeInto(field('Max wind'), '11')
    await submit(form())
    await waitFor(() => expect(success).toHaveBeenCalledWith('Profile “Quadcopter” saved'))
    const stored = await db.droneProfiles.get(DEFAULT_DRONE_PROFILE.id)
    expect(stored?.name).toBe(LEGACY_DEFAULT_DRONE_NAME)
    expect(stored?.maxWindMs).toBe(11)
  })

  it('переименованный встроенный профиль показывается как назван', async () => {
    await db.droneProfiles.update(DEFAULT_DRONE_PROFILE.id, { name: 'Мой дрон' })
    await i18n.changeLanguage('en')
    await render(createElement(DroneProfilesSection))
    await waitFor(() => expect(field('Name').value).toBe('Мой дрон'))
  })
})
