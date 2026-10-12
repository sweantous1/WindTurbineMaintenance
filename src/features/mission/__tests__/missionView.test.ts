// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from '@/i18n'
import { DEFAULT_LIMITS, FLIGHT_ALTITUDE_MAX_M as DOMAIN_ALT_MAX, FLIGHT_ALTITUDE_MIN_M as DOMAIN_ALT_MIN } from '@/domain/defaults'
import { FLIGHT_ALTITUDE_RANGE } from '@/features/route/optimizerParams'
import type { Farm, Mission, MissionStatus, RoutePlan, WeatherHour, WeatherSnapshot } from '@/domain/types'
import { planFor } from '@/features/route/routeLogic'
import {
  buildMissionsReportHtml,
  buildSettingsPatch,
  completionGaps,
  completionGapsKey,
  countByFilter,
  describeHourWeather,
  FLIGHT_ALTITUDE_MAX_M,
  FLIGHT_ALTITUDE_MIN_M,
  filterMissions,
  formatLocalHour,
  formatValue,
  LIMIT_RANGES,
  limitsToForm,
  localDateStamp,
  missionFileName,
  missionRow,
  parseDecimal,
  parseHistoryFilter,
  parseInRange,
  parseLimits,
  routeKm,
  STATUS_DOT,
  validateName,
  withRouteLength,
} from '../missionView'

let tRu: TFunction
let tEn: TFunction

beforeAll(async () => {
  await i18n.changeLanguage('ru')
  tRu = i18n.getFixedT('ru')
  tEn = i18n.getFixedT('en')
})

const route: RoutePlan = {
  algorithm: 'auto', params: {}, thetaMaxDeg: 180, returnToTakeoff: true,
  order: ['t1', 't2'], lengthM: 12_345, turnViolations: 0, source: 'auto', computedAt: '2026-09-24T10:00:00Z',
}

const hour = (over: Partial<WeatherHour> = {}): WeatherHour => ({
  time: '2026-09-24T14:00',
  temperatureC: 15.4,
  precipitationMm: 0,
  precipitationProbabilityPct: 0,
  weatherCode: 1,
  windMs: { '10': 4.23, '80': 6, '120': 7, '180': 8 },
  windDirDeg: { '10': 180, '80': 180, '120': 180, '180': 180 },
  gustMs10: 7,
  humidityPct: 60,
  pressureHpa: 1013,
  cloudCoverPct: 20,
  visibilityKm: 20,
  ...over,
})

const weather: WeatherSnapshot = {
  fetchedAt: '2026-09-24T10:00:00Z', source: 'farm', location: { lat: 48.2, lon: 40.3 },
  timezone: 'Europe/Moscow', utcOffsetSeconds: 10800,
  current: { time: '2026-09-24T13:00', temperatureC: 15, windMs10: 4, windDirDeg10: 180, gustMs10: 7, weatherCode: 1, precipitationMm: 0 },
  hourly: [hour()],
}

let seq = 0
function mission(over: Partial<Mission> = {}): Mission {
  seq++
  return {
    id: `m-${seq}-0000-0000`,
    schemaVersion: 1,
    name: `Миссия ${seq}`,
    type: 'planned',
    status: 'draft',
    createdAt: '2026-09-20T08:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z',
    droneProfileId: 'default',
    flightAltitudeM: 90,
    limits: { ...DEFAULT_LIMITS },
    ...over,
  }
}

describe('проверка полей формы', () => {
  it('дробные числа принимаются и с запятой', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal(' 7 ')).toBe(7)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('Infinity')).toBeNull()
  })

  it('диапазон: пусто, не число, вне диапазона, норма', () => {
    expect(parseInRange('', 10, 500)).toEqual({ ok: false, error: { key: 'mission.errors.required' } })
    expect(parseInRange('много', 10, 500)).toEqual({ ok: false, error: { key: 'mission.errors.notNumber' } })
    expect(parseInRange('5', 10, 500)).toEqual({ ok: false, error: { key: 'mission.errors.range', params: { min: 10, max: 500 } } })
    expect(parseInRange('500,0', 10, 500)).toEqual({ ok: true, value: 500 })
  })

  it('границы высоты — те же, что у экрана маршрута: высота оттуда проходит проверку здесь', () => {
    expect([FLIGHT_ALTITUDE_MIN_M, FLIGHT_ALTITUDE_MAX_M]).toEqual([DOMAIN_ALT_MIN, DOMAIN_ALT_MAX])
    expect(LIMIT_RANGES.maxAltitudeM).toEqual(FLIGHT_ALTITUDE_RANGE)
    expect(parseInRange(String(FLIGHT_ALTITUDE_RANGE.max), FLIGHT_ALTITUDE_MIN_M, FLIGHT_ALTITUDE_MAX_M).ok).toBe(true)
  })

  it('название обязательно, пробелы не считаются', () => {
    expect(validateName('   ')).toEqual({ key: 'mission.errors.nameRequired' })
    expect(validateName(' Ростов ')).toBeNull()
  })

  it('лимиты по умолчанию проходят проверку без изменений', () => {
    expect(parseLimits(limitsToForm(DEFAULT_LIMITS, 'ru'))).toEqual({ limits: DEFAULT_LIMITS, errors: {} })
    expect(parseLimits(limitsToForm(DEFAULT_LIMITS, 'en'))).toEqual({ limits: DEFAULT_LIMITS, errors: {} })
  })

  it('дробные лимиты в форме — с разделителем языка, как в полях маршрута', () => {
    expect(limitsToForm(DEFAULT_LIMITS, 'ru').maxPrecipMmH).toBe('0,5')
    expect(limitsToForm(DEFAULT_LIMITS, 'en').maxPrecipMmH).toBe('0.5')
    expect(limitsToForm({ ...DEFAULT_LIMITS, minTempC: -12.5 }, 'ru').minTempC).toBe('-12,5')
  })

  it('лимиты: порядок температур, порывы не слабее ветра, пустое поле', () => {
    const form = { ...limitsToForm(DEFAULT_LIMITS, 'ru'), minTempC: '20', maxTempC: '10', maxGustMs: '5', maxPrecipMmH: '' }
    const res = parseLimits(form)
    expect(res.limits).toBeNull()
    expect(res.errors.maxTempC?.key).toBe('mission.errors.tempOrder')
    expect(res.errors.maxGustMs?.key).toBe('mission.errors.gustBelowWind')
    expect(res.errors.maxPrecipMmH?.key).toBe('mission.errors.required')
  })
})

describe('патч параметров миссии', () => {
  const values = (m: Mission) => ({
    name: m.name, type: m.type, droneProfileId: m.droneProfileId, flightAltitudeM: m.flightAltitudeM, limits: { ...m.limits },
  })

  it('до полёта в патч попадают только изменённые поля', () => {
    const m = mission()
    expect(buildSettingsPatch(m, values(m))).toEqual({})
    const patch = buildSettingsPatch(m, { ...values(m), name: '  Новое  ', flightAltitudeM: 120, limits: { ...m.limits, maxWindMs: 10 } })
    expect(patch).toEqual({ name: 'Новое', flightAltitudeM: 120, limits: { ...DEFAULT_LIMITS, maxWindMs: 10 } })
  })

  it('облетанной миссии меняется только название, архивной — ничего', () => {
    const flown = mission({ status: 'flown' })
    const changed = { ...values(flown), name: 'Другое', type: 'emergency' as const, flightAltitudeM: 150, limits: { ...flown.limits, maxWindMs: 5 } }
    expect(buildSettingsPatch(flown, changed)).toEqual({ name: 'Другое' })
    expect(buildSettingsPatch(mission({ status: 'archived' }), changed)).toEqual({})
  })
})

describe('длина маршрута после смены высоты', () => {
  const farm: Farm = {
    center: { lat: 48, lon: 40 },
    defaults: { hubHeightM: 100, rotorDiameterM: 120, safeDistanceM: 30 },
    turbines: [
      { id: 't1', name: 'T1', lat: 48, lon: 40 },
      { id: 't2', name: 'T2', lat: 48.01, lon: 40 },
    ],
  }
  const lengthAt = (altM: number, ceilingM: number) =>
    planFor({ farm, takeoff: farm.center, flightAltitudeM: altM, maxAltitudeM: ceilingM }, route.order, true).lengthM
  const withFarm = (over: Partial<Mission> = {}) => mission({ farm, route: { ...route, lengthM: lengthAt(90, 120) }, ...over })

  it('новая высота и потолок пересчитывают длину, остальное в маршруте не трогается', () => {
    const m = withFarm()
    const patch = withRouteLength(m, { flightAltitudeM: 60 }, 120)
    expect(patch.flightAltitudeM).toBe(60)
    expect(patch.route).toEqual({ ...m.route, lengthM: lengthAt(60, 120) })
    // Потолок ниже высоты перелёта, дрон летит на потолке
    expect(withRouteLength(m, {}, 50).route?.lengthM).toBeCloseTo(lengthAt(90, 50), 6)
  })

  it('без изменений длины, без маршрута и после полёта патч не трогается', () => {
    expect(withRouteLength(withFarm(), { name: 'x' }, 120)).toEqual({ name: 'x' })
    expect(withRouteLength(mission({ farm }), { flightAltitudeM: 60 }, 120)).toEqual({ flightAltitudeM: 60 })
    expect(withRouteLength(withFarm({ status: 'flown' }), { name: 'x' }, 50)).toEqual({ name: 'x' })
    expect(withRouteLength(withFarm({ farm: undefined }), { flightAltitudeM: 60 }, 120)).toEqual({ flightAltitudeM: 60 })
  })
})

describe('чего не хватает для завершения', () => {
  it('те же правила, что у шагов главной', () => {
    expect(completionGaps({})).toEqual(['route', 'weather'])
    expect(completionGaps({ route: { ...route, order: [] }, weather })).toEqual(['route', 'departure'])
    expect(completionGaps({ route, weather })).toEqual(['departure'])
    expect(completionGaps({ route, weather, departureTime: '2026-09-24T14:00' })).toEqual([])
  })

  it('ключ предупреждения', () => {
    expect(completionGapsKey(['route'])).toBe('route')
    expect(completionGapsKey(['weather'])).toBe('weather')
    expect(completionGapsKey(['route', 'weather'])).toBe('both')
    expect(completionGapsKey(['departure'])).toBe('departure')
    expect(completionGapsKey(['route', 'departure'])).toBe('routeDeparture')
  })
})

describe('форматирование', () => {
  it('введённые значения — с разделителем языка и без лишних нулей', () => {
    expect(formatValue(150.5, 'ru')).toBe('150,5')
    expect(formatValue(150.5, 'en')).toBe('150.5')
    expect(formatValue(90, 'ru')).toBe('90')
    expect(formatValue(1200, 'ru')).toBe('1200')
    expect(formatValue(Number.NaN, 'ru')).toBe('—')
  })

  it('дата в имени файла — по местному времени', () => {
    expect(localDateStamp(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05')
  })

  it('погода на час из неполной записи не роняет таблицу', () => {
    const partial = { ...hour(), temperatureC: undefined, windMs: undefined } as unknown as WeatherHour
    expect(describeHourWeather(partial, tRu, 'ru')).toBe('Преимущественно ясно')
  })

  it('длина маршрута в км с одним знаком по языку', () => {
    expect(routeKm({ route }, 'ru')).toBe('12,3')
    expect(routeKm({ route }, 'en')).toBe('12.3')
    expect(routeKm({}, 'ru')).toBeNull()
    expect(routeKm({ route: { ...route, order: [] } }, 'ru')).toBeNull()
  })

  it('час вылета показывается во времени фермы, без сдвига в пояс компьютера', () => {
    expect(formatLocalHour('2026-09-24T14:00', 'ru')).toBe('24.09.2026, 14:00')
    expect(formatLocalHour('2026-09-24T14:00', 'en')).toMatch(/9\/24\/26,?\s2:00\sPM/)
    expect(formatLocalHour('завтра', 'ru')).toBe('завтра')
  })

  it('погода на час: температура, ветер на 10 м, описание по коду', () => {
    expect(describeHourWeather(hour(), tRu, 'ru')).toBe('15 °C · 4,2 м/с · Преимущественно ясно')
    expect(describeHourWeather(hour(), tEn, 'en')).toBe('15 °C · 4.2 m/s · Mainly clear')
    expect(describeHourWeather(hour({ temperatureC: -0.3 }), tRu, 'ru')).toMatch(/^0 °C/)
    const bare = hour({ temperatureC: null, windMs: { '10': null, '80': null, '120': null, '180': null }, weatherCode: 12345 })
    expect(describeHourWeather(bare, tRu, 'ru')).toBe('Условия неизвестны')
  })

  it('строка миссии для таблицы и отчёта', () => {
    const m = mission({
      status: 'ready', route, weather, departureTime: '2026-09-24T14:00',
      farm: { center: { lat: 48, lon: 40 }, defaults: { hubHeightM: 100, rotorDiameterM: 120, safeDistanceM: 30 }, turbines: [
        { id: 't1', name: 'T1', lat: 48, lon: 40 },
        { id: 't2', name: 'T2', lat: 48.01, lon: 40 },
      ] },
    })
    const r = missionRow(m, tRu, 'ru')
    // Статус только про данные, допуск к полёту даёт вердикт прогноза
    expect(r.status).toBe('Час вылета выбран')
    expect(missionRow(m, tEn, 'en').status).toBe('Departure set')
    expect(r.type).toBe('Плановая')
    expect(r.turbines).toBe(2)
    expect(r.routeKm).toBe('12,3')
    expect(r.departure).toBe('24.09.2026, 14:00')
    expect(r.weather).toBe('15 °C · 4,2 м/с · Преимущественно ясно')
    expect(r.completedAt).toBeNull()
    // Часа вылета нет в прогнозе: погоды нет, но сам час показывается
    const r2 = missionRow({ ...m, departureTime: '2026-09-25T09:00' }, tRu, 'ru')
    expect(r2.departure).toBe('25.09.2026, 09:00')
    expect(r2.weather).toBeNull()
  })

  it('даты создания и завершения — в формате языка интерфейса, а не системы', () => {
    const m = mission({ status: 'flown', completedAt: '2026-09-21T10:00:00Z' })
    const ru = missionRow(m, tRu, 'ru')
    const en = missionRow(m, tEn, 'en')
    expect(ru.createdAt).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)
    expect(ru.completedAt).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)
    expect(en.createdAt).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
    expect(en.completedAt).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
  })

  it('«Час вылета выбран» не красится в зелёный: допуск даёт только вердикт прогноза', () => {
    expect(STATUS_DOT.ready).not.toMatch(/green|emerald/)
    expect(STATUS_DOT.ready).not.toBe(STATUS_DOT.planned)
  })
})

describe('фильтр истории', () => {
  const statuses: MissionStatus[] = ['draft', 'planned', 'ready', 'flown', 'analyzed', 'archived']
  const list = statuses.map((status, i) => mission({ status, name: i === 0 ? 'Ёлкино поле' : `Ферма ${status}` }))

  it('группы: в работе, облетанные, архив', () => {
    expect(filterMissions(list, 'active', '').map((m) => m.status)).toEqual(['draft', 'planned', 'ready'])
    expect(filterMissions(list, 'flown', '').map((m) => m.status)).toEqual(['flown', 'analyzed'])
    expect(filterMissions(list, 'archived', '').map((m) => m.status)).toEqual(['archived'])
    expect(countByFilter(list)).toEqual({ all: 6, active: 3, flown: 2, archived: 1 })
  })

  it('поиск без учёта регистра и разницы ё/е', () => {
    expect(filterMissions(list, 'all', '  ЕЛКИНО ').map((m) => m.name)).toEqual(['Ёлкино поле'])
    expect(filterMissions(list, 'flown', 'ферма').length).toBe(2)
    expect(filterMissions(list, 'active', 'нет такой')).toEqual([])
  })

  it('сохранённое значение фильтра проверяется', () => {
    expect(parseHistoryFilter('flown')).toBe('flown')
    expect(parseHistoryFilter('completed')).toBe('all')
    expect(parseHistoryFilter(null)).toBe('all')
  })
})

describe('имя файла миссии', () => {
  it('без запрещённых в Windows и управляющих символов', () => {
    const name = missionFileName({ id: 'abcdef12-3456', name: 'Ферма: "Юг"/Север*?<>|\u0007 .', createdAt: '2026-09-20T08:00:00Z' }, 'json')
    expect(name).toBe('mission-Ферма-Юг-Север-2026-09-20.json')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
  })

  it('дата в имени — по часам компьютера, как в истории, а не UTC', () => {
    // 00:30 по местному времени, восточнее UTC дата по UTC ещё вчерашняя
    const createdAt = new Date(2026, 8, 24, 0, 30).toISOString()
    expect(missionFileName({ id: 'a', name: 'Юг', createdAt }, 'json')).toBe('mission-Юг-2026-09-24.json')
    expect(missionFileName({ id: 'a', name: 'Юг', createdAt: '2026-13-45T00:00:00Z' }, 'json')).toBe('mission-Юг.json')
  })

  it('пустое название заменяется началом id, длинное обрезается', () => {
    expect(missionFileName({ id: 'abcdef12-3456', name: '***', createdAt: 'x' }, 'json')).toBe('mission-abcdef12.json')
    const long = missionFileName({ id: 'a', name: 'я'.repeat(200), createdAt: '2026-09-20T08:00:00Z' }, 'json')
    expect(long).toBe(`mission-${'я'.repeat(60)}-2026-09-20.json`)
  })
})

describe('HTML-отчёт', () => {
  it('все значения экранированы, плашки «примеры» нет', () => {
    const evil = mission({ name: '<script>alert("x")</script> & «Ферма»', status: 'flown', completedAt: '2026-09-21T10:00:00Z', route, weather, departureTime: '2026-09-24T14:00' })
    const html = buildMissionsReportHtml({
      missions: [evil], t: tRu, lang: 'ru', filter: 'flown', search: '<img src=x onerror=alert(1)>', generatedAt: new Date('2026-09-24T12:00:00Z'),
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; «Ферма»')
    expect(html).toContain('Фильтр: Облетанные')
    expect(html).toContain('1 миссия')
    expect(html).toContain('Облетана')
    expect(html).toContain('12,3')
    expect(html).toContain('15 °C · 4,2 м/с · Преимущественно ясно')
    expect(html).toContain('<html lang="ru">')
    expect(html).not.toContain(tRu('history.demoNotice'))
  })

  it('отчёт на английском и пустые ячейки — прочерк', () => {
    const html = buildMissionsReportHtml({ missions: [mission(), mission()], t: tEn, lang: 'en', filter: 'all', search: '' })
    expect(html).toContain('2 missions')
    expect(html).toContain('Filter: All')
    expect(html).not.toContain('Search:')
    expect(html).toContain('<td>—</td>')
  })
})
