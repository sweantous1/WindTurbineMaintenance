// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import i18n from '@/i18n'
import { db } from '@/storage/db'
import { missions } from '@/storage/missions'
import { cleanup, click, getByText, queryByText, render, waitFor } from '@/features/mission/__tests__/render'
import type { DroneProfile, Mission } from '@/domain/types'
import { createSimClock, type SimClock } from '../simClock'
import { buildSimData, type SimReady } from '../simData'
import SimPanel from '../SimPanel'
import SimControls from '../SimControls'
import FlightEndCard from '../FlightEndCard'
import type { CameraMode } from '../simView'
import Simulation from '@/pages/Simulation'
import { DRONE, FARM, HOUR, makeMission, ROUTE, WEATHER } from './fixtures'

// Сцена three.js в happy-dom не рисуется (нет WebGL): здесь проверяется всё вокруг неё
vi.mock('@/features/simulation/scene/SimulationCanvas', () => ({ default: () => null }))

beforeAll(async () => {
  await i18n.changeLanguage('ru')
})

beforeEach(() => {
  window.location.hash = '#/'
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
})

function ready(mission: Mission, drone: DroneProfile = DRONE): SimReady {
  const data = buildSimData(mission, drone)
  if (data.kind !== 'ready') throw new Error(`пробел ${data.gap}`)
  return data
}

async function seek(clock: SimClock, timeS: number) {
  await act(async () => {
    clock.seek(timeS)
  })
}

async function key(code: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init }))
  })
}

const text = () => document.body.textContent ?? ''

describe('панель 3D-облёта', () => {
  it('фаза, путь, время и осмотренные турбины следуют за часами', async () => {
    const data = ready(makeMission())
    const clock = createSimClock(data.trajectory.durationS)
    await render(createElement(SimPanel, { data, mission: makeMission(), drone: DRONE, clock }))
    expect(getByText('p', 'Взлёт')).toBeTruthy()
    expect(text()).toContain('0 из 2')
    expect(text()).toContain('0:00:00 из')

    const second = data.trajectory.visits[1]
    await seek(clock, (second.orbitStartS + second.orbitEndS) / 2)
    expect(getByText('p', 'Облёт турбины 2 из 2 — WTG-B')).toBeTruthy()
    expect(text()).toContain('1 из 2')
    // Текущая выделена, осмотренная — с галочкой
    const items = Array.from(document.querySelectorAll('ol button'))
    expect(items.map((b) => b.getAttribute('aria-current'))).toEqual([null, 'step'])
    expect(items[0].querySelector('[aria-label="осмотрена"]')).toBeTruthy()
    expect(items[1].querySelector('[aria-label="осмотрена"]')).toBeNull()

    await seek(clock, data.trajectory.durationS)
    expect(getByText('p', 'Облёт завершён')).toBeTruthy()
    expect(text()).toContain('2 из 2')
  })

  it('щелчок по турбине в порядке облёта переносит к началу перелёта к ней', async () => {
    const data = ready(makeMission())
    const clock = createSimClock(data.trajectory.durationS)
    await render(createElement(SimPanel, { data, mission: makeMission(), drone: DRONE, clock }))
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Перейти к турбине 2 — WTG-B"]')
    if (!button) throw new Error('нет кнопки турбины')
    await click(button)
    expect(clock.timeS()).toBeCloseTo(data.trajectory.visits[1].transitStartS, 9)
    expect(getByText('p', 'Перелёт к турбине 2 из 2 — WTG-B')).toBeTruthy()
  })

  it('заряд: полоса с резервом, ниже резерва — янтарный, ниже нуля — «не хватило бы» и число вылетов', async () => {
    // 35 мин полёта на 10 м/с — маршрут на пару километров укладывается с запасом
    const data = ready(makeMission())
    const clock = createSimClock(data.trajectory.durationS)
    await render(createElement(SimPanel, { data, mission: makeMission(), drone: DRONE, clock }))
    const meter = document.querySelector('[role="meter"]')
    expect(meter?.getAttribute('aria-valuenow')).toBe('100')
    expect(text()).toContain('резерв 20 %')
    expect(queryByText('p', 'Заряда не хватило бы')).toBeUndefined()
    expect(queryByText('[role="alert"]', 'не укладывается')).toBeUndefined()
    await cleanup()

    // Короткий полёт: весь маршрут дольше заряда
    const weak = { ...DRONE, enduranceMin: data.trajectory.durationS / 60 / 2 }
    const weakData = ready(makeMission(), weak)
    const weakClock = createSimClock(weakData.trajectory.durationS)
    await render(createElement(SimPanel, { data: weakData, mission: makeMission(), drone: weak, clock: weakClock }))
    expect(getByText('[role="alert"]', 'Маршрут не укладывается в один заряд: нужно 3 вылета')).toBeTruthy()
    // 45% пути — остаток 10%, ниже резерва 20%
    await seek(weakClock, weakData.trajectory.durationS * 0.45)
    expect(getByText('p', 'Ниже резерва')).toBeTruthy()
    expect(document.querySelector('[role="meter"] > div')?.className).toContain('bg-amber-500')
    await seek(weakClock, weakData.trajectory.durationS * 0.8)
    expect(getByText('p', 'Заряда не хватило бы')).toBeTruthy()
    expect(document.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('0')
  })

  it('без прогноза — объяснение и ссылка на погоду; с часом вылета — ветер, порывы и вердикт', async () => {
    const data = ready(makeMission())
    const clock = createSimClock(data.trajectory.durationS)
    await render(createElement(SimPanel, { data, mission: makeMission(), drone: DRONE, clock }))
    expect(text()).toContain('Нет прогноза на час вылета')
    expect(getByText('a', 'Выбрать час вылета').getAttribute('href')).toBe('#/weather')
    await cleanup()

    const withWeather = makeMission({ weather: WEATHER, departureTime: HOUR.time })
    const wData = ready(withWeather)
    await render(createElement(SimPanel, { data: wData, mission: withWeather, drone: DRONE, clock: createSimClock(wData.trajectory.durationS) }))
    expect(text()).toContain('Ветер на 90 м')
    expect(text()).toContain('Порывы на 90 м')
    expect(text()).toContain('15 °C')
    expect(document.querySelector('svg[role="img"][aria-label^="ветер"]')).toBeTruthy()
    // Маршрут с конфликтом — не «можно лететь», а «на грани»
    expect(getByText('[role="status"]', 'На грани')).toBeTruthy()
    expect(getByText('a', 'Подробнее').getAttribute('href')).toBe('#/weather')
  })

  it('конфликты маршрута — предупреждение со ссылкой на маршрут', async () => {
    const data = ready(makeMission())
    await render(createElement(SimPanel, { data, mission: makeMission(), drone: DRONE, clock: createSimClock(data.trajectory.durationS) }))
    const alert = getByText('[role="alert"]', 'слишком близко')
    expect(alert.textContent).toContain('1 отрезок маршрута проходит слишком близко к башне')
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('#/router')
    await cleanup()

    const clean = makeMission({ farm: { ...FARM, turbines: FARM.turbines.filter((t) => t.id !== 'c') } })
    const cleanData = ready(clean)
    await render(createElement(SimPanel, { data: cleanData, mission: clean, drone: DRONE, clock: createSimClock(cleanData.trajectory.durationS) }))
    expect(queryByText('[role="alert"]', 'слишком близко')).toBeUndefined()
  })

  it('легенда: дрон увеличен, атрибуция модели со ссылками', async () => {
    const data = ready(makeMission())
    await render(createElement(SimPanel, { data, mission: makeMission(), drone: DRONE, clock: createSimClock(data.trajectory.durationS) }))
    expect(text()).toContain('Дрон увеличен для наглядности: размах 7 м')
    const model = getByText('a', 'Drone')
    expect(model.getAttribute('href')).toBe('https://sketchfab.com/3d-models/drone-19d310dec81c446fba1a797903e083eb')
    expect(model.getAttribute('target')).toBe('_blank')
    expect(getByText('a', 'CC BY 4.0').getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(getByText('p', 'Модель дрона:').textContent).toContain('liz3d')
  })
})

describe('управление проигрыванием', () => {
  async function renderControls(over: { cameraMode?: CameraMode; groundMap?: boolean } = {}) {
    const data = ready(makeMission())
    const clock = createSimClock(data.trajectory.durationS)
    const onCameraMode = vi.fn()
    const onGroundMap = vi.fn()
    await render(
      createElement(SimControls, {
        clock,
        cameraMode: over.cameraMode ?? 'follow',
        onCameraMode,
        groundMap: over.groundMap ?? true,
        onGroundMap,
      }),
    )
    return { data, clock, onCameraMode, onGroundMap }
  }

  it('кнопка пуска и шкала времени', async () => {
    const { clock, data } = await renderControls()
    const play = document.querySelector<HTMLButtonElement>('button[aria-label="Воспроизвести"]')
    if (!play) throw new Error('нет кнопки пуска')
    await click(play)
    expect(clock.getSnapshot().playing).toBe(true)
    expect(document.querySelector('button[aria-label="Пауза"]')).toBeTruthy()

    const range = document.querySelector<HTMLInputElement>('input[type="range"]')
    if (!range) throw new Error('нет шкалы')
    expect(range.getAttribute('aria-label')).toBe('Время полёта')
    expect(range.step).toBe('1')
    expect(range.max).toBe(String(Math.ceil(data.trajectory.durationS)))
    await seek(clock, 125)
    expect(range.getAttribute('aria-valuetext')).toMatch(/^0:02:05 из \d+:\d\d:\d\d$/)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(range, '250')
      range.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(clock.timeS()).toBe(250)
  })

  it('клавиши: пробел, R, [ и ], C', async () => {
    const { clock, onCameraMode } = await renderControls()
    const speed = clock.getSnapshot().speed
    await key('Space')
    expect(clock.getSnapshot().playing).toBe(true)
    await key('Space')
    expect(clock.getSnapshot().playing).toBe(false)
    // Зажатая клавиша не дёргает пуск
    await key('Space', window, { repeat: true })
    expect(clock.getSnapshot().playing).toBe(false)

    await seek(clock, 200)
    await key('KeyR')
    expect(clock.timeS()).toBe(0)

    await key('BracketRight')
    expect(clock.getSnapshot().speed).toBeGreaterThan(speed)
    await key('BracketLeft')
    await key('BracketLeft')
    expect(clock.getSnapshot().speed).toBeLessThan(speed)

    await key('KeyC')
    expect(onCameraMode).toHaveBeenCalledWith('free')
  })

  it('клавиши не срабатывают в полях, на кнопках, при открытом окне и после preventDefault', async () => {
    const { clock } = await renderControls()
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Сначала"]')
    if (!button) throw new Error('нет кнопки')
    // Пробел на кнопке нажимает её саму — второй раз переключать нельзя
    await key('Space', button)
    expect(clock.getSnapshot().playing).toBe(false)
    const select = document.querySelector('select')
    if (!select) throw new Error('нет выбора скорости')
    await key('BracketRight', select)
    expect(clock.getSnapshot().speed).toBe(createSimClock(clock.getSnapshot().durationS).getSnapshot().speed)

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    await key('Space')
    expect(clock.getSnapshot().playing).toBe(false)
    dialog.remove()

    const handled = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true })
    handled.preventDefault()
    await act(async () => {
      window.dispatchEvent(handled)
    })
    expect(clock.getSnapshot().playing).toBe(false)
    await key('Space', window, { ctrlKey: true })
    expect(clock.getSnapshot().playing).toBe(false)

    await key('Space')
    expect(clock.getSnapshot().playing).toBe(true)
  })

  it('слушатель клавиатуры снимается при уходе с экрана', async () => {
    const { clock } = await renderControls()
    await cleanup()
    await key('Space')
    expect(clock.getSnapshot().playing).toBe(false)
  })

  it('скорость, режим камеры и карта на земле', async () => {
    const { clock, onCameraMode, onGroundMap } = await renderControls({ cameraMode: 'top' })
    const select = document.querySelector('select')
    if (!select) throw new Error('нет выбора скорости')
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['×1', '×5', '×10', '×20', '×50', '×100'])
    await act(async () => {
      select.value = '50'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(clock.getSnapshot().speed).toBe(50)

    const pressed = Array.from(document.querySelectorAll('button[aria-pressed]')).map((b) => [b.textContent, b.getAttribute('aria-pressed')])
    expect(pressed).toEqual([
      ['За дроном', 'false'],
      ['Свободная', 'false'],
      ['Сверху', 'true'],
    ])
    await click(getByText('button[aria-pressed]', 'За дроном'))
    expect(onCameraMode).toHaveBeenCalledWith('follow')

    const map = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!map) throw new Error('нет переключателя карты')
    expect(map.checked).toBe(true)
    expect(map.closest('label')?.textContent).toContain('Карта на земле')
    await click(map)
    expect(onGroundMap).toHaveBeenCalledWith(false)
    expect(text()).toContain('Пробел — пуск и пауза')
  })
})

describe('итоги облёта', () => {
  it('до полёта: итоги, «Смотреть снова» и «Завершить полёт…»', async () => {
    const data = ready(makeMission())
    const clock = createSimClock(data.trajectory.durationS)
    clock.seek(data.trajectory.durationS)
    const onComplete = vi.fn()
    await render(createElement(FlightEndCard, { trajectory: data.trajectory, mission: makeMission(), drone: DRONE, clock, onComplete }))
    expect(getByText('h2', 'Облёт завершён')).toBeTruthy()
    expect(text()).toContain('Израсходовано заряда')
    await click(getByText('button', 'Завершить полёт…'))
    expect(onComplete).toHaveBeenCalled()
    await click(getByText('button', 'Смотреть снова'))
    expect(clock.timeS()).toBe(0)
    expect(clock.getSnapshot().playing).toBe(true)
    await click(getByText('button', 'На главную'))
    expect(window.location.hash).toBe('#/')
  })

  it('после полёта — без завершения, с датой полёта', async () => {
    const flown = makeMission({ status: 'flown', completedAt: '2026-09-20T12:00:00Z' })
    const data = ready(flown)
    await render(createElement(FlightEndCard, { trajectory: data.trajectory, mission: flown, drone: DRONE, clock: createSimClock(1), onComplete: () => {} }))
    expect(queryByText('button', 'Завершить полёт')).toBeUndefined()
    expect(text()).toContain('Полёт уже завершён 20.09.2026')
  })
})

describe('экран 3D-облёта', () => {
  beforeEach(async () => {
    await db.open()
    await db.missions.clear()
    await db.settings.clear()
    localStorage.clear()
  })

  async function activeMission(over: Partial<Mission>): Promise<Mission> {
    const m = await missions.create({ name: 'Облёт юг' })
    return missions.update(m.id, over)
  }

  it('без фермы и без маршрута — объяснение со ссылкой на маршруты', async () => {
    const m = await activeMission({})
    await render(createElement(Simulation))
    await waitFor(() => expect(getByText('p', 'У миссии нет фермы')).toBeTruthy())
    expect(getByText('a', 'Открыть маршруты').getAttribute('href')).toBe('#/router')
    await missions.update(m.id, { farm: FARM })
    await waitFor(() => expect(getByText('p', 'Маршрут не построен')).toBeTruthy())
  })

  it('скорость дрона ноль — ссылка на настройки', async () => {
    await db.droneProfiles.put({ ...DRONE, id: 'slow', name: 'Стоячий', cruiseSpeedMs: 0 })
    try {
      const m = await missions.create({ name: 'Стоим', droneProfileId: 'slow' })
      await missions.update(m.id, { farm: FARM, route: ROUTE })
      await render(createElement(Simulation))
      await waitFor(() => expect(getByText('p', 'Не задана скорость дрона')).toBeTruthy())
      expect(getByText('a', 'Открыть настройки').getAttribute('href')).toBe('#/settings')
    } finally {
      await db.droneProfiles.delete('slow')
    }
  })

  it('облёт: пауза в начале, карта на земле запоминается, конец — итоги, завершение полёта из шапки', async () => {
    await activeMission({ farm: FARM, route: ROUTE })
    await render(createElement(Simulation))
    await waitFor(() => expect(getByText('h1', '3D-облёт')).toBeTruthy())
    await waitFor(() => expect(document.querySelector('button[aria-label="Воспроизвести"]')).toBeTruthy())
    expect(text()).toContain('Миссия: Облёт юг')
    expect(getByText('p', 'Взлёт')).toBeTruthy()
    expect(getByText('a', '© участники OpenStreetMap').getAttribute('href')).toBe('https://www.openstreetmap.org/copyright')

    await click(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
    expect(localStorage.getItem('wtm_sim_ground_map')).toBe('0')
    expect(queryByText('a', 'OpenStreetMap')).toBeUndefined()

    // Шкала в конец — поверх сцены итоги
    const range = document.querySelector<HTMLInputElement>('input[type="range"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(range, range.max)
      range.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(() => expect(getByText('h2', 'Облёт завершён')).toBeTruthy())

    // «Завершить полёт…» есть и в шапке экрана
    const buttons = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === 'Завершить полёт…')
    expect(buttons).toHaveLength(2)
    await click(buttons[0])
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy())
    expect(getByText('[role="dialog"] h3', 'Завершение полёта')).toBeTruthy()
  })

  it('после полёта — полоса «показ плана без изменений» и без кнопки завершения', async () => {
    const m = await activeMission({ farm: FARM, route: ROUTE })
    await missions.complete(m.id, { force: true })
    await missions.setActive(m.id)
    await render(createElement(Simulation))
    await waitFor(() => expect(text()).toContain('показ плана без изменений'))
    expect(queryByText('button', 'Завершить полёт')).toBeUndefined()
  })
})
