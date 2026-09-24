// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { toast } from 'react-toastify'
import i18n from '@/i18n'
import { db } from '@/storage/db'
import { missions } from '@/storage/missions'
import type { Farm, Mission, RoutePlan, WeatherSnapshot } from '@/domain/types'
import { planFor } from '@/features/route/routeLogic'
import CompleteMissionDialog from '../CompleteMissionDialog'
import NewMissionDialog from '../NewMissionDialog'
import MissionSettingsDialog from '../MissionSettingsDialog'
import MissionSwitcher from '../MissionSwitcher'
import Home from '@/pages/Home'
import History from '@/pages/History'
import { cleanup, click, getByText, getInput, queryByText, render, submit, typeInto, waitFor } from './render'

// Карточку прогноза делает другой шаг; здесь проверяется только главная вокруг неё
vi.mock('@/features/forecast/FlightForecastCard', () => ({ default: () => null }))

const route: RoutePlan = {
  algorithm: 'auto', params: {}, thetaMaxDeg: 180, returnToTakeoff: true,
  order: ['t1', 't2'], lengthM: 8_400, turnViolations: 0, source: 'auto', computedAt: '2026-09-24T10:00:00Z',
}
const weather: WeatherSnapshot = {
  fetchedAt: '2026-09-24T10:00:00Z', source: 'farm', location: { lat: 48.2, lon: 40.3 },
  timezone: 'Europe/Moscow', utcOffsetSeconds: 10800,
  current: { time: '2026-09-24T13:00', temperatureC: 15, windMs10: 4, windDirDeg10: 180, gustMs10: 7, weatherCode: 1, precipitationMm: 0 },
  hourly: [],
}

beforeAll(async () => {
  await i18n.changeLanguage('ru')
})

beforeEach(async () => {
  await db.open()
  await db.missions.clear()
  await db.settings.clear()
  localStorage.clear()
  window.location.hash = '#/'
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
})

const farm: Farm = {
  center: { lat: 48, lon: 40 },
  defaults: { hubHeightM: 100, rotorDiameterM: 120, safeDistanceM: 30 },
  turbines: [
    { id: 't1', name: 'T1', lat: 48, lon: 40 },
    { id: 't2', name: 'T2', lat: 48.01, lon: 40 },
  ],
}

async function pressEscape(el: Element) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

const form = () => {
  const f = document.querySelector('form')
  if (!f) throw new Error('Нет формы')
  return f
}

describe('новая миссия', () => {
  it('без названия не создаётся, с названием — создаётся активной, с тостом', async () => {
    const success = vi.spyOn(toast, 'success')
    const onClose = vi.fn()
    await render(createElement(NewMissionDialog, { isOpen: true, onClose }))

    await submit(form())
    expect(getByText('p', 'Введите название миссии')).toBeTruthy()
    expect(await db.missions.count()).toBe(0)

    await typeInto(getInput('new-mission-name'), '  Ростов, сентябрь ')
    await typeInto(getInput('new-mission-altitude'), '5')
    await submit(form())
    expect(getByText('p', 'Допустимо от 10 до 500')).toBeTruthy()
    expect(await db.missions.count()).toBe(0)

    await typeInto(getInput('new-mission-altitude'), '150,5')
    await waitFor(() => expect(getByText('p', 'выше потолка')).toBeTruthy())
    await submit(form())
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    const [m] = await db.missions.toArray()
    expect(m.name).toBe('Ростов, сентябрь')
    expect(m.flightAltitudeM).toBe(150.5)
    expect(m.status).toBe('draft')
    expect(await missions.getActiveId()).toBe(m.id)
    expect(success).toHaveBeenCalledWith('Миссия создана')
  })

  it('фокус сразу в названии, Escape закрывает окно', async () => {
    const onClose = vi.fn()
    await render(createElement(NewMissionDialog, { isOpen: true, onClose }))
    expect(document.activeElement).toBe(getInput('new-mission-name'))
    expect(getInput('new-mission-altitude').getAttribute('aria-describedby')).toBe('new-mission-altitude-hint')
    expect(document.getElementById('new-mission-altitude-hint')?.textContent).toContain('от 10 до 500 м')
    await pressEscape(getInput('new-mission-name'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('завершение полёта', () => {
  it('без маршрута и погоды предупреждает, после подтверждения завершает и ничего не удаляет', async () => {
    const success = vi.spyOn(toast, 'success')
    const m = await missions.create({ name: 'Ферма Юг' })
    await missions.update(m.id, { notes: 'важно' })
    const onClose = vi.fn()
    await render(createElement(CompleteMissionDialog, { mission: m, onClose }))

    await click(getByText('button', 'Завершить полёт'))
    await waitFor(() => expect(getByText('p', 'Нет маршрута и погоды — всё равно завершить?')).toBeTruthy())
    // Первый вызов без force ничего не пишет
    expect((await missions.get(m.id))?.status).toBe('draft')
    expect(success).not.toHaveBeenCalled()

    await click(getByText('button', 'Всё равно завершить'))
    await waitFor(() => expect(getByText('button', 'Открыть историю')).toBeTruthy())
    expect(getByText('button', 'Закрыть')).toBeTruthy()

    const saved = await missions.get(m.id)
    expect(saved?.status).toBe('flown')
    expect(saved?.completedAt).toBeTruthy()
    expect(saved?.notes).toBe('важно')
    expect(await missions.getActiveId()).toBeNull()
    expect(success).toHaveBeenCalledWith('Полёт завершён')

    await click(getByText('button', 'Открыть историю'))
    expect(onClose).toHaveBeenCalled()
    expect(window.location.hash).toBe('#/history')
  })

  it('с маршрутом и погодой завершает после одного подтверждения', async () => {
    const m = await missions.create({ name: 'Полная' })
    await missions.update(m.id, { route, weather, departureTime: '2026-09-24T15:00' })
    await render(createElement(CompleteMissionDialog, { mission: m, onClose: () => {} }))
    await click(getByText('button', 'Завершить полёт'))
    await waitFor(() => expect(getByText('button', 'Открыть историю')).toBeTruthy())
    expect(queryByText('p', 'всё равно завершить')).toBeUndefined()
    expect((await missions.get(m.id))?.status).toBe('flown')
  })

  it('пустой порядок облёта — не маршрут, прогноз без часа — не выбор: предупреждает, как шаги главной', async () => {
    const m = await missions.create({ name: 'Пустой маршрут' })
    await missions.update(m.id, { route: { ...route, order: [] }, weather })
    await render(createElement(CompleteMissionDialog, { mission: m, onClose: () => {} }))
    // Фокус на отмене, а не на необратимом действии
    expect(document.activeElement?.textContent).toBe('Отмена')
    await click(getByText('button', 'Завершить полёт'))
    await waitFor(() => expect(getByText('p', 'Нет маршрута и не выбран час вылета — всё равно завершить?')).toBeTruthy())
    expect((await missions.get(m.id))?.status).toBe('draft')
    expect(document.activeElement?.textContent).toBe('Отмена')
    await click(getByText('button', 'Всё равно завершить'))
    await waitFor(async () => expect((await missions.get(m.id))?.status).toBe('flown'))
  })

  it('тоста нет, если запись не удалась', async () => {
    const success = vi.spyOn(toast, 'success')
    const error = vi.spyOn(toast, 'error')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ghost: Mission = { ...(await missions.create({ name: 'Призрак' })), id: 'нет-такой' }
    await render(createElement(CompleteMissionDialog, { mission: ghost, onClose: () => {} }))
    await click(getByText('button', 'Завершить полёт'))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Не удалось завершить полёт: запись не сохранилась. Попробуйте ещё раз.'))
    expect(success).not.toHaveBeenCalled()
    expect(queryByText('button', 'Открыть историю')).toBeUndefined()
  })
})

describe('параметры миссии', () => {
  it('у облетанной миссии правится только название', async () => {
    const m = await missions.create({ name: 'Старая' })
    await missions.complete(m.id, { force: true })
    const flown = (await missions.get(m.id))!
    const onClose = vi.fn()
    await render(createElement(MissionSettingsDialog, { mission: flown, isOpen: true, onClose }))

    expect(getInput('mission-settings-altitude').disabled).toBe(true)
    expect(getInput('mission-limit-maxWindMs').disabled).toBe(true)
    expect(getInput('mission-settings-altitude').title).toContain('Менять можно только название')
    expect(getInput('mission-settings-name').disabled).toBe(false)

    await typeInto(getInput('mission-settings-name'), 'Старая, облетана')
    await submit(form())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const saved = await missions.get(m.id)
    expect(saved?.name).toBe('Старая, облетана')
    expect(saved?.limits).toEqual(flown.limits)
  })

  it('новая высота сразу пересчитывает длину маршрута', async () => {
    const lengthAt = (altM: number) => planFor({ farm, takeoff: farm.center, flightAltitudeM: altM, maxAltitudeM: 120 }, route.order, true).lengthM
    const m = await missions.create({ name: 'С маршрутом' })
    const withRoute = await missions.update(m.id, { farm, route: { ...route, lengthM: lengthAt(90) } })
    const onClose = vi.fn()
    await render(createElement(MissionSettingsDialog, { mission: withRoute, isOpen: true, onClose }))
    await waitFor(() => expect(document.getElementById('mission-settings-drone-hint')).toBeTruthy())
    await typeInto(getInput('mission-settings-altitude'), '60')
    await submit(form())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const saved = await missions.get(m.id)
    expect(saved?.flightAltitudeM).toBe(60)
    expect(saved?.route?.lengthM).toBeCloseTo(lengthAt(60), 6)
    expect(saved?.route?.order).toEqual(route.order)
  })

  it('ошибки лимитов не дают сохранить', async () => {
    const m = await missions.create({ name: 'Лимиты' })
    await render(createElement(MissionSettingsDialog, { mission: m, isOpen: true, onClose: () => {} }))
    await typeInto(getInput('mission-limit-minTempC'), '30')
    await typeInto(getInput('mission-limit-maxTempC'), '20')
    await submit(form())
    expect(getByText('p', 'Максимальная температура должна быть выше минимальной')).toBeTruthy()
    expect((await missions.get(m.id))?.limits.minTempC).toBe(-10)
  })

  it('если миссию успели завершить, показывает понятную ошибку блокировки', async () => {
    const error = vi.spyOn(toast, 'error')
    const m = await missions.create({ name: 'Гонка' })
    await render(createElement(MissionSettingsDialog, { mission: m, isOpen: true, onClose: () => {} }))
    // Форма открыта по снимку «до полёта», а миссию тем временем завершили
    await missions.complete(m.id, { force: true })
    await typeInto(getInput('mission-settings-altitude'), '100')
    await submit(form())
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Миссия уже облетана — эти поля только для чтения: высота полёта.'),
    )
    expect((await missions.get(m.id))?.flightAltitudeM).toBe(90)
  })
})

describe('переключатель миссий', () => {
  it('без миссий — кнопка создания; с миссиями — группы и выбор', async () => {
    await render(createElement(MissionSwitcher))
    await waitFor(() => expect(getByText('button', 'Создать миссию')).toBeTruthy())

    const a = await missions.create({ name: 'Первая' })
    await missions.complete(a.id, { force: true })
    await missions.create({ name: 'Вторая' })
    await waitFor(() => expect(getByText('button[aria-haspopup]', 'Вторая')).toBeTruthy())

    await click(getByText('button[aria-haspopup]', 'Вторая'))
    expect(getByText('[role="group"]', 'В работе').textContent).toContain('Вторая')
    expect(getByText('[role="group"]', 'Облетанные').textContent).toContain('Первая')
    expect(getByText('button[role="menuitem"]', 'Новая миссия')).toBeTruthy()

    await click(getByText('button[role="menuitemradio"]', 'Первая'))
    await waitFor(async () => expect(getByText('button[aria-haspopup]', 'Первая')).toBeTruthy())
    expect(await missions.getActiveId()).toBe(a.id)
  })
})

describe('главная', () => {
  it('без миссии приглашает создать первую', async () => {
    await render(createElement(Home))
    await waitFor(() => expect(getByText('h2', 'Создайте первую миссию')).toBeTruthy())
    expect(getByText('h3', 'Шаги миссии')).toBeTruthy()
  })

  it('с миссией — карточка, шаги и завершение', async () => {
    const m = await missions.create({ name: 'Ростов', flightAltitudeM: 95 })
    await missions.update(m.id, { route })
    await render(createElement(Home))
    await waitFor(() => expect(getByText('h2', 'Ростов')).toBeTruthy())
    expect(document.body.textContent).toContain('Маршрут готов')
    expect(document.body.textContent).toContain('95 м')
    expect(document.body.textContent).toContain('8,4 км')
    expect(document.body.textContent).toContain('скоро')
    expect(document.body.textContent).toContain('после полёта')

    await click(getByText('button', 'Завершить полёт'))
    await click(getByText('.fixed button', 'Завершить полёт'))
    await waitFor(() => expect(getByText('p', 'Нет погоды — всё равно завершить?')).toBeTruthy())
    await click(getByText('button', 'Всё равно завершить'))
    // Активная миссия сброшена, а диалог остаётся открытым до «Закрыть»
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Закрыть'))
    await waitFor(() => expect(getByText('.fixed button', 'Открыть историю')).toBeTruthy())
    await waitFor(() => expect(getByText('h2', 'Нет активной миссии')).toBeTruthy())
    expect(getByText('.fixed p', 'Полёт по миссии «Ростов» завершён')).toBeTruthy()
    await click(getByText('.fixed button', 'Закрыть'))
    expect(document.querySelector('.fixed')).toBeNull()
  })
})

describe('история', () => {
  async function seed() {
    const flown = await missions.create({ name: 'Облетанная <b>ферма</b>' })
    await missions.complete(flown.id, { force: true })
    const archived = await missions.create({ name: 'Архивная' })
    await missions.complete(archived.id, { force: true })
    await missions.archive(archived.id)
    const draft = await missions.create({ name: 'Черновая' })
    return { flown, archived, draft }
  }

  const rows = () => Array.from(document.querySelectorAll('tbody tr'))

  it('настоящие миссии, фильтр запоминается, поиск по названию', async () => {
    await seed()
    await render(createElement(History))
    await waitFor(() => expect(rows().length).toBe(3))
    expect(document.body.textContent).not.toContain('примеры')

    await click(getByText('button[aria-pressed]', 'Облетанные'))
    expect(rows().length).toBe(1)
    expect(rows()[0].textContent).toContain('Облетанная <b>ферма</b>')
    expect(localStorage.getItem('wtm_history_filter')).toBe('flown')

    await click(getByText('button[aria-pressed]', 'Все'))
    await typeInto(document.querySelector<HTMLInputElement>('input[type="search"]')!, 'арх')
    expect(rows().length).toBe(1)
    expect(rows()[0].textContent).toContain('Архивная')
  })

  it('архив и удаление — через подтверждение', async () => {
    const { flown, draft } = await seed()
    await render(createElement(History))
    await waitFor(() => expect(rows().length).toBe(3))

    const rowOf = (name: string) => rows().find((r) => r.textContent?.includes(name))!
    // Диктор слышит у кнопки-значка и действие, и миссию
    expect(rowOf('Черновая').querySelector('button[title="Удалить"]')?.getAttribute('aria-label')).toBe('Удалить: «Черновая»')
    // В архив можно только облетанную
    expect(rowOf('Черновая').querySelector('button[title="В архив"]')).toBeNull()
    await click(rowOf('Облетанная').querySelector<HTMLButtonElement>('button[title="В архив"]')!)
    await click(getByText('.fixed button', 'В архив'))
    await waitFor(async () => expect((await missions.get(flown.id))?.status).toBe('archived'))

    await click(rowOf('Черновая').querySelector<HTMLButtonElement>('button[title="Удалить"]')!)
    expect(getByText('.fixed p', 'Отменить это нельзя')).toBeTruthy()
    // Escape — это отмена: миссия на месте
    await pressEscape(getByText('.fixed button', 'Отмена'))
    expect(document.querySelector('.fixed')).toBeNull()
    expect(await missions.get(draft.id)).toBeTruthy()
    await click(rowOf('Черновая').querySelector<HTMLButtonElement>('button[title="Удалить"]')!)
    await click(getByText('.fixed button', 'Удалить'))
    await waitFor(async () => expect(await missions.get(draft.id)).toBeUndefined())
    await waitFor(() => expect(rows().length).toBe(2))
  })

  it('«Открыть» делает миссию активной и ведёт на главную', async () => {
    const { flown } = await seed()
    window.location.hash = '#/history'
    await render(createElement(History))
    await waitFor(() => expect(rows().length).toBe(3))
    const row = rows().find((r) => r.textContent?.includes('Облетанная'))!
    await click(row.querySelector<HTMLButtonElement>('button[title="Открыть"]')!)
    await waitFor(async () => expect(await missions.getActiveId()).toBe(flown.id))
    expect(window.location.hash).toBe('#/')
  })

  it('без миссий — понятное пустое состояние', async () => {
    await render(createElement(History))
    await waitFor(() => expect(getByText('p', 'Миссий пока нет')).toBeTruthy())
    expect(getByText('button', 'HTML-отчёт').hasAttribute('disabled')).toBe(true)
  })
})
