// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseKmlText } from '@/lib/kml'
import { ROUTE_EXPORT_FORMAT, ROUTE_EXPORT_VERSION, exportFileName, routeExportJson, routeExportKml, type RouteExport } from '../routeExport'
import { planFor } from '../routeLogic'
import { at, lineFarm, makeRoute } from './helpers'

const farm = { ...lineFarm(3), name: 'Север' }
const takeoff = at(-300, 0)
const route = makeRoute(['t3', 't1', 't2'], { returnToTakeoff: true })
const plan = planFor({ farm, takeoff, flightAltitudeM: 90, maxAltitudeM: 120 }, route.order, true)

// Одиночная половинка суррогатной пары — признак разрезанного посередине символа
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

describe('выгрузка в JSON', () => {
  it('ферма, взлёт, маршрут и план с форматом и версией', () => {
    const json = routeExportJson({ id: 'm1', name: 'Облёт', flightAltitudeM: 90, farm, takeoff, route }, plan, '2026-09-24T12:00:00.000Z')
    const data = JSON.parse(json) as RouteExport
    expect(data.format).toBe(ROUTE_EXPORT_FORMAT)
    expect(data.version).toBe(ROUTE_EXPORT_VERSION)
    expect(data.exportedAt).toBe('2026-09-24T12:00:00.000Z')
    expect(data.mission).toEqual({ id: 'm1', name: 'Облёт', flightAltitudeM: 90 })
    expect(data.farm).toEqual(farm)
    expect(data.takeoff).toEqual(takeoff)
    expect(data.route).toEqual(route)
    expect(data.plan?.waypoints).toHaveLength(plan.waypoints.length)
    expect(data.plan?.lengthM).toBeCloseTo(plan.lengthM, 9)
  })

  it('без маршрута — только ферма', () => {
    const data = JSON.parse(routeExportJson({ id: 'm1', name: 'Облёт', flightAltitudeM: 90, farm }, undefined, 'now')) as RouteExport
    expect(data.farm.turbines).toHaveLength(3)
    expect('route' in data).toBe(false)
    expect('plan' in data).toBe(false)
    expect('takeoff' in data).toBe(false)
  })
})

describe('выгрузка в KML', () => {
  it('турбины в порядке облёта с номерами и линия плана; файл читается обратно', () => {
    const kml = routeExportKml(farm, route, plan, 'Север')
    const parsed = parseKmlText(kml)
    expect(parsed.name).toBe('Север')
    expect(parsed.turbines.map((t) => t.name)).toEqual(['1. T3', '2. T1', '3. T2'])
    // Линия пути — не турбина
    expect(parsed.skipped).toBe(1)
    expect(kml).toContain('<LineString>')
  })

  it('без маршрута — только турбины, без номеров и линии', () => {
    const kml = routeExportKml(farm, undefined, undefined)
    const parsed = parseKmlText(kml)
    expect(parsed.turbines.map((t) => t.name)).toEqual(['T1', 'T2', 'T3'])
    expect(parsed.skipped).toBe(0)
    expect(kml).not.toContain('<LineString>')
  })

  it('турбины, удалённые из фермы, в нумерацию не попадают', () => {
    const kml = routeExportKml(farm, makeRoute(['ghost', 't2']), undefined)
    expect(parseKmlText(kml).turbines.map((t) => t.name)).toEqual(['1. T2', 'T1', 'T3'])
  })
})

describe('имя файла', () => {
  it('запрещённые в Windows символы заменяются, расширение добавляется', () => {
    expect(exportFileName('Маршрут — Ферма: "Север" 1/2', 'json')).toBe('Маршрут — Ферма Север 1 2.json')
    expect(exportFileName('a\u0001b', 'kml')).toBe('a b.kml')
  })

  it('точки и пробелы в конце убираются, пустое имя — route', () => {
    expect(exportFileName('Облёт...  ', 'kml')).toBe('Облёт.kml')
    expect(exportFileName('  ', 'json')).toBe('route.json')
    expect(exportFileName('???', 'json')).toBe('route.json')
  })

  it('имена устройств Windows не используются как есть', () => {
    expect(exportFileName('CON', 'kml')).toBe('CON_.kml')
    expect(exportFileName('lpt1', 'json')).toBe('lpt1_.json')
  })

  it('длинное имя режется по символам, не разрывая суррогатные пары', () => {
    const name = exportFileName('🌬'.repeat(100), 'json')
    expect(Array.from(name.replace(/\.json$/, ''))).toHaveLength(80)
    expect(LONE_SURROGATE.test(name)).toBe(false)
  })
})
