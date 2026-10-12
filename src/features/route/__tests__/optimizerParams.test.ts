import { describe, expect, it } from 'vitest'
import { FLIGHT_ALTITUDE_MAX_M, FLIGHT_ALTITUDE_MIN_M } from '@/domain/defaults'
import { DEFAULT_ACO_PARAMS, DEFAULT_GA_PARAMS } from '@/domain/route'
import {
  ALGORITHMS,
  DEFAULT_THETA_DEG,
  FLIGHT_ALTITUDE_RANGE,
  PARAM_DEFS,
  THETA_RANGE,
  defaultParams,
  defaultSettings,
  normalizeParams,
  parseNumberInput,
  sameSettings,
  settingsFromRoute,
  withAlgorithm,
} from '../optimizerParams'
import { makeRoute } from './helpers'

describe('параметры алгоритмов по умолчанию', () => {
  it('совпадают с решателем', () => {
    expect(defaultParams('aco')).toEqual({ ...DEFAULT_ACO_PARAMS })
    expect(defaultParams('ga')).toEqual({ ...DEFAULT_GA_PARAMS, selection: 0 })
    expect(defaultParams('auto')).toEqual({ seed: 1 })
  })

  it('каждый параметр формы имеет значение по умолчанию в своих границах', () => {
    for (const a of ALGORITHMS) {
      const defaults = defaultParams(a)
      expect(Object.keys(defaults).sort()).toEqual(PARAM_DEFS[a].map((d) => d.key).sort())
      for (const def of PARAM_DEFS[a]) {
        expect(defaults[def.key]).toBeGreaterThanOrEqual(def.min)
        expect(defaults[def.key]).toBeLessThanOrEqual(def.max)
      }
    }
  })

  it('возвращаются копии', () => {
    const p = defaultParams('aco')
    p.ants = 1
    expect(defaultParams('aco').ants).toBe(DEFAULT_ACO_PARAMS.ants)
  })
})

describe('очистка параметров', () => {
  it('чужие ключи отбрасываются, недостающие берутся по умолчанию', () => {
    expect(normalizeParams('auto', { seed: 5, ants: 10 })).toEqual({ seed: 5 })
    expect(normalizeParams('aco', { ants: 10 })).toEqual({ ...DEFAULT_ACO_PARAMS, ants: 10 })
    expect(normalizeParams('ga', undefined)).toEqual(defaultParams('ga'))
  })

  it('нечисловое — по умолчанию, вне границ — обрезается, целые округляются', () => {
    const p = normalizeParams('aco', { iterations: Number.NaN, ants: 0, rho: 5, alpha: -1, beta: Infinity, seed: 2.6 })
    expect(p.iterations).toBe(DEFAULT_ACO_PARAMS.iterations)
    expect(p.ants).toBe(1)
    expect(p.rho).toBe(1)
    expect(p.alpha).toBe(0)
    expect(p.beta).toBe(DEFAULT_ACO_PARAMS.beta)
    expect(p.seed).toBe(3)
    expect(normalizeParams('ga', { population: 1, selection: 7 })).toMatchObject({ population: 2, selection: 1 })
  })
})

describe('черновик настроек', () => {
  it('без маршрута — «Авто», без ограничения угла, с возвратом', () => {
    expect(settingsFromRoute(undefined)).toEqual(defaultSettings())
    expect(defaultSettings()).toEqual({ algorithm: 'auto', params: { seed: 1 }, thetaMaxDeg: DEFAULT_THETA_DEG, returnToTakeoff: true })
  })

  it('из маршрута берутся его настройки с очищенными параметрами', () => {
    const route = makeRoute(['t1'], { algorithm: 'ga', params: { generations: 50, junk: 1 }, thetaMaxDeg: 5, returnToTakeoff: false })
    const s = settingsFromRoute(route)
    expect(s.algorithm).toBe('ga')
    expect(s.params).toEqual({ ...defaultParams('ga'), generations: 50 })
    expect(s.thetaMaxDeg).toBe(THETA_RANGE.min)
    expect(s.returnToTakeoff).toBe(false)
  })

  it('неизвестный алгоритм в сохранённых данных — «Авто»', () => {
    const route = makeRoute(['t1'], { algorithm: 'lkh' as never })
    expect(settingsFromRoute(route).algorithm).toBe('auto')
  })

  it('сравнение настроек учитывает очистку параметров', () => {
    const a = settingsFromRoute(makeRoute(['t1'], { algorithm: 'aco', params: { ants: 10 } }))
    expect(sameSettings(a, { ...a, params: { ants: 10 } })).toBe(true)
    expect(sameSettings(a, { ...a, params: { ants: 11 } })).toBe(false)
    expect(sameSettings(a, { ...a, thetaMaxDeg: 90 })).toBe(false)
    expect(sameSettings(a, { ...a, returnToTakeoff: false })).toBe(false)
    expect(sameSettings(a, withAlgorithm(a, 'ga'))).toBe(false)
  })

  it('смена алгоритма даёт его параметры по умолчанию; тот же алгоритм ничего не меняет', () => {
    const s = { ...defaultSettings(), params: { seed: 9 } }
    expect(withAlgorithm(s, 'auto')).toBe(s)
    expect(withAlgorithm(s, 'aco').params).toEqual(defaultParams('aco'))
    expect(withAlgorithm(s, 'aco').thetaMaxDeg).toBe(s.thetaMaxDeg)
  })
})

describe('ввод чисел', () => {
  const range = { min: 0, max: 1000 }

  it('принимает запятую, пробелы между разрядами и экспоненту', () => {
    expect(parseNumberInput('12,5', range)).toBe(12.5)
    expect(parseNumberInput(' 1 000 ', range)).toBe(1000)
    expect(parseNumberInput('1 000', range)).toBe(1000)
    expect(parseNumberInput('1e2', range)).toBe(100)
    expect(parseNumberInput('.5', range)).toBe(0.5)
    expect(parseNumberInput('7.', range)).toBe(7)
  })

  it('отвергает мусор, пустую строку и выход за границы', () => {
    for (const bad of ['', ' ', 'abc', '1,2,3', '0x10', '1..2', 'NaN', 'Infinity', '-5', '1001', '12m']) {
      expect(parseNumberInput(bad, range)).toBeNull()
    }
  })

  it('для целых параметров дробное — ошибка, а не молчаливое округление', () => {
    expect(parseNumberInput('3.5', { min: 1, max: 10, integer: true })).toBeNull()
    expect(parseNumberInput('3', { min: 1, max: 10, integer: true })).toBe(3)
  })
})

describe('высота полёта', () => {
  it('те же границы 10…500 м, что в окне параметров миссии', () => {
    expect(FLIGHT_ALTITUDE_RANGE).toEqual({ min: FLIGHT_ALTITUDE_MIN_M, max: FLIGHT_ALTITUDE_MAX_M })
    expect(FLIGHT_ALTITUDE_RANGE).toEqual({ min: 10, max: 500 })
    expect(parseNumberInput('500', FLIGHT_ALTITUDE_RANGE)).toBe(500)
    // выше границы окна параметров миссии нельзя, иначе миссия там не сохранится
    expect(parseNumberInput('600', FLIGHT_ALTITUDE_RANGE)).toBeNull()
    expect(parseNumberInput('9', FLIGHT_ALTITUDE_RANGE)).toBeNull()
  })
})
