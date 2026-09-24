import { describe, expect, it } from 'vitest'
import { distPointToSegment, makeLocalFrame, offsetGeo } from '@/lib/geo'
import {
  buildFlightPlan,
  missionPlanLengthM,
  orbitPathRadiusM,
  orbitRadiusM,
  turbineHubM,
  turbineRotorM,
  type FlightPlanInput,
} from '../flightPlan'
import { DEFAULT_DRONE_PROFILE, DEFAULT_LIMITS } from '../defaults'
import { mulberry32 } from '../route/random'
import type { Farm, FlightPlan, Mission, Turbine } from '../types'

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

  it('вершины облёта — на описанном многоугольнике: квадрат вокруг круга 90 м — с вершинами на 90·√2', () => {
    const f = farm([])
    const t = turbine('a', 0, 0)
    expect(orbitPathRadiusM(f, t, 4)).toBeCloseTo(90 * Math.SQRT2, 9)
    expect(orbitPathRadiusM(f, t)).toBeCloseTo(90 / Math.cos(Math.PI / 12), 9)
    // Число отрезков приводится к тем же пределам, что и в плане
    expect(orbitPathRadiusM(f, t, 1)).toBeCloseTo(180, 9)
  })
})

describe('план полёта', () => {
  it('облёт идёт многоугольником вокруг круга ротор/2 + safeDistance на высоте ступицы и замыкается', () => {
    const t = turbine('a', 300, 200, { rotorDiameterM: 150, hubHeightM: 110 })
    const result = plan({ farm: farm([t]), order: ['a'], returnToTakeoff: false, orbitSegments: 8 })
    const orbit = result.waypoints.filter((w) => w.kind === 'orbit')
    expect(orbit).toHaveLength(9)
    const center = local(t)
    const pathR = 105 / Math.cos(Math.PI / 8)
    for (const w of orbit) {
      const p = local(w)
      expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(pathR, 6)
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
    expect(Math.hypot(e.x - home.x, e.y - home.y)).toBeCloseTo(toHome - pathR, 6)
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
    const f = farm([a, b])
    const result = plan({ farm: f, order: ['a', 'b'], returnToTakeoff: false })
    const wps = result.waypoints
    const entryB = wps.findIndex((w) => w.kind === 'transit' && w.turbineId === 'b')
    const exitA = local(wps[entryB - 1])
    const centerB = local(b)
    expect(wps[entryB - 1]).toMatchObject({ kind: 'orbit', turbineId: 'a' })
    const e = local(wps[entryB])
    const toCenter = Math.hypot(centerB.x - exitA.x, centerB.y - exitA.y)
    expect(Math.hypot(e.x - exitA.x, e.y - exitA.y)).toBeCloseTo(toCenter - orbitPathRadiusM(f, b), 6)
  })

  it('доворот к выходу — по той же окружности, не больше полукруга, равными шагами не длиннее шага облёта', () => {
    // Вход в A с запада (180°), следующая турбина — по азимуту 29,7° от A. Короче довернуть
    // по часовой: 150,3° — это 5 шагов по 30° и ещё 0,3° (полметра дуги). Такой хвост не
    // становится отдельной точкой, но и к последнему шагу не прибавляется: хорда длиннее шага
    // облёта срезала бы безопасную дистанцию. Доворот делится на 6 равных шагов по 25,05°
    const dir = (29.7 * Math.PI) / 180
    const a = turbine('a', 0, 0)
    const b = turbine('b', 1000 * Math.cos(dir), 1000 * Math.sin(dir))
    const f = farm([a, b])
    const result = plan({ farm: f, order: ['a', 'b'], takeoff: offsetGeo(CENTER, -600, 0), returnToTakeoff: false })
    const orbitA = result.waypoints.filter((w) => w.kind === 'orbit' && w.turbineId === 'a').map(local)
    expect(orbitA).toHaveLength(13 + 6)
    for (const p of orbitA) expect(Math.hypot(p.x, p.y)).toBeCloseTo(orbitPathRadiusM(f, a), 6)
    for (let k = 1; k < orbitA.length; k++) {
      expect(Math.hypot(orbitA[k].x - orbitA[k - 1].x, orbitA[k].y - orbitA[k - 1].y)).toBeGreaterThan(40)
    }
    const exitArc = orbitA.slice(12)
    for (let k = 1; k < exitArc.length; k++) {
      const turn = Math.abs(Math.atan2(exitArc[k].y, exitArc[k].x) - Math.atan2(exitArc[k - 1].y, exitArc[k - 1].x))
      const stepDeg = ((turn > Math.PI ? 2 * Math.PI - turn : turn) * 180) / Math.PI
      expect(stepDeg).toBeCloseTo(150.3 / 6, 6)
    }
    const exit = orbitA.at(-1)!
    expect(Math.atan2(exit.y, exit.x)).toBeCloseTo(dir, 9)
    expect(result.conflicts).toEqual([])
  })

  it('облёт нигде не подходит к своей башне ближе радиуса безопасности, даже при большом роторе', () => {
    // Раньше вершины стояли на самом круге: хорда 12-угольника при роторе 300 м и запасе 5 м
    // проходила в 150 − 0,28 м от башни — внутри диска ротора
    const rng = mulberry32(20)
    for (const [rotorDiameterM, safeDistanceM] of [
      [120, 30],
      [250, 30],
      [300, 5],
      [350, 5],
    ]) {
      for (const orbitSegments of [3, 4, 7, 12, 36]) {
        const turbines = Array.from({ length: 4 }, (_, k) => turbine(`t${k}`, k * 1500, Math.round(rng() * 6) * 250))
        const f: Farm = { center: CENTER, defaults: { hubHeightM: 200, rotorDiameterM, safeDistanceM }, turbines }
        const result = buildFlightPlan({
          farm: f,
          takeoff: offsetGeo(CENTER, -900, rng() * 900),
          order: turbines.map((t) => t.id).sort(() => rng() - 0.5),
          flightAltitudeM: 90,
          maxAltitudeM: 120,
          returnToTakeoff: rng() < 0.5,
          orbitSegments,
        })
        const wps = result.waypoints
        for (let k = 1; k < wps.length; k++) {
          const id = wps[k].turbineId
          if (wps[k].kind !== 'orbit' || wps[k - 1].turbineId !== id) continue
          const t = turbines.find((x) => x.id === id)!
          expect(distPointToSegment(local(t), local(wps[k - 1]), local(wps[k]))).toBeGreaterThanOrEqual(orbitRadiusM(f, t) - 1e-6)
        }
        // И проверка конфликтов свой облёт не отмечает
        const ownOrbit = result.conflicts.filter((c) => wps[c.segmentIndex].turbineId === c.turbineId && wps[c.segmentIndex + 1].turbineId === c.turbineId)
        expect(ownOrbit).toEqual([])
      }
    }
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
        expect(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - orbitPathRadiusM(f, t))).toBeLessThan(1e-6)
        if (wps[k - 1].kind !== 'orbit') continue
        const q = local(wps[k - 1])
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('длина — сумма трёхмерных отрезков, сверено вручную', () => {
    // Одна турбина в центре, взлёт в 500 м южнее, облёт квадратом (4 отрезка) вокруг круга
    // радиусом 90 м: вершины на 90·√2, сторона 180 м. Выход совпадает со входом (цель — снова
    // взлёт), доворота нет
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
    const toEntry = 500 - 90 * Math.SQRT2
    const toHub = 100 - 90
    const square = 4 * 180
    const back = Math.hypot(toEntry, 10)
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
    expect(exit.x).toBeCloseTo(500 + orbitPathRadiusM(f, f.turbines[1]), 6)
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
    // Независимый оракул: 2000 точек на отрезке, конфликт — точка внутри круга облёта любой
    // башни (с запасом 5 см от границы) ниже её верха лопасти плюс безопасная дистанция.
    // Исключений нет: ни облёты, ни башня, к которой летим, от проверки не освобождены
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
        for (const t of turbines) {
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

  // Конфликты с турбиной withId на отрезках облёта турбины from
  const orbitConflicts = (result: FlightPlan, from: string, withId: string) =>
    result.conflicts.filter((c) => {
      const [a, b] = [result.waypoints[c.segmentIndex], result.waypoints[c.segmentIndex + 1]]
      return c.turbineId === withId && a.kind === 'orbit' && b.kind === 'orbit' && a.turbineId === from && b.turbineId === from
    })

  it('облёт на высоте ступицы проходит сквозь ротор соседа — конфликт на дуге облёта', () => {
    // T1 и T3 в 140 м друг от друга: облёт каждой идёт в ~50 м от башни другой, ближе
    // конца лопасти (60 м). Раньше дуги облёта не проверялись, и сводка писала «0 конфликтов»
    const f = farm([turbine('T1', 0, 0), turbine('T2', 600, 600), turbine('T3', 140, 0), turbine('T4', 700, -300)])
    const result = plan({ farm: f, order: ['T1', 'T2', 'T3', 'T4'] })
    const t1nearT3 = orbitConflicts(result, 'T1', 'T3')
    const t3nearT1 = orbitConflicts(result, 'T3', 'T1')
    expect(t1nearT3.length).toBeGreaterThan(0)
    expect(t3nearT1.length).toBeGreaterThan(0)
    expect(Math.min(...t1nearT3.map((c) => c.distanceM))).toBeLessThan(60)
    expect(Math.min(...t3nearT1.map((c) => c.distanceM))).toBeLessThan(60)
  })

  it('облёт задевает башню, которой нет в маршруте', () => {
    const f = farm([turbine('A', 0, 0), turbine('B', 130, 0)])
    const result = plan({ farm: f, order: ['A'] })
    const nearB = orbitConflicts(result, 'A', 'B')
    expect(nearB.length).toBeGreaterThan(0)
    expect(nearB.every((c) => c.minDistanceM === 90 && c.distanceM < 90)).toBe(true)
  })

  it('перелёт к соседу начинается внутри его круга — конфликт записан и на соседа', () => {
    // A и B в 120 м: выход с облёта A лежит в ~27 м от башни B, и весь перелёт ко входу на B
    // идёт в её зоне. Раньше башня, к которой летим, не проверялась вовсе
    const f = farm([turbine('A', 0, 0), turbine('B', 120, 0)])
    const result = plan({ farm: f, order: ['A', 'B'], takeoff: offsetGeo(CENTER, -600, 0), returnToTakeoff: false })
    const leg = result.waypoints.findIndex((w) => w.kind === 'transit' && w.turbineId === 'B') - 1
    expect(result.waypoints[leg]).toMatchObject({ kind: 'orbit', turbineId: 'A' })
    const onLeg = result.conflicts.filter((c) => c.segmentIndex === leg)
    expect(onLeg.map((c) => c.turbineId)).toContain('B')
    expect(onLeg.find((c) => c.turbineId === 'B')!.distanceM).toBeLessThan(30)
  })

  it('перелёт к турбине снаружи её круга с ней самой не конфликтует', () => {
    const f = farm([turbine('A', 0, 0), turbine('B', 400, 0)])
    const result = plan({ farm: f, order: ['A', 'B'], takeoff: offsetGeo(CENTER, -600, 0), returnToTakeoff: false })
    expect(result.conflicts).toEqual([])
  })
})

describe('длина плана миссии', () => {
  const f = farm([turbine('a', 0, 0), turbine('b', 600, 0)])
  const route = {
    algorithm: 'auto' as const, params: {}, thetaMaxDeg: 180, returnToTakeoff: true,
    order: ['a', 'b'], lengthM: 0, turnViolations: 0, source: 'auto' as const, computedAt: '2026-09-24T10:00:00Z',
  }
  const m: Pick<Mission, 'farm' | 'takeoff' | 'route' | 'flightAltitudeM' | 'limits'> = {
    farm: f, takeoff: offsetGeo(CENTER, 0, -500), route, flightAltitudeM: 150, limits: { ...DEFAULT_LIMITS, maxAltitudeM: 200 },
  }
  const expectedLength = (maxAltitudeM: number, takeoff = offsetGeo(CENTER, 0, -500)) =>
    plan({ farm: f, order: ['a', 'b'], takeoff, flightAltitudeM: 150, maxAltitudeM }).lengthM

  it('потолок — меньший из миссии и дрона, как на экранах', () => {
    expect(missionPlanLengthM(m, { ...DEFAULT_DRONE_PROFILE, maxAltitudeM: 60 })).toBeCloseTo(expectedLength(60), 9)
    // Потолок дрона выше лимита миссии — упираемся в лимит миссии
    expect(missionPlanLengthM(m, { ...DEFAULT_DRONE_PROFILE, maxAltitudeM: 400 })).toBeCloseTo(expectedLength(200), 9)
    expect(expectedLength(60)).not.toBeCloseTo(expectedLength(200), 0)
  })

  it('без точки взлёта — из центра фермы; без фермы, маршрута или живых турбин — длины нет', () => {
    expect(missionPlanLengthM({ ...m, takeoff: undefined }, DEFAULT_DRONE_PROFILE)).toBeCloseTo(expectedLength(120, CENTER), 9)
    expect(missionPlanLengthM({ ...m, farm: undefined }, DEFAULT_DRONE_PROFILE)).toBeUndefined()
    expect(missionPlanLengthM({ ...m, route: undefined }, DEFAULT_DRONE_PROFILE)).toBeUndefined()
    expect(missionPlanLengthM({ ...m, route: { ...route, order: [] } }, DEFAULT_DRONE_PROFILE)).toBeUndefined()
    expect(missionPlanLengthM({ ...m, route: { ...route, order: ['gone'] } }, DEFAULT_DRONE_PROFILE)).toBeUndefined()
  })
})
