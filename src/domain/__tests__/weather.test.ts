import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18next from 'i18next'
import forecastMs from './fixtures/openMeteo-48.215_40.284-24h.json'
import forecastKmh from './fixtures/openMeteo-kmh-3h.json'
import wmoRu from '@/i18n/features/wmo.ru.json'
import wmoEn from '@/i18n/features/wmo.en.json'
import type { WeatherHour, WeatherSnapshot, WindLevel } from '../types'
import {
  fetchWeatherSnapshot,
  findHour,
  gustAtAltitude,
  isStale,
  normalizeForecast,
  WeatherUnitsError,
  windAtAltitude,
} from '../weather'
import {
  buildForecastUrl,
  FETCH_TIMEOUT_MS,
  fetchForecastRaw,
  geocode,
  OpenMeteoError,
  type OpenMeteoErrorCode,
} from '@/services/openMeteo'
import { WMO_CODES, wmoKey } from '@/lib/wmo'

// Как в src/i18n/index.ts: экранирует React, не i18next.
// На весь файл, чтобы каждая ошибка проверялась и на перевод
beforeAll(async () => {
  await i18next.init({
    lng: 'ru',
    resources: { ru: { translation: wmoRu }, en: { translation: wmoEn } },
    interpolation: { escapeValue: false },
  })
})

// Сообщение переведено и все подстановки заполнены
function expectTranslated(e: unknown): void {
  expect(e).toBeInstanceOf(OpenMeteoError)
  const { message, i18nKey } = e as OpenMeteoError
  expect(message).not.toBe(i18nKey)
  expect(message).not.toContain('{{')
}

// Фикстура - реальный ответ Open-Meteo от 2026-09-24 на этот запрос (curl по buildForecastUrl)
const FIXTURE_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=48.215&longitude=40.284' +
  '&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,precipitation' +
  '&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,' +
  'wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_speed_180m,' +
  'wind_direction_10m,wind_direction_80m,wind_direction_120m,wind_direction_180m,' +
  'wind_gusts_10m,relative_humidity_2m,pressure_msl,cloud_cover,visibility' +
  '&wind_speed_unit=ms&timezone=auto&forecast_hours=24'

const FARM = { lat: 48.215, lon: 40.284 }
const LEVELS: WindLevel[] = ['10', '80', '120', '180']

const clone = <T>(x: T): T => structuredClone(x)
const snapshot = () => normalizeForecast(forecastMs, { source: 'farm', farmCenter: FARM, fetchedAt: '2026-09-24T16:20:00.000Z' })

function catchError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('ожидалась ошибка')
}

describe('запрос прогноза', () => {
  it('URL совпадает с тем, по которому снята фикстура', () => {
    expect(buildForecastUrl(FARM, 24)).toBe(FIXTURE_URL)
  })

  it('ветер всегда в м/с, время — местное', () => {
    const q = new URL(buildForecastUrl(FARM, 48)).searchParams
    expect(q.get('wind_speed_unit')).toBe('ms')
    expect(q.get('timezone')).toBe('auto')
  })

  it('часы прогноза ограничены 1..168', () => {
    const hours = (h: number) => new URL(buildForecastUrl(FARM, h)).searchParams.get('forecast_hours')
    expect(hours(0)).toBe('1')
    expect(hours(-5)).toBe('1')
    expect(hours(500)).toBe('168')
    expect(hours(Infinity)).toBe('168')
    expect(hours(23.2)).toBe('24')
    expect(hours(Number.NaN)).toBe('1')
    expect(hours(168)).toBe('168')
  })

  it('координаты вне диапазона — понятная ошибка, а не запрос', () => {
    for (const p of [
      { lat: 148.2, lon: 40 },
      { lat: 48, lon: 180.5 },
      { lat: Number.NaN, lon: 40 },
      { lat: 48, lon: -Infinity },
    ]) {
      const e = catchError(() => buildForecastUrl(p, 24))
      expect((e as OpenMeteoError).code).toBe('badPoint')
      expectTranslated(e)
    }
    // Границы диапазона допустимы, отрицательные координаты не теряют знак
    const q = new URL(buildForecastUrl({ lat: -90, lon: -180 }, 1)).searchParams
    expect([q.get('latitude'), q.get('longitude')]).toEqual(['-90', '-180'])
  })
})

describe('normalizeForecast на реальном ответе', () => {
  it('переносит поля и единицы', () => {
    const s = snapshot()
    expect(s.hourly).toHaveLength(24)
    expect(s.timezone).toBe('Europe/Moscow')
    expect(s.utcOffsetSeconds).toBe(10800)
    expect(s.source).toBe('farm')
    expect(s.fetchedAt).toBe('2026-09-24T16:20:00.000Z')
    // Точка прогноза - узел сетки модели
    expect(s.location).toEqual({ lat: 48.1875, lon: 40.3125 })
    // По сферическому закону косинусов: 3716,5 м от узла сетки до фермы
    expect(s.distanceToFarmM).toBeCloseTo(3716.5, 0)

    const first = s.hourly[0]
    expect(first.time).toBe('2026-09-24T19:00')
    expect(first.temperatureC).toBe(12.4)
    expect(first.windMs).toEqual({ '10': 0.32, '80': 1.08, '120': 1.71, '180': 2.43 })
    expect(first.windDirDeg).toEqual({ '10': 162, '80': 236, '120': 249, '180': 261 })
    expect(first.gustMs10).toBe(1.8)
    expect(first.humidityPct).toBe(85)
    expect(first.pressureHpa).toBe(1020.7)
    expect(first.cloudCoverPct).toBe(73)
    expect(first.weatherCode).toBe(2)

    expect(s.current).toEqual({
      time: '2026-09-24T19:15',
      temperatureC: 12.2,
      windMs10: 0.41,
      windDirDeg10: 166,
      gustMs10: 1.7,
      weatherCode: 1,
      precipitationMm: 0,
    })
  })

  it('видимость переводится из метров в километры', () => {
    const s = snapshot()
    expect(s.hourly[0].visibilityKm).toBeCloseTo(29.72, 9)
    expect(s.hourly[23].visibilityKm).toBeCloseTo(38.8, 9)
  })

  it('осадки и их вероятность не путаются', () => {
    const s = snapshot()
    const h = findHour(s, '2026-09-25T12:00')
    expect(h?.precipitationProbabilityPct).toBe(5)
    expect(h?.precipitationMm).toBe(0)
  })

  it('без фермы расстояния нет, имя точки сохраняется', () => {
    const s = normalizeForecast(forecastMs, { source: 'geocode', name: 'Каменск' })
    expect(s.distanceToFarmM).toBeUndefined()
    expect(s.location.name).toBe('Каменск')
    expect(Number.isNaN(Date.parse(s.fetchedAt))).toBe(false)
  })

  it('null допустим в любом почасовом поле', () => {
    const raw = clone(forecastMs) as unknown as { hourly: Record<string, (number | null)[] | string[]> }
    for (const [key, arr] of Object.entries(raw.hourly)) {
      if (key !== 'time') arr[3] = null as never
    }
    const h = normalizeForecast(raw, { source: 'manual' }).hourly[3]
    expect(h.windMs).toEqual({ '10': null, '80': null, '120': null, '180': null })
    expect(h.visibilityKm).toBeNull()
    expect(h.precipitationMm).toBeNull()
    expect(h.temperatureC).toBeNull()
    expect(h.gustMs10).toBeNull()
  })

  it('км/ч отвергаются — регрессия эталона', () => {
    const e = catchError(() => normalizeForecast(forecastKmh, { source: 'farm' }))
    expect(e).toBeInstanceOf(WeatherUnitsError)
    expect(e).toBeInstanceOf(OpenMeteoError)
    expect(e).toBeInstanceOf(Error)
    expect((e as WeatherUnitsError).code).toBe('units')
    expect((e as WeatherUnitsError).field).toBe('wind_speed_10m')
    expect((e as WeatherUnitsError).unit).toBe('km/h')
    expectTranslated(e)
  })

  type RawUnits = { hourly_units?: Record<string, string>; current_units?: Record<string, string>; hourly: Record<string, unknown> }

  it('без единиц ветра у земли прогноз не принимается — WeatherUnitsError', () => {
    const noWindUnit = clone(forecastMs) as unknown as RawUnits
    delete noWindUnit.hourly_units?.wind_speed_10m
    const noUnitsAtAll = clone(forecastMs) as unknown as RawUnits
    delete noUnitsAtAll.hourly_units

    for (const raw of [noWindUnit, noUnitsAtAll]) {
      const e = catchError(() => normalizeForecast(raw, { source: 'farm' }))
      expect(e).toBeInstanceOf(WeatherUnitsError)
      expect((e as WeatherUnitsError).field).toBe('wind_speed_10m')
      expect((e as WeatherUnitsError).unit).toBe('')
      expect((e as WeatherUnitsError).i18nKey).toBe('wmo.errors.unitsMissing')
      expectTranslated(e)
    }
  })

  it('ряд без единицы не принимается, отсутствующий ряд — просто null', () => {
    const noGustUnit = clone(forecastMs) as unknown as RawUnits
    delete noGustUnit.hourly_units?.wind_gusts_10m
    expect((catchError(() => normalizeForecast(noGustUnit, { source: 'farm' })) as WeatherUnitsError).field).toBe('wind_gusts_10m')

    const no120 = clone(forecastMs) as unknown as RawUnits
    delete no120.hourly_units?.wind_speed_120m
    delete no120.hourly.wind_speed_120m
    expect(normalizeForecast(no120, { source: 'farm' }).hourly[0].windMs['120']).toBeNull()
  })

  it.each([
    ['hourly_units', 'temperature_2m', '°F'],
    ['hourly_units', 'precipitation', 'inch'],
    ['hourly_units', 'visibility', 'ft'],
    ['hourly_units', 'wind_speed_180m', 'km/h'],
    ['hourly_units', 'wind_gusts_10m', 'kn'],
    ['current_units', 'wind_speed_10m', 'km/h'],
    ['current_units', 'wind_gusts_10m', 'mph'],
  ] as const)('%s.%s в «%s» — WeatherUnitsError', (group, field, unit) => {
    const raw = clone(forecastMs) as unknown as RawUnits
    const units = raw[group]
    if (!units) throw new Error('в фикстуре нет ' + group)
    units[field] = unit
    const e = catchError(() => normalizeForecast(raw, { source: 'farm' }))
    expect(e).toBeInstanceOf(WeatherUnitsError)
    expect((e as WeatherUnitsError).field).toBe(field)
    expect((e as WeatherUnitsError).unit).toBe(unit)
  })

  it('ряды разной длины и мусор — ошибка формы с путём', () => {
    const raw = clone(forecastMs) as unknown as { hourly: { visibility: number[] } }
    raw.hourly.visibility.pop()
    const e = catchError(() => normalizeForecast(raw, { source: 'farm' }))
    expect((e as OpenMeteoError).code).toBe('badShape')
    expect((e as OpenMeteoError).params.path).toBe('hourly.visibility')
    expectTranslated(e)

    expect((catchError(() => normalizeForecast('<html>', { source: 'farm' })) as OpenMeteoError).code).toBe('badShape')
    expect((catchError(() => normalizeForecast(null, { source: 'farm' })) as OpenMeteoError).code).toBe('badShape')
  })
})

function hour(wind: Partial<Record<WindLevel, number | null>>, gustMs10: number | null = null): WeatherHour {
  return {
    time: '2026-09-25T10:00',
    temperatureC: 15,
    precipitationMm: 0,
    precipitationProbabilityPct: 0,
    weatherCode: 0,
    windMs: { '10': null, '80': null, '120': null, '180': null, ...wind },
    windDirDeg: { '10': 0, '80': 0, '120': 0, '180': 0 },
    gustMs10,
    humidityPct: 50,
    pressureHpa: 1013,
    cloudCoverPct: 0,
    visibilityKm: 20,
  }
}

describe('ветер на высоте', () => {
  it('на уровнях модели совпадает с исходными значениями', () => {
    for (const h of snapshot().hourly) {
      for (const level of LEVELS) {
        expect(windAtAltitude(h, Number(level))).toEqual({ ms: h.windMs[level], extrapolated: false })
      }
    }
  })

  it('между уровнями монотонен и не выходит за соседние значения', () => {
    for (const h of snapshot().hourly) {
      for (let i = 0; i < LEVELS.length - 1; i++) {
        const lo = Number(LEVELS[i])
        const hi = Number(LEVELS[i + 1])
        const vLo = h.windMs[LEVELS[i]] as number
        const vHi = h.windMs[LEVELS[i + 1]] as number
        const sign = Math.sign(vHi - vLo)
        let prev = vLo
        for (let alt = lo + 1; alt <= hi; alt++) {
          const v = windAtAltitude(h, alt).ms as number
          expect(sign * (v - prev)).toBeGreaterThanOrEqual(-1e-12)
          expect(v).toBeGreaterThanOrEqual(Math.min(vLo, vHi) - 1e-12)
          expect(v).toBeLessThanOrEqual(Math.max(vLo, vHi) + 1e-12)
          prev = v
        }
      }
    }
  })

  it('интерполяция идёт по логарифму высоты', () => {
    const h = hour({ '10': 4, '80': 8, '120': 9, '180': 10 })
    // Середина 10..80 по ln(h) - среднее геометрическое высот
    expect(windAtAltitude(h, Math.sqrt(10 * 80)).ms).toBeCloseTo(6, 9)
  })

  it('ниже 10 м — степенной закон 0,14', () => {
    const h = hour({ '10': 5, '80': 8, '120': 9, '180': 10 })
    expect(windAtAltitude(h, 5)).toEqual({ ms: 5 * 0.5 ** 0.14, extrapolated: false })
    expect(windAtAltitude(h, 2).ms).toBeCloseTo(5 * 0.2 ** 0.14, 12)
    expect(windAtAltitude(h, 0).ms).toBe(0)
    expect(windAtAltitude(h, -3).ms).toBe(0)
    // Сшивка с уровнем 10 м без скачка
    expect(windAtAltitude(h, 9.999).ms).toBeCloseTo(5, 3)
  })

  it('выше 180 м — значение на 180 с пометкой', () => {
    const h = hour({ '10': 5, '80': 8, '120': 9, '180': 10 })
    expect(windAtAltitude(h, 250)).toEqual({ ms: 10, extrapolated: true })
    expect(windAtAltitude(h, 180.5)).toEqual({ ms: 10, extrapolated: true })
    expect(windAtAltitude(h, 180)).toEqual({ ms: 10, extrapolated: false })
    expect(windAtAltitude(h, 179.9).extrapolated).toBe(false)
  })

  it('пропуск в середине обходится соседями с данными — по ln(h) между 10 и 120', () => {
    const h = hour({ '10': 4, '120': 9, '180': 10 })
    expect(windAtAltitude(h, 80).ms).toBeCloseTo(4 + (5 * Math.log(8)) / Math.log(12), 9)
  })

  it('нет данных сверху или снизу — null, а не догадка', () => {
    expect(windAtAltitude(hour({ '10': 4 }), 90).ms).toBeNull()
    expect(windAtAltitude(hour({ '80': 6, '120': 7, '180': 8 }), 40).ms).toBeNull()
    expect(windAtAltitude(hour({ '80': 6, '120': 7, '180': 8 }), 5).ms).toBeNull()
    expect(windAtAltitude(hour({ '10': 4, '80': 6, '120': 7 }), 200).ms).toBeNull()
    expect(windAtAltitude(hour({ '10': 4, '80': 6, '120': 7 }), 180).ms).toBeNull()
    expect(windAtAltitude(hour({ '10': 4, '80': 6, '120': 7 }), 150).ms).toBeNull()
    expect(windAtAltitude(hour({}), 90).ms).toBeNull()
    expect(windAtAltitude(hour({ '10': 4 }), Number.NaN).ms).toBeNull()
    expect(windAtAltitude(hour({ '10': 4, '80': 6, '120': 7, '180': 8 }), Infinity).ms).toBeNull()
  })

  it('порыв на высоте — ветер на высоте плюс прибавка порыва у земли', () => {
    const h = hour({ '10': 4, '80': 6, '120': 8, '180': 9 }, 6)
    expect(gustAtAltitude(h, 120)).toBeCloseTo(10, 9)
    expect(gustAtAltitude(h, 10)).toBeCloseTo(6, 9)
    // Нет ветра на высоте - нет и порыва
    expect(gustAtAltitude(hour({ '10': 3 }, 5), 90)).toBeNull()
  })

  it('штиль у земли не раздувает порывы на высоте (ложное «нельзя» ночью)', () => {
    // 7 + 1.3 = 8.3, а не 7 * 2.3 = 16.1 (запрет при лимите 15)
    expect(gustAtAltitude(hour({ '10': 1, '80': 5, '120': 7, '180': 8 }, 2.3), 120)).toBeCloseTo(8.3, 9)
    expect(gustAtAltitude(hour({ '10': 0.3, '80': 1, '120': 1.5, '180': 2 }, 1.8), 80)).toBeCloseTo(2.5, 9)
    // Порыв у земли слабее ветра (шум модели): прибавки нет, но не ниже ветра на высоте
    expect(gustAtAltitude(hour({ '10': 4, '80': 5, '120': 7, '180': 8 }, 3), 120)).toBe(7)
    expect(gustAtAltitude(hour({ '10': 3, '80': 5, '120': 7, '180': 8 }, null), 120)).toBeNull()
  })
})

describe('поиск часа и устаревание', () => {
  it('findHour ищет по времени Open-Meteo', () => {
    const s = snapshot()
    expect(findHour(s, '2026-09-25T00:00')?.temperatureC).toBe(10.5)
    expect(findHour(s, '2027-01-01T00:00')).toBeUndefined()
    expect(findHour(s, undefined)).toBeUndefined()
  })

  it('isStale — старше трёх часов по умолчанию', () => {
    const s = { fetchedAt: '2026-09-24T10:00:00.000Z' } as WeatherSnapshot
    expect(isStale(s, new Date('2026-09-24T12:59:00Z'))).toBe(false)
    expect(isStale(s, new Date('2026-09-24T13:01:00Z'))).toBe(true)
    expect(isStale(s, new Date('2026-09-24T11:30:00Z'), 1)).toBe(true)
    expect(isStale({ fetchedAt: 'вчера' } as WeatherSnapshot)).toBe(true)
  })
})

describe('сеть Open-Meteo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // fetch, который завершается только отменой signal, как настоящий при обрыве
  const hangingFetch = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) reject(signal.reason)
      signal?.addEventListener('abort', () => reject(signal.reason))
    })

  const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
    const fn = vi.fn(impl)
    vi.stubGlobal('fetch', fn)
    return fn
  }

  it('отдаёт тело успешного ответа', async () => {
    const fn = stubFetch(async () => new Response(JSON.stringify(forecastMs), { status: 200 }))
    await expect(fetchForecastRaw(FARM, 24)).resolves.toEqual(forecastMs)
    expect(fn.mock.calls[0][0]).toBe(FIXTURE_URL)
  })

  it('HTTP-ошибка несёт reason из ответа', async () => {
    const reason = 'Latitude must be in range of -90 to 90°. Given: 148.215.'
    stubFetch(async () => new Response(JSON.stringify({ error: true, reason }), { status: 400 }))
    const e = await fetchForecastRaw(FARM, 24).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(OpenMeteoError)
    expect((e as OpenMeteoError).code).toBe('http')
    expect((e as OpenMeteoError).params).toEqual({ status: 400, reason })
    expect((e as OpenMeteoError).i18nKey).toBe('wmo.errors.http')
    expect((e as OpenMeteoError).message).toBe(`Open-Meteo вернул ошибку 400: ${reason}`)
  })

  it('HTTP-ошибка без JSON — статус и текст статуса', async () => {
    stubFetch(async () => new Response('<html>Bad Gateway</html>', { status: 502, statusText: '' }))
    const e = (await fetchForecastRaw(FARM, 24).catch((x: unknown) => x)) as OpenMeteoError
    expect(e.code).toBe('http')
    expect(e.params.status).toBe(502)
    expect(e.i18nKey).toBe('wmo.errors.httpStatus')
    expectTranslated(e)

    stubFetch(async () => new Response('<html></html>', { status: 503, statusText: 'Service Unavailable' }))
    const withText = (await fetchForecastRaw(FARM, 24).catch((x: unknown) => x)) as OpenMeteoError
    expect(withText.params).toEqual({ status: 503, reason: 'Service Unavailable' })
  })

  it('ответ 200 с {error: true} — тоже ошибка, а не прогноз', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: true, reason: 'Parameter x is invalid' }), { status: 200 }))
    const e = (await fetchForecastRaw(FARM, 24).catch((x: unknown) => x)) as OpenMeteoError
    expect(e.code).toBe('http')
    expect(e.params.reason).toBe('Parameter x is invalid')
  })

  it('сетевой сбой — ошибка network с причиной', async () => {
    const cause = new TypeError('fetch failed')
    stubFetch(async () => {
      throw cause
    })
    const e = (await fetchForecastRaw(FARM, 24).catch((x: unknown) => x)) as OpenMeteoError
    expect(e.code).toBe('network')
    expect(e.cause).toBe(cause)
    expectTranslated(e)
  })

  it('200 с нечитаемым телом — badJson', async () => {
    stubFetch(async () => new Response('not json', { status: 200 }))
    const e = (await fetchForecastRaw(FARM, 24).catch((x: unknown) => x)) as OpenMeteoError
    expect(e.code).toBe('badJson')
    expectTranslated(e)
  })

  it('отмена вызывающим пробрасывается как AbortError', async () => {
    stubFetch(hangingFetch)
    const ctrl = new AbortController()
    const pending = fetchForecastRaw(FARM, 24, ctrl.signal).catch((x: unknown) => x)
    ctrl.abort()
    const e = (await pending) as Error
    expect(e).not.toBeInstanceOf(OpenMeteoError)
    expect(e.name).toBe('AbortError')
  })

  it('зависший запрос — ошибка timeout, даже если передан свой signal', async () => {
    // AbortSignal.timeout не управляется фейковыми таймерами, поэтому подменяем сигнал, свой на каждый запрос
    let timer = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      timer = new AbortController()
      return timer.signal
    })
    stubFetch(hangingFetch)
    for (const signal of [undefined, new AbortController().signal]) {
      const pending = fetchForecastRaw(FARM, 24, signal).catch((x: unknown) => x)
      timer.abort(new DOMException('The operation timed out.', 'TimeoutError'))
      const e = (await pending) as OpenMeteoError
      expect(e).toBeInstanceOf(OpenMeteoError)
      expect(e.code).toBe('timeout')
      expect(e.params).toEqual({ seconds: FETCH_TIMEOUT_MS / 1000 })
      expectTranslated(e)
    }
    expect(timeoutSpy).toHaveBeenCalledWith(FETCH_TIMEOUT_MS)
  })

  it('fetchWeatherSnapshot: запрос по точке, разбор и расстояние до фермы', async () => {
    const fn = stubFetch(async () => new Response(JSON.stringify(forecastMs), { status: 200 }))
    const before = Date.now()
    const s = await fetchWeatherSnapshot(FARM, 24, { source: 'farm', name: 'Ферма', farmCenter: FARM })
    expect(fn.mock.calls[0][0]).toBe(FIXTURE_URL)
    expect(s.hourly).toHaveLength(24)
    expect(s.location).toEqual({ lat: 48.1875, lon: 40.3125, name: 'Ферма' })
    expect(s.distanceToFarmM).toBeCloseTo(3716.5, 0)
    const fetchedMs = Date.parse(s.fetchedAt)
    expect(fetchedMs).toBeGreaterThanOrEqual(before - 1000)
    expect(fetchedMs).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('fetchWeatherSnapshot: ответ в км/ч не принимается', async () => {
    stubFetch(async () => new Response(JSON.stringify(forecastKmh), { status: 200 }))
    await expect(fetchWeatherSnapshot(FARM, 3, { source: 'farm' })).rejects.toBeInstanceOf(WeatherUnitsError)
  })

  it('геокодер переводит поля и не ходит в сеть на пустой запрос', async () => {
    const fn = stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { id: 1, name: 'Ростов-на-Дону', latitude: 47.21997, longitude: 39.70769, country: 'Россия', admin1: 'Ростовская Область' },
              { id: 2, name: 'Nowhere', latitude: 1, longitude: 2 },
            ],
          }),
          { status: 200 },
        ),
    )
    await expect(geocode(' Ростов ', 'ru')).resolves.toEqual([
      { name: 'Ростов-на-Дону', lat: 47.21997, lon: 39.70769, country: 'Россия', admin1: 'Ростовская Область' },
      { name: 'Nowhere', lat: 1, lon: 2 },
    ])
    const url = new URL(fn.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search')
    expect(url.searchParams.get('name')).toBe('Ростов')
    expect(url.searchParams.get('language')).toBe('ru')

    await expect(geocode('  ', 'en')).resolves.toEqual([])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('геокодер: нет совпадений — пустой список', async () => {
    stubFetch(async () => new Response(JSON.stringify({ generationtime_ms: 0.1 }), { status: 200 }))
    await expect(geocode('qqqqzzzzxx', 'en')).resolves.toEqual([])
  })

  it('геокодер: один символ — без запроса, ошибки сервиса и мусор — понятные ошибки', async () => {
    const fn = stubFetch(async () => new Response(JSON.stringify({ error: true, reason: 'Invalid language' }), { status: 400 }))
    await expect(geocode(' a ', 'en')).resolves.toEqual([])
    expect(fn).not.toHaveBeenCalled()

    const http = (await geocode('Ростов', 'ru').catch((x: unknown) => x)) as OpenMeteoError
    expect(http.code).toBe('http')
    expect(http.params).toEqual({ status: 400, reason: 'Invalid language' })

    stubFetch(async () => new Response(JSON.stringify({ results: [{ name: 'X', latitude: '47' }] }), { status: 200 }))
    const shape = (await geocode('Ростов', 'ru').catch((x: unknown) => x)) as OpenMeteoError
    expect(shape.code).toBe('badShape')
    expect(shape.params.path).toBe('results.0.latitude')
    expectTranslated(shape)
  })
})

describe('словари WMO и ошибок', () => {
  type Dict = { wmo: Record<string, unknown> & { errors: Record<string, string> } }
  const ru = wmoRu as Dict
  const en = wmoEn as Dict
  const keysOf = (d: Record<string, unknown>) => Object.keys(d).sort()

  it('ключи для всех кодов и одинаковый набор в обоих языках', () => {
    for (const code of WMO_CODES) {
      expect(wmoKey(code)).toBe(`wmo.${code}`)
      expect(typeof ru.wmo[String(code)]).toBe('string')
      expect(typeof en.wmo[String(code)]).toBe('string')
    }
    expect(keysOf(ru.wmo)).toEqual(keysOf(en.wmo))
    expect(keysOf(ru.wmo.errors)).toEqual(keysOf(en.wmo.errors))
  })

  it('неизвестный или пустой код — wmo.unknown', () => {
    expect(wmoKey(4)).toBe('wmo.unknown')
    expect(wmoKey(null)).toBe('wmo.unknown')
    expect(wmoKey(undefined)).toBe('wmo.unknown')
  })

  it('подстановки {{…}} в ru и en совпадают', () => {
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(ru.wmo.errors)) {
      expect(vars(ru.wmo.errors[key]), key).toEqual(vars(en.wmo.errors[key]))
    }
  })

  it('у каждой ошибки есть перевод, и сообщение переводится', async () => {
    const codes: OpenMeteoErrorCode[] = ['badPoint', 'network', 'timeout', 'http', 'badJson', 'badShape', 'units']
    for (const code of codes) expect(ru.wmo.errors[code]).toBeTypeOf('string')
    expect(ru.wmo.errors.httpStatus).toBeTypeOf('string')
    expect(ru.wmo.errors.unitsMissing).toBeTypeOf('string')

    expect(i18next.t(wmoKey(95))).toBe('Гроза')
    expect(i18next.t(wmoKey(0))).toBe('Ясно')
    expect(i18next.t(wmoKey(4))).toBe('Условия неизвестны')
    expect(new OpenMeteoError('http', { status: 400, reason: 'bad' }).message).toBe('Open-Meteo вернул ошибку 400: bad')
    const units = catchError(() => normalizeForecast(forecastKmh, { source: 'farm' })) as Error
    expect(units.message).toBe('Open-Meteo прислал «wind_speed_10m» в «km/h» вместо «m/s» — прогноз не принят.')

    await i18next.changeLanguage('en')
    try {
      expect(new OpenMeteoError('network').message).toBe('Could not reach Open-Meteo. Check your internet connection.')
      expect(i18next.t(wmoKey(95))).toBe('Thunderstorm')
      // Текст фиксируется при создании ошибки, а i18nKey и params дают перевести её заново
      const e = new OpenMeteoError('timeout', { seconds: 20 })
      await i18next.changeLanguage('ru')
      expect(i18next.t(e.i18nKey, e.params)).toBe('Open-Meteo не ответил за 20 с. Попробуйте ещё раз.')
    } finally {
      await i18next.changeLanguage('ru')
    }
  })
})
