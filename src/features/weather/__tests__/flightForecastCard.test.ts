// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import i18n from '@/i18n'
import forecast from '@/domain/__tests__/fixtures/openMeteo-48.215_40.284-24h.json'
import { DEFAULT_DRONE_PROFILE, DEFAULT_FARM_DEFAULTS, DEFAULT_LIMITS, LEGACY_DEFAULT_DRONE_NAME } from '@/domain/defaults'
import type { Farm, Mission, RoutePlan } from '@/domain/types'
import { normalizeForecast } from '@/domain/weather'
import { offsetGeo } from '@/lib/geo'
import { db } from '@/storage/db'
import FlightForecastCard from '@/features/forecast/FlightForecastCard'
import { cleanup, queryByText, render, waitFor } from '@/features/mission/__tests__/render'

const CENTER = { lat: 48.215, lon: 40.284 }

function farmAt(center: typeof CENTER): Farm {
  return {
    name: 'Тестовая',
    center,
    defaults: { ...DEFAULT_FARM_DEFAULTS },
    turbines: [
      { id: 't1', name: 'T1', ...offsetGeo(center, -600, 0) },
      { id: 't2', name: 'T2', ...offsetGeo(center, 600, 0) },
    ],
  }
}

const route: RoutePlan = {
  algorithm: 'auto',
  params: {},
  thetaMaxDeg: 180,
  returnToTakeoff: true,
  order: ['t1', 't2'],
  lengthM: 0,
  turnViolations: 0,
  source: 'auto',
  computedAt: '2026-09-24T16:00:00.000Z',
}

const weather = normalizeForecast(forecast, { source: 'farm', farmCenter: CENTER, fetchedAt: '2026-09-24T16:20:00.000Z' })
// 2026-09-25T10:00 по Москве = 07:00Z
const departure = weather.hourly[15].time

function mission(patch: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    schemaVersion: 1,
    name: 'Облёт',
    type: 'planned',
    status: 'ready',
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
    droneProfileId: DEFAULT_DRONE_PROFILE.id,
    flightAltitudeM: 90,
    limits: { ...DEFAULT_LIMITS },
    farm: farmAt(CENTER),
    takeoff: offsetGeo(CENTER, -900, -200),
    route,
    weather,
    departureTime: departure,
    ...patch,
  }
}

const PAST = 'Выбранный час вылета уже прошёл.'

beforeAll(async () => {
  await i18n.changeLanguage('ru')
})

beforeEach(async () => {
  await db.open()
  await db.droneProfiles.clear()
  await db.droneProfiles.put({ ...DEFAULT_DRONE_PROFILE, name: LEGACY_DEFAULT_DRONE_NAME })
})

afterEach(async () => {
  await cleanup()
})

async function renderCard(m: Mission, now?: Date) {
  await render(createElement(FlightForecastCard, { mission: m, ...(now ? { now } : {}) }))
  // ждём, пока подгрузится профиль дрона
  await waitFor(() => expect(document.querySelector('[role="status"]')).toBeTruthy())
}

describe('карточка прогноза полёта', () => {
  it('«час вылета прошёл» считается по часам экрана, если они переданы', async () => {
    await renderCard(mission(), new Date('2026-09-25T06:30:00Z'))
    expect(queryByText('p', PAST)).toBeUndefined()
    await cleanup()

    await renderCard(mission(), new Date('2026-09-25T08:30:00Z'))
    expect(queryByText('p', PAST)).toBeTruthy()
  })

  it('прогноз далеко от нынешней фермы — предупреждение и не «Можно лететь»', async () => {
    const now = new Date('2026-09-24T17:00:00Z')
    await renderCard(mission(), now)
    expect(queryByText('p', 'Прогноз получен для места')).toBeUndefined()
    await cleanup()

    const moved = offsetGeo(CENTER, 0, 400_000)
    await renderCard(mission({ farm: farmAt(moved), takeoff: offsetGeo(moved, -900, -200) }), now)
    expect(queryByText('p', 'Прогноз получен для места в 40')).toBeTruthy()
    expect(queryByText('span', 'Можно лететь')).toBeUndefined()
  })

  it('встроенный профиль подписан переведённым именем', async () => {
    await i18n.changeLanguage('en')
    await renderCard(mission(), new Date('2026-09-24T17:00:00Z'))
    expect(queryByText('span', 'Drone profile: Quadcopter')).toBeTruthy()
    await i18n.changeLanguage('ru')
  })
})
