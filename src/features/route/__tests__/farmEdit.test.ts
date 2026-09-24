import { describe, expect, it } from 'vitest'
import type { Farm, GeoPoint, Turbine, WeatherSnapshot } from '@/domain/types'
import { DEFAULT_FARM_DEFAULTS } from '@/domain/defaults'
import { derivePreFlightStatus } from '@/domain/missionStatus'
import { centroid, haversineM } from '@/lib/geo'
import type { FarmImport } from '@/lib/kml'
import { FAR_FROM_FARM_M } from '@/features/weather/location'
import {
  FAR_TAKEOFF_M,
  addTurbine,
  importDropsWeather,
  importPatch,
  importTakeoffDistanceM,
  importWeatherDistanceM,
  moveTurbine,
  removeTurbine,
  setFarmDefaults,
} from '../farmEdit'
import { at, lineFarm, makeRoute } from './helpers'

function importOf(turbines: Turbine[], name?: string): FarmImport {
  return { ...(name ? { name } : {}), turbines, skipped: 2, merged: 1, fileName: 'farm.kml', sha256: 'abc' }
}

// Снимок прогноза по точке; содержимое прогноза для импорта не важно
function weatherAt(location: GeoPoint): WeatherSnapshot {
  return {
    fetchedAt: '2026-09-24T10:00:00.000Z',
    source: 'farm',
    location: { ...location, name: 'Ферма А' },
    distanceToFarmM: 0,
    timezone: 'Europe/Warsaw',
    utcOffsetSeconds: 7200,
    current: { time: '2026-09-24T12:00', temperatureC: 15, windMs10: 4, windDirDeg10: 180, gustMs10: 6, weatherCode: 0, precipitationMm: 0 },
    hourly: [],
  }
}

describe('турбины кликом по карте', () => {
  it('без фермы создаётся новая с параметрами по умолчанию', () => {
    const p = at(10, 20)
    const { farm, turbine } = addTurbine(undefined, p)
    expect(turbine).toEqual({ id: 't1', name: 'T1', lat: p.lat, lon: p.lon })
    expect(farm.turbines).toEqual([turbine])
    expect(farm.center.lat).toBeCloseTo(p.lat, 12)
    expect(farm.center.lon).toBeCloseTo(p.lon, 12)
    expect(farm.defaults).toEqual(DEFAULT_FARM_DEFAULTS)
    // Копия: правка параметров фермы не должна менять общие значения по умолчанию
    expect(farm.defaults).not.toBe(DEFAULT_FARM_DEFAULTS)
    expect(farm.source).toBeUndefined()
  })

  it('новая турбина не совпадает ни с одним id и именем вида tN/TN', () => {
    const farm: Farm = {
      ...lineFarm(3),
      turbines: [
        { id: 't1', name: 'T1', ...at(0, 0) },
        { id: 'WTG-01', name: 'T7', ...at(400, 0) },
        { id: 't2', name: 'Север', ...at(800, 0) },
      ],
    }
    const { turbine } = addTurbine(farm, at(1200, 0))
    expect(turbine.id).toBe('t8')
    expect(turbine.name).toBe('T8')
  })

  it('с импортированными именами номер идёт после числа турбин', () => {
    const farm: Farm = { ...lineFarm(2), turbines: [{ id: 'WTG-01', name: 'WTG-01', ...at(0, 0) }, { id: 'WTG-02', name: 'WTG-02', ...at(400, 0) }] }
    const { farm: next, turbine } = addTurbine(farm, at(800, 0))
    expect(turbine.id).toBe('t3')
    expect(next.turbines.map((t) => t.id)).toEqual(['WTG-01', 'WTG-02', 't3'])
    expect(next.center.lat).toBeCloseTo(centroid(next.turbines).lat, 12)
    expect(next.center.lon).toBeCloseTo(centroid(next.turbines).lon, 12)
    // Остальное из фермы сохраняется
    expect(next.defaults).toBe(farm.defaults)
  })
})

describe('правка фермы', () => {
  it('удаление пересчитывает центр; последнюю турбину можно удалить', () => {
    const farm = lineFarm(3)
    const next = removeTurbine(farm, 't3')
    expect(next.turbines.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(haversineM(next.center, at(200, 0))).toBeLessThan(0.5)
    const empty = removeTurbine(removeTurbine(next, 't1'), 't2')
    expect(empty.turbines).toEqual([])
    // Центр остаётся прежним: от него строится локальная система, пустой набор центра не имеет
    expect(empty.center).toEqual(removeTurbine(next, 't1').center)
    // Неизвестный id — без изменений
    expect(removeTurbine(farm, 'nope').turbines).toHaveLength(3)
  })

  it('перенос меняет координаты и забывает высоту рельефа из файла', () => {
    const farm: Farm = { ...lineFarm(2), turbines: lineFarm(2).turbines.map((t) => ({ ...t, groundAltM: 150, hubHeightM: 90 })) }
    const p = at(0, 300)
    const next = moveTurbine(farm, 't1', p)
    const moved = next.turbines[0]
    expect(moved.lat).toBe(p.lat)
    expect(moved.lon).toBe(p.lon)
    expect(moved.groundAltM).toBeUndefined()
    expect('groundAltM' in moved).toBe(false)
    expect(moved.hubHeightM).toBe(90)
    expect(next.turbines[1]).toBe(farm.turbines[1])
    expect(haversineM(next.center, at(200, 150))).toBeLessThan(0.5)
  })

  it('параметры по умолчанию правятся по одному полю', () => {
    const farm = lineFarm(1)
    const next = setFarmDefaults(farm, { safeDistanceM: 45 })
    expect(next.defaults).toEqual({ ...farm.defaults, safeDistanceM: 45 })
    expect(farm.defaults.safeDistanceM).toBe(DEFAULT_FARM_DEFAULTS.safeDistanceM)
  })
})

describe('замена фермы импортом', () => {
  const imported = lineFarm(4).turbines

  it('без точки взлёта взлёт ставится в центр новой фермы, маршрут сбрасывается', () => {
    const patch = importPatch({}, importOf(imported, 'Север'), { moveTakeoff: false })
    expect(patch.farm?.name).toBe('Север')
    expect(patch.farm?.turbines).toHaveLength(4)
    expect(patch.takeoff).toEqual(patch.farm?.center)
    expect('route' in patch).toBe(true)
    expect(patch.route).toBeUndefined()
    expect(patch.farm?.source).toMatchObject({ fileName: 'farm.kml', sha256: 'abc' })
  })

  it('заданная точка взлёта остаётся, если её не просят перенести', () => {
    const takeoff = at(-500, 0)
    const previous = { ...lineFarm(2), name: 'Старая', defaults: { hubHeightM: 80, rotorDiameterM: 90, safeDistanceM: 25 } }
    const kept = importPatch({ farm: previous, takeoff }, importOf(imported), { moveTakeoff: false })
    expect(kept.takeoff).toBe(takeoff)
    // Параметры по умолчанию и имя переходят от прежней фермы
    expect(kept.farm?.defaults).toEqual(previous.defaults)
    expect(kept.farm?.name).toBe('Старая')
    const moved = importPatch({ farm: previous, takeoff }, importOf(imported), { moveTakeoff: true })
    expect(moved.takeoff).toEqual(moved.farm?.center)
  })

  it('прогноз для места дальше порога от новой фермы сбрасывается вместе с часом вылета', () => {
    // Ферма А в районе BASE, прогноз по её центру; ферма Б — в сотнях километров
    const farmA = lineFarm(4)
    const mission = {
      farm: farmA,
      takeoff: farmA.center,
      route: makeRoute(['t1', 't2', 't3', 't4']),
      weather: weatherAt(farmA.center),
      departureTime: '2026-09-25T10:00',
    }
    expect(derivePreFlightStatus(mission)).toBe('ready')
    const farB = importOf(lineFarm(3).turbines.map((t, i) => ({ ...t, id: `b${i}`, ...at(i * 400, 500_000) })), 'Ферма Б')
    const patch = importPatch(mission, farB, { moveTakeoff: true })
    expect('weather' in patch && patch.weather === undefined).toBe(true)
    expect('departureTime' in patch && patch.departureTime === undefined).toBe(true)
    // Новый маршрут больше не делает миссию «Готовой к полёту» по чужой погоде
    const after = { ...mission, ...patch, route: makeRoute(['b0', 'b1', 'b2']) }
    expect(derivePreFlightStatus(after)).toBe('planned')
  })

  it('близкий прогноз (повторный импорт той же фермы, город рядом) остаётся', () => {
    const farm = lineFarm(4)
    const weather = weatherAt(at(0, 20_000))
    const patch = importPatch({ farm, takeoff: farm.center, weather }, importOf(farm.turbines), { moveTakeoff: false })
    expect('weather' in patch).toBe(false)
    expect('departureTime' in patch).toBe(false)
    // Без прогноза сбрасывать нечего
    expect('weather' in importPatch({ farm }, importOf(farm.turbines), { moveTakeoff: false })).toBe(false)
  })

  it('порог сброса прогноза тот же, что у экрана погоды', () => {
    const imp = importOf(lineFarm(2).turbines)
    const center = centroid(imp.turbines)
    expect(importWeatherDistanceM(undefined, imp)).toBeUndefined()
    expect(importWeatherDistanceM(weatherAt(center), imp)).toBeLessThan(1)
    expect(importDropsWeather(weatherAt(at(200, FAR_FROM_FARM_M - 1000)), imp)).toBe(false)
    expect(importDropsWeather(weatherAt(at(200, FAR_FROM_FARM_M + 1000)), imp)).toBe(true)
    expect(importDropsWeather(undefined, imp)).toBe(false)
  })

  it('расстояние от сохранённого взлёта до новой фермы', () => {
    expect(importTakeoffDistanceM(undefined, importOf(imported))).toBeUndefined()
    const near = importTakeoffDistanceM(at(600, 0), importOf(imported))
    expect(near).toBeLessThan(1)
    const far = importTakeoffDistanceM(at(600, 25_000), importOf(imported))
    expect(far).toBeGreaterThan(FAR_TAKEOFF_M)
  })
})
