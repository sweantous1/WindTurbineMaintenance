import { describe, expect, it } from 'vitest'
import { makeLocalFrame, offsetGeo } from '@/lib/geo'
import { buildFlightPlan, orbitRadiusM, turbineHubM, turbineRotorM, type FlightPlanInput } from '../flightPlan'
import { mulberry32 } from '../route/random'
import type { Farm, FlightPlan, Turbine } from '../types'

const CENTER = { lat: 55.75, lon: 37.62 }
const frame = makeLocalFrame(CENTER)

// Турбина в метрах от центра фермы: на восток и на север
function turbine(id: string, eastM: number, northM: number, extra: Partial<Turbine> = {}): Turbine {
  return { id, name: id, ...offsetGeo(CENTER, eastM, northM), ...extra }
}

function farm(turbines: Turbine[]): Farm {
  return { center: CENTER, defaults: { hubHeightM: 100, rotorDiameterM: 120, safeDistanceM: 30 }, turbines }
}

function plan(overrides: Partial<FlightPlanInput> & Pick<FlightPlanInput, 'farm' | 'order'>): FlightPlan {
  return buildFlightPlan({
    takeoff: offsetGeo(CENTER, 0, -500),
    flightAltitudeM: 90,
    maxAltitudeM: 120,
    returnToTakeoff: true,
    ...overrides,
  })
}

const local = (p: { lat: number; lon: number }) => frame.toLocal(p)

describe('параметры турбин', () => {
  it('высота ступицы, ротор и радиус облёта берутся с турбины или из умолчаний фермы', () => {
    const f = farm([])
    const plain = turbine('a', 0, 0)
    const custom = turbine('b', 0, 0, { hubHeightM: 140, rotorDiameterM: 170 })
    expect(turbineHubM(f, plain)).toBe(100)
    expect(turbineRotorM(f, plain)).toBe(120)
    expect(orbitRadiusM(f, plain)).toBe(90)
    expect(turbineHubM(f, custom)).toBe(140)
    expect(orbitRadiusM(f, custom)).toBe(115)
  })
})

describe('план полёта', () => {
  it('облёт идёт по окружности радиуса ротор/2 + safeDistance на высоте ступицы и замыкается', () => {
    const t = turbine('a', 300, 200, { rotorDiameterM: 150, hubHeightM: 110 })
    const result = plan({ farm: farm([t]), order: ['a'], returnToTakeoff: false, orbitSegments: 8 })
    const orbit = result.waypoints.filter((w) => w.kind === 'orbit')
    expect(orbit).toHaveLength(9)
    const center = local(t)
    for (const w of orbit) {
      const p = local(w)
      expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(105, 6)
      expect(w.altM).toBe(110)
      expect(w.turbineId).toBe('a')
    }
    expect(orbit[8].lat).toBeCloseTo(orbit[0].lat, 12)
    expect(orbit[8].lon).toBeCloseTo(orbit[0].lon, 12)

    // Вход — ближайшая к взлёту точка окружности, на высоте транзита
    const entry = result.waypoints[2]
    expect(entry).toMatchObject({ kind: 'transit', turbineId: 'a', altM: 90 })
    const home = local(offsetGeo(CENTER, 0, -500))
    const e = local(entry)
    const toHome = Math.hypot(home.x - center.x, home.y - center.y)
    expect(Math.hypot(e.x - home.x, e.y - home.y)).toBeCloseTo(toHome - 105, 6)
  })

  it('по умолчанию в окружности 12 отрезков', () => {
    const result = plan({ farm: farm([turbine('a', 0, 0)]), order: ['a'], returnToTakeoff: false })
    expect(result.waypoints.filter((w) => w.kind === 'orbit')).toHaveLength(13)
  })

  it('уровни высот — транзит и ступицы посещённых турбин, по возрастанию и без повторов', () => {
    const f = farm([
      turbine('a', 0, 0),
      turbine('b', 600, 0, { hubHeightM: 80 }),
      turbine('c', 1200, 0),
      turbine('skip', 0, 900, { hubHeightM: 60 }),
    ])
    const result = plan({ farm: f, order: ['a', 'b', 'c'] })
    expect(result.transitAltM).toBe(90)
    expect(result.altitudeLevelsM).toEqual([80, 90, 100])
    expect(result.maxAltM).toBe(100)
    expect(result.turbineOrder).toEqual(['a', 'b', 'c'])

    // Высота транзита ограничена потолком
    expect(plan({ farm: f, order: ['a'], flightAltitudeM: 150 }).transitAltM).toBe(120)
  })

  it('ступица выше потолка — облёт всё равно на её высоте, и maxAltM это показывает', () => {
    const result = plan({ farm: farm([turbine('a', 0, 0, { hubHeightM: 150 })]), order: ['a'] })
    expect(result.transitAltM).toBe(90)
    expect(result.maxAltM).toBe(150)
    expect(result.maxAltM).toBeGreaterThan(120)
  })

  it('с возвратом: транзит над взлётом и посадка во взлёте', () => {
    const takeoff = offsetGeo(CENTER, 0, -500)
    const result = plan({ farm: farm([turbine('a', 0, 0)]), order: ['a'], takeoff })
    const wps = result.waypoints
    expect(wps[0]).toMatchObject({ kind: 'takeoff', altM: 0, lat: takeoff.lat, lon: takeoff.lon })
    expect(wps[1]).toMatchObject({ kind: 'transit', altM: 90, lat: takeoff.lat, lon: takeoff.lon })
    expect(wps.at(-2)).toMatchObject({ kind: 'transit', altM: 90, lat: takeoff.lat, lon: takeoff.lon })
    expect(wps.at(-1)).toMatchObject({ kind: 'landing', altM: 0, lat: takeoff.lat, lon: takeoff.lon })
  })

  it('без возврата: посадка под последней точкой облёта', () => {
    const result = plan({ farm: farm([turbine('a', 0, 0), turbine('b', 700, 0)]), order: ['a', 'b'], returnToTakeoff: false })
    const wps = result.waypoints
    const last = wps.at(-1)!
    const beforeLast = wps.at(-2)!
    expect(last.kind).toBe('landing')
    expect(last.altM).toBe(0)
    expect(beforeLast).toMatchObject({ kind: 'orbit', turbineId: 'b' })
    expect(last.lat).toBe(beforeLast.lat)
    expect(last.lon).toBe(beforeLast.lon)
    expect(wps.filter((w) => w.kind === 'transit')).toHaveLength(3)
  })

  it('неизвестные и повторные id пропускаются', () => {
    const result = plan({ farm: farm([turbine('a', 0, 0), turbine('b', 700, 0)]), order: ['nope', 'b', 'b', 'a', 'x'] })
    expect(result.turbineOrder).toEqual(['b', 'a'])
    expect(new Set(result.waypoints.filter((w) => w.turbineId).map((w) => w.turbineId))).toEqual(new Set(['a', 'b']))
  })

  it('без турбин — взлёт, подъём, возврат и посадка', () => {
    const result = plan({ farm: farm([turbine('a', 0, 0)]), order: [] })
    expect(result.waypoints.map((w) => w.kind)).toEqual(['takeoff', 'transit', 'transit', 'landing'])
    expect(result.lengthM).toBeCloseTo(180, 9)
    expect(result.altitudeLevelsM).toEqual([90])
  })

  it('число отрезков облёта ограничено разумными пределами', () => {
    const f = farm([turbine('a', 0, 0)])
    const orbitCount = (orbitSegments: number) =>
      plan({ farm: f, order: ['a'], returnToTakeoff: false, orbitSegments }).waypoints.filter((w) => w.kind === 'orbit').length
    expect(orbitCount(0)).toBe(4)
    expect(orbitCount(1000)).toBe(361)
    expect(orbitCount(Number.NaN)).toBe(13)
  })

  it('только неизвестные id — как пустой порядок', () => {
    const result = plan({ farm: farm([turbine('a', 0, 0)]), order: ['x', 'y'] })
    expect(result.waypoints.map((w) => w.kind)).toEqual(['takeoff', 'transit', 'transit', 'landing'])
    expect(result.turbineOrder).toEqual([])
  })

  it('вход на следующий облёт — ближайшая точка его окружности к точке выхода с предыдущего', () => {
    const a = turbine('a', 0, 0)
    const b = turbine('b', 700, 400, { rotorDiameterM: 100 })
    const result = plan({ farm: farm([a, b]), order: ['a', 'b'], returnToTakeoff: false })
    const wps = result.waypoints
    const entryB = wps.findIndex((w) => w.kind === 'transit' && w.turbineId === 'b')
    const exitA = local(wps[entryB - 1])
    const centerB = local(b)
    expect(wps[entryB - 1]).toMatchObject({ kind: 'orbit', turbineId: 'a' })
    const e = local(wps[entryB])
    expect(Math.hypot(e.x - exitA.x, e.y - exitA.y)).toBeCloseTo(Math.hypot(centerB.x - exitA.x, centerB.y - exitA.y) - 80, 6)
  })

  it('доворот к выходу — по той же окружности, не больше полукруга, остаток короче метра не даёт лишней точки', () => {
    // Вход в A с запада (180°), следующая турбина — по азимуту 29,7° от A. Короче довернуть
    // по часовой: 150,3° = 5 шагов по 30° и ещё 0,3° (0,47 м дуги). Такой хвост не становится
    // отдельной точкой в полуметре от предыдущей — последний шаг просто чуть длиннее
    const dir = (29.7 * Math.PI) / 180
    const a = turbine('a', 0, 0)
    const b = turbine('b', 1000 * Math.cos(dir), 1000 * Math.sin(dir))
    const result = plan({ farm: farm([a, b]), order: ['a', 'b'], takeoff: offsetGeo(CENTER, -600, 0), returnToTakeoff: false })
    const orbitA = result.waypoints.filter((w) => w.kind === 'orbit' && w.turbineId === 'a').map(local)
    expect(orbitA).toHaveLength(13 + 5)
    for (const p of orbitA) expect(Math.hypot(p.x, p.y)).toBeCloseTo(90, 6)
    for (let k = 1; k < orbitA.length; k++) {
      expect(Math.hypot(orbitA[k].x - orbitA[k - 1].x, orbitA[k].y - orbitA[k - 1].y)).toBeGreaterThan(40)
    }
    const exit = orbitA.at(-1)!
    expect(Math.atan2(exit.y, exit.x)).toBeCloseTo(dir, 9)
    expect(result.conflicts).toEqual([])
  })

  it('на ферме-сетке соседние точки облёта не ближе метра и все лежат на своих окружностях', () => {
    const rng = mulberry32(9)
    for (let trial = 0; trial < 300; trial++) {
      const turbines = Array.from({ length: 2 + Math.floor(rng() * 6) }, (_, k) =>
        turbine(`t${k}`, Math.round(rng() * 20) * 100, Math.round(rng() * 4) * 300),
      )
      const f = farm(turbines)
      const result = plan({
        farm: f,
        order: turbines.map((t) => t.id),
        takeoff: offsetGeo(CENTER, Math.round(rng() * 20) * 100, -300),
        returnToTakeoff: rng() < 0.5,
      })
      const wps = result.waypoints
      for (let k = 1; k < wps.length; k++) {
        if (wps[k].kind !== 'orbit') continue
        const t = turbines.find((x) => x.id === wps[k].turbineId)!
        const p = local(wps[k])
        const c = local(t)
        expect(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - orbitRadiusM(f, t))).toBeLessThan(1e-6)
        if (wps[k - 1].kind !== 'orbit') continue
        const q = local(wps[k - 1])
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('длина — сумма трёхмерных отрезков, сверено вручную', () => {
    // Одна турбина в центре, взлёт в 500 м южнее, облёт квадратом (4 отрезка) радиуса 90 м.
    // Выход совпадает со входом (цель — снова взлёт), доворота нет
    const result = plan({ farm: farm([turbine('a', 0, 0)]), order: ['a'], orbitSegments: 4 })
    expect(result.waypoints.map((w) => w.kind)).toEqual([
      'takeoff',
      'transit',
      'transit',
      'orbit',
      'orbit',
      'orbit',
      'orbit',
      'orbit',
      'transit',
      'landing',
    ])
    const climb = 90
    const toEntry = 500 - 90
    const toHub = 100 - 90
    const square = 4 * 90 * Math.SQRT2
    const back = Math.hypot(410, 10)
    const descent = 90
    expect(result.lengthM).toBeCloseTo(climb + toEntry + toHub + square + back + descent, 6)
    expect(result.conflicts).toEqual([])
  })
})

describe('конфликты', () => {
  it('транзит проходит мимо чужой башни ниже лопастей — конфликт', () => {
    // Летим с A на B, а между ними, в 20 м от прямой, стоит C, которую не облетаем
    const f = farm([turbine('A', 0, 0), turbine('B', 1000, 0), turbine('C', 500, 20)])
    const result = plan({ farm: f, order: ['A', 'B'], takeoff: offsetGeo(CENTER, -800, 0), returnToTakeoff: false })
    expect(result.conflicts).toHaveLength(1)
    const [conflict] = result.conflicts
    expect(conflict.turbineId).toBe('C')
    expect(conflict.minDistanceM).toBe(90)
    expect(conflict.distanceM).toBeCloseTo(20, 6)
    // Отрезок — от выхода с облёта A к входу на облёт B
    expect(result.waypoints[conflict.segmentIndex]).toMatchObject({ kind: 'orbit', turbineId: 'A' })
    expect(result.waypoints[conflict.segmentIndex + 1]).toMatchObject({ kind: 'transit', turbineId: 'B' })
  })

  it('первый перелёт над чужой башней: конфликт по высоте транзита, выше лопастей — нет', () => {
    const f = farm([turbine('A', 0, 0), turbine('D', -400, 30)])
    const takeoff = offsetGeo(CENTER, -800, 0)
    const low = plan({ farm: f, order: ['A'], takeoff })
    expect(low.conflicts.map((c) => [c.segmentIndex, c.turbineId])).toEqual([
      [1, 'D'],
      // Возврат к взлёту идёт той же дорогой
      [low.waypoints.length - 3, 'D'],
    ])
    // Верх лопасти D — 160 м, плюс 30 м запаса; на 250 м над башней пролетать можно
    const high = plan({ farm: f, order: ['A'], takeoff, flightAltitudeM: 250, maxAltitudeM: 300 })
    expect(high.conflicts.filter((c) => c.segmentIndex === 1)).toEqual([])
  })

  it('ряд турбин по порядку облетается без конфликтов: выход с облёта — в сторону следующей', () => {
    const f = farm([turbine('A', 0, 0), turbine('B', 500, 0), turbine('C', 1000, 0)])
    const result = plan({ farm: f, order: ['A', 'B', 'C'], takeoff: offsetGeo(CENTER, -800, 0), returnToTakeoff: false })
    expect(result.conflicts).toEqual([])
    // Без доворота к выходу дрон пролетел бы сквозь башню B
    const bOrbit = result.waypoints.filter((w) => w.kind === 'orbit' && w.turbineId === 'B')
    expect(bOrbit.length).toBeGreaterThan(13)
    const exit = local(bOrbit.at(-1)!)
    expect(exit.x).toBeCloseTo(500 + 90, 6)
    expect(exit.y).toBeCloseTo(0, 6)
  })

  it('прямой возврат к взлёту сквозь ряд башен — конфликты с каждой, кроме той, от которой улетаем наружу', () => {
    const f = farm([turbine('A', 0, 0), turbine('B', 500, 0), turbine('C', 1000, 0)])
    const result = plan({ farm: f, order: ['A', 'B', 'C'], takeoff: offsetGeo(CENTER, -800, 0) })
    const back = result.waypoints.length - 3
    expect(result.waypoints[back]).toMatchObject({ kind: 'orbit', turbineId: 'C' })
    expect(result.conflicts.map((c) => [c.segmentIndex, c.turbineId])).toEqual([
      [back, 'A'],
      [back, 'B'],
    ])
  })

  it('на наклонном отрезке важна высота именно там, где он проходит мимо башни', () => {
    // Транзит на 250 м (выше лопастей: 100 + 60 + 30 = 190). С облёта A (100 м) на вход B (250 м)
    // дрон набирает высоту: у C (рядом с A) он ещё низко — конфликт; у D (рядом с B) уже выше 190
    const f = farm([turbine('A', 0, 0), turbine('B', 1000, 0), turbine('C', 300, 10), turbine('D', 800, 10)])
    const result = plan({
      farm: f,
      order: ['A', 'B'],
      takeoff: offsetGeo(CENTER, -800, 0),
      flightAltitudeM: 250,
      maxAltitudeM: 300,
      returnToTakeoff: false,
    })
    const leg = result.waypoints.findIndex((w) => w.kind === 'transit' && w.turbineId === 'B') - 1
    expect(result.conflicts.map((c) => [c.segmentIndex, c.turbineId])).toEqual([[leg, 'C']])
    expect(result.conflicts[0].distanceM).toBeCloseTo(10, 6)
  })

  it('совпадает с проверкой перебором точек вдоль отрезков на случайных фермах', () => {
    // Независимый оракул: 2000 точек на отрезке, конфликт — точка внутри круга облёта чужой
    // башни (с запасом 5 см от границы) ниже её верха лопасти плюс безопасная дистанция
    const rng = mulberry32(5)
    let total = 0
    for (let trial = 0; trial < 120; trial++) {
      const turbines = Array.from({ length: 2 + Math.floor(rng() * 6) }, (_, k) =>
        turbine(`t${k}`, rng() * 1500 - 750, rng() * 1500 - 750, { hubHeightM: 60 + rng() * 80, rotorDiameterM: 60 + rng() * 100 }),
      )
      const f: Farm = { center: CENTER, defaults: { hubHeightM: 100, rotorDiameterM: 120, safeDistanceM: 20 + rng() * 20 }, turbines }
      const result = buildFlightPlan({
        farm: f,
        takeoff: offsetGeo(CENTER, rng() * 2000 - 1000, rng() * 2000 - 1000),
        order: turbines.filter(() => rng() < 0.7).map((t) => t.id),
        flightAltitudeM: 50 + rng() * 250,
        maxAltitudeM: 120 + rng() * 200,
        returnToTakeoff: rng() < 0.5,
        orbitSegments: 3 + Math.floor(rng() * 20),
      })
      const pts = result.waypoints.map((w) => ({ ...local(w), altM: w.altM, kind: w.kind, turbineId: w.turbineId }))
      const expected: string[] = []
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i], pts[i + 1]]
        if (a.kind === 'orbit' && b.kind === 'orbit') continue
        for (const t of turbines) {
          if (t.id === b.turbineId) continue
          const c = local(t)
          const topM = turbineHubM(f, t) + turbineRotorM(f, t) / 2 + f.defaults.safeDistanceM
          for (let s = 0; s <= 2000; s++) {
            const u = s / 2000
            const inside = Math.hypot(a.x + (b.x - a.x) * u - c.x, a.y + (b.y - a.y) * u - c.y) < orbitRadiusM(f, t) - 0.05
            if (inside && a.altM + (b.altM - a.altM) * u < topM - 0.05) {
              expected.push(`${i}:${t.id}`)
              break
            }
          }
        }
      }
      const got = result.conflicts.map((c) => `${c.segmentIndex}:${c.turbineId}`)
      // Всё найденное перебором найдено и формулой; лишнее у формулы допустимо только на границе
      expect(got).toEqual(expect.arrayContaining(expected))
      for (const c of result.conflicts) {
        if (!expected.includes(`${c.segmentIndex}:${c.turbineId}`)) expect(c.minDistanceM - c.distanceM).toBeLessThan(0.1)
      }
      total += got.length
    }
    // Проверка не вырожденная: конфликты на этих фермах действительно встречаются
    expect(total).toBeGreaterThan(50)
  })

  it('площадка взлёта внутри круга облёта — конфликт на вертикальном подъёме', () => {
    const f = farm([turbine('A', 0, 0), turbine('B', 1000, 0)])
    const result = plan({ farm: f, order: ['B'], takeoff: offsetGeo(CENTER, 40, 0) })
    expect(result.conflicts.some((c) => c.segmentIndex === 0 && c.turbineId === 'A')).toBe(true)
  })
})
