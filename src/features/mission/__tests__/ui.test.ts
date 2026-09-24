// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useState, type ReactNode } from 'react'
import { toast } from 'react-toastify'
import i18n from '@/i18n'
import { db } from '@/storage/db'
import { missions } from '@/storage/missions'
import type { Farm, Mission, RoutePlan, WeatherSnapshot } from '@/domain/types'
import { DEFAULT_DRONE_PROFILE, LEGACY_DEFAULT_DRONE_NAME } from '@/domain/defaults'
import { planFor } from '@/features/route/routeLogic'
import Modal from '@/components/common/Modal'
import { loadMissionMenu } from '@/hooks/useMissions'
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

  it('неудачное «Сохранить» переводит фокус на первое поле с ошибкой', async () => {
    const m = await missions.create({ name: 'Фокус' })
    await render(createElement(MissionSettingsDialog, { mission: m, isOpen: true, onClose: () => {} }))
    const save = getByText('button[type="submit"]', 'Сохранить')
    await typeInto(getInput('mission-settings-altitude'), '5')
    save.focus()
    await submit(form())
    expect(document.activeElement).toBe(getInput('mission-settings-altitude'))

    // Ошибок несколько — фокус на первой сверху, её могло прокрутить из вида
    await typeInto(getInput('mission-settings-name'), '  ')
    save.focus()
    await submit(form())
    expect(document.activeElement).toBe(getInput('mission-settings-name'))
    expect(getInput('mission-settings-name').getAttribute('aria-describedby')).toBe('mission-settings-name-error')
  })

  it('дробные лимиты и высота — с запятой в русском интерфейсе', async () => {
    const m = await missions.create({ name: 'Дроби', flightAltitudeM: 150.5 })
    await render(createElement(MissionSettingsDialog, { mission: m, isOpen: true, onClose: () => {} }))
    expect(getInput('mission-limit-maxPrecipMmH').value).toBe('0,5')
    expect(getInput('mission-settings-altitude').value).toBe('150,5')
  })

  it('у облетанной миссии — дрон из снимка на момент полёта, а не текущий профиль', async () => {
    await db.droneProfiles.put({ ...DEFAULT_DRONE_PROFILE, id: 'p-snap', name: 'Мавик', maxWindMs: 12, maxAltitudeM: 60 })
    try {
      const m = await missions.create({ name: 'Со снимком', droneProfileId: 'p-snap' })
      await missions.complete(m.id, { force: true })
      // После полёта профиль в настройках переименовали и поменяли
      await db.droneProfiles.put({ ...DEFAULT_DRONE_PROFILE, id: 'p-snap', name: 'Мавик v2', maxWindMs: 8, maxAltitudeM: 150 })
      const flown = (await missions.get(m.id))!
      await render(createElement(MissionSettingsDialog, { mission: flown, isOpen: true, onClose: () => {} }))
      await waitFor(() => expect(document.getElementById('mission-settings-drone-hint')).toBeTruthy())
      const select = document.getElementById('mission-settings-drone') as HTMLSelectElement
      expect(select.disabled).toBe(true)
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Мавик'])
      const hint = document.getElementById('mission-settings-drone-hint')!.textContent
      expect(hint).toContain('Ветер до 12 м/с')
      expect(hint).toContain('потолок 60 м')
      expect(document.body.textContent).toContain('у дрона: 12 м/с, 15 м/с, 60 м')
      expect(document.body.textContent).not.toContain('Мавик v2')
    } finally {
      await db.droneProfiles.delete('p-snap')
    }
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

  it('читает только миссии в работе и последние облетанные, остальные — счётчиком', async () => {
    for (let i = 1; i <= 10; i++) {
      const m = await missions.create({ name: `Облёт ${i}` })
      await missions.complete(m.id, { force: true })
    }
    await missions.create({ name: 'Черновик А' })
    await missions.create({ name: 'Черновик Б' })

    const menu = await loadMissionMenu(8)
    expect(menu.inWork.map((m) => m.name).sort()).toEqual(['Черновик А', 'Черновик Б'])
    expect(menu.flown).toHaveLength(8)
    expect(menu.flown.every((m) => m.status === 'flown')).toBe(true)
    expect(menu.flownTotal).toBe(10)

    await render(createElement(MissionSwitcher))
    await waitFor(() => expect(getByText('button[aria-haspopup]', 'Черновик Б')).toBeTruthy())
    await click(getByText('button[aria-haspopup]', 'Черновик Б'))
    expect(document.querySelectorAll('[role="group"] button[role="menuitemradio"]')).toHaveLength(10)
    expect(getByText('button[role="menuitem"]', 'Ещё 2 — в истории')).toBeTruthy()
  })

  it('пункт с фокусом выделен кольцом, а выбранная миссия не теряет подсветку', async () => {
    await missions.create({ name: 'Первая' })
    await missions.create({ name: 'Вторая' })
    await render(createElement(MissionSwitcher))
    await waitFor(() => expect(getByText('button[aria-haspopup]', 'Вторая')).toBeTruthy())
    await click(getByText('button[aria-haspopup]', 'Вторая'))
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    expect(items.length).toBe(3)
    for (const item of items) {
      expect(item.className).toContain('focus-visible:ring-2')
      // Фон при фокусе почти не отличался от белого и перекрывал голубую подсветку выбранной
      expect(item.className).not.toMatch(/(^|\s)focus:bg-/)
    }
    expect(getByText('button[role="menuitemradio"]', 'Вторая').className).toContain('bg-blue-50')
  })

  it('без активной миссии в узкой шапке — короткая подпись, полная — в подсказке', async () => {
    await missions.create({ name: 'Одна' })
    await missions.setActive(null)
    await render(createElement(MissionSwitcher))
    await waitFor(() => expect(document.querySelector('button[aria-haspopup]')).toBeTruthy())
    const button = document.querySelector<HTMLButtonElement>('button[aria-haspopup]')!
    expect(button.getAttribute('aria-label')).toBe('Выберите миссию')
    expect(button.title).toBe('Выберите миссию')
    const short = Array.from(button.querySelectorAll('span')).find((el) => el.textContent === 'Выбрать')
    expect(short?.className).toContain('xl:hidden')
  })
})

describe('главная', () => {
  it('без миссии приглашает создать первую', async () => {
    await render(createElement(Home))
    await waitFor(() => expect(getByText('h2', 'Создайте первую миссию')).toBeTruthy())
    expect(getByText('h3', 'Шаги миссии')).toBeTruthy()
  })

  it('час вылета выбран — не «готова к полёту»: нейтральная плашка и отсылка к прогнозу полёта', async () => {
    const m = await missions.create({ name: 'С часом' })
    await missions.update(m.id, { route, weather, departureTime: '2026-09-24T15:00' })
    await render(createElement(Home))
    await waitFor(() => expect(getByText('h2', 'С часом')).toBeTruthy())
    const badge = getByText('span', 'Час вылета выбран')
    expect(badge.className).not.toMatch(/green/)
    expect(document.body.textContent).not.toContain('Готова к полёту')
    // Шаг погоды выполнен, но рядом сказано, где смотреть, можно ли лететь
    const weatherStep = getByText('li', 'Погода и час вылета')
    expect(weatherStep.textContent).toContain('готово')
    expect(weatherStep.textContent).toContain('Можно ли лететь — в карточке «Прогноз полёта» ниже')
    // У других шагов отсылки нет
    expect(getByText('li', 'Маршрут').textContent).not.toContain('Прогноз полёта')
  })

  it('встроенный профиль дрона — на языке интерфейса: в карточке и в списке профилей', async () => {
    // В старых базах встроенный профиль лежит под прежним русским именем
    const saved = await db.droneProfiles.get(DEFAULT_DRONE_PROFILE.id)
    await db.droneProfiles.put({ ...DEFAULT_DRONE_PROFILE, name: LEGACY_DEFAULT_DRONE_NAME })
    await i18n.changeLanguage('en')
    try {
      await missions.create({ name: 'Drone name' })
      await render(createElement(Home))
      await waitFor(() => expect(getByText('h2', 'Drone name')).toBeTruthy())
      await waitFor(() => expect(getByText('dd', 'Quadcopter')).toBeTruthy())
      expect(document.body.textContent).not.toContain('Квадрокоптер')
      await cleanup()

      await render(createElement(NewMissionDialog, { isOpen: true, onClose: () => {} }))
      const select = document.getElementById('new-mission-drone') as HTMLSelectElement
      await waitFor(() => expect(Array.from(select.options).map((o) => o.textContent)).toContain('Quadcopter'))
      expect(Array.from(select.options).map((o) => o.textContent)).not.toContain(LEGACY_DEFAULT_DRONE_NAME)
    } finally {
      await i18n.changeLanguage('ru')
      if (saved) await db.droneProfiles.put(saved)
      else await db.droneProfiles.delete(DEFAULT_DRONE_PROFILE.id)
    }
  })

  it('пустые значения карточки читаемы: не блёклый серый', async () => {
    await missions.create({ name: 'Пустая' })
    await render(createElement(Home))
    await waitFor(() => expect(getByText('h2', 'Пустая')).toBeTruthy())
    const empty = getByText('dd span', 'не рассчитан')
    expect(empty.className).toContain('text-gray-600')
    expect(getByText('dt', 'Маршрут').className).not.toContain('text-gray-400')
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

  it('после закрытия окна подтверждения фокус возвращается на кнопку, которая его открыла', async () => {
    await seed()
    await render(createElement(History))
    await waitFor(() => expect(rows().length).toBe(3))
    const trash = rows()
      .find((r) => r.textContent?.includes('Черновая'))!
      .querySelector<HTMLButtonElement>('button[title="Удалить"]')!
    trash.focus()
    await click(trash)
    // В окне autoFocus на «Отмене» — раньше Modal запоминал именно её
    expect(document.activeElement?.textContent).toBe('Отмена')
    await pressEscape(getByText('.fixed button', 'Отмена'))
    expect(document.querySelector('.fixed')).toBeNull()
    expect(document.activeElement).toBe(trash)
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

describe('окно и фокус', () => {
  // children в Modal обязательный, а createElement передаёт их третьим аргументом — типы этого не видят
  const Dialog = Modal as (props: { isOpen: boolean; onClose: () => void; title: string; children?: ReactNode }) => ReactNode

  // Кнопка исчезает, пока окно открыто (пункт меню, карточка завершённой миссии)
  function VanishingOpener() {
    const [open, setOpen] = useState(false)
    return createElement(
      'main',
      { tabIndex: -1 },
      open ? null : createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Открыть окно'),
      createElement(
        Dialog,
        { isOpen: open, onClose: () => setOpen(false), title: 'Окно' },
        createElement('button', { type: 'button', autoFocus: true }, 'Внутри'),
      ),
    )
  }

  it('если открывшей кнопки уже нет, фокус уходит на основную область, а не в body', async () => {
    await render(createElement(VanishingOpener))
    const opener = getByText('button', 'Открыть окно')
    opener.focus()
    await click(opener)
    expect(document.activeElement?.textContent).toBe('Внутри')
    await pressEscape(getByText('button', 'Внутри'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('main'))
  })
})
