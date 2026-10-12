import type { RouteAlgorithm, RoutePlan } from '@/domain/types'
import { FLIGHT_ALTITUDE_MAX_M, FLIGHT_ALTITUDE_MIN_M } from '@/domain/defaults'
import { DEFAULT_ACO_PARAMS, DEFAULT_GA_PARAMS } from '@/domain/route'
import type { OptimizerSettings } from './routeLogic'

// Параметры оптимизатора для формы. Границы те же, что у решателя, чтобы в маршрут
// записывалось ровно то, с чем он считался

export interface NumberRange {
  min: number
  max: number
  integer?: boolean
}

export interface ParamDef extends NumberRange {
  key: string
  step: number
  // выбор из вариантов вместо числа (отбор в GA), labelKey - ключ перевода
  options?: readonly { value: number; labelKey: string }[]
}

const SEED: ParamDef = { key: 'seed', min: 0, max: 0xffffffff, integer: true, step: 1 }

export const PARAM_DEFS: Readonly<Record<RouteAlgorithm, readonly ParamDef[]>> = {
  auto: [SEED],
  aco: [
    { key: 'iterations', min: 1, max: 100_000, integer: true, step: 10 },
    { key: 'ants', min: 1, max: 10_000, integer: true, step: 1 },
    { key: 'alpha', min: 0, max: 10, step: 0.1 },
    { key: 'beta', min: 0, max: 20, step: 0.1 },
    { key: 'rho', min: 0.001, max: 1, step: 0.01 },
    { key: 'q', min: 0.001, max: 1_000_000, step: 1 },
    SEED,
  ],
  ga: [
    { key: 'generations', min: 1, max: 100_000, integer: true, step: 10 },
    { key: 'population', min: 2, max: 10_000, integer: true, step: 1 },
    { key: 'mutationRate', min: 0, max: 1, step: 0.01 },
    { key: 'crossoverRate', min: 0, max: 1, step: 0.01 },
    {
      key: 'selection',
      min: 0,
      max: 1,
      integer: true,
      step: 1,
      options: [
        { value: 0, labelKey: 'routePlan.settings.selection.tournament' },
        { value: 1, labelKey: 'routePlan.settings.selection.roulette' },
      ],
    },
    SEED,
  ],
}

const DEFAULTS: Readonly<Record<RouteAlgorithm, Readonly<Record<string, number>>>> = {
  auto: { seed: 1 },
  aco: { ...DEFAULT_ACO_PARAMS },
  // 0 = турнир, как по умолчанию у решателя
  ga: { ...DEFAULT_GA_PARAMS, selection: 0 },
}

export const ALGORITHMS: readonly RouteAlgorithm[] = ['auto', 'aco', 'ga']

export const THETA_RANGE: NumberRange = { min: 10, max: 180 }
// 180° = без ограничения
export const DEFAULT_THETA_DEG = 180

// Высота транзита над землёй, выше потолка план всё равно прижмёт её к потолку.
// Границы как в окне параметров миссии, иначе миссия там не сохранится
export const FLIGHT_ALTITUDE_RANGE: NumberRange = { min: FLIGHT_ALTITUDE_MIN_M, max: FLIGHT_ALTITUDE_MAX_M }

// Параметры турбин: с запасом на крупнейшие морские турбины (ротор ~250 м)
export const FARM_DEFAULT_RANGES = {
  hubHeightM: { min: 10, max: 350 },
  rotorDiameterM: { min: 10, max: 350 },
  safeDistanceM: { min: 5, max: 500 },
} as const satisfies Record<string, NumberRange>

export function defaultParams(algorithm: RouteAlgorithm): Record<string, number> {
  return { ...DEFAULTS[algorithm] }
}

export function clampToRange(value: number, range: NumberRange): number {
  const v = range.integer ? Math.round(value) : value
  return Math.min(range.max, Math.max(range.min, v))
}

// только ключи выбранного алгоритма; нечисловое заменяем дефолтом, вне границ обрезаем
export function normalizeParams(algorithm: RouteAlgorithm, params: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const def of PARAM_DEFS[algorithm]) {
    const raw = params?.[def.key]
    out[def.key] = typeof raw === 'number' && Number.isFinite(raw) ? clampToRange(raw, def) : DEFAULTS[algorithm][def.key]
  }
  return out
}

function isAlgorithm(value: unknown): value is RouteAlgorithm {
  return ALGORITHMS.includes(value as RouteAlgorithm)
}

export function defaultSettings(): OptimizerSettings {
  return { algorithm: 'auto', params: defaultParams('auto'), thetaMaxDeg: DEFAULT_THETA_DEG, returnToTakeoff: true }
}

// черновик формы берём из настроек сохранённого маршрута
export function settingsFromRoute(route: RoutePlan | undefined): OptimizerSettings {
  if (!route) return defaultSettings()
  const algorithm = isAlgorithm(route.algorithm) ? route.algorithm : 'auto'
  const theta = Number.isFinite(route.thetaMaxDeg) ? clampToRange(route.thetaMaxDeg, THETA_RANGE) : DEFAULT_THETA_DEG
  return {
    algorithm,
    params: normalizeParams(algorithm, route.params),
    thetaMaxDeg: theta,
    returnToTakeoff: route.returnToTakeoff,
  }
}

export function sameSettings(a: OptimizerSettings, b: OptimizerSettings): boolean {
  if (a.algorithm !== b.algorithm || a.thetaMaxDeg !== b.thetaMaxDeg || a.returnToTakeoff !== b.returnToTakeoff) return false
  const pa = normalizeParams(a.algorithm, a.params)
  const pb = normalizeParams(b.algorithm, b.params)
  return PARAM_DEFS[a.algorithm].every((d) => pa[d.key] === pb[d.key])
}

// при смене алгоритма берём его дефолты, наборы ключей у них разные
export function withAlgorithm(settings: OptimizerSettings, algorithm: RouteAlgorithm): OptimizerSettings {
  if (settings.algorithm === algorithm) return settings
  return { ...settings, algorithm, params: defaultParams(algorithm) }
}

// Принимает запятую как десятичный разделитель и пробелы между разрядами.
// null, если не число или вне границ; дробное для целого параметра тоже ошибка, без округления
export function parseNumberInput(text: string, range: NumberRange): number | null {
  const s = text.replace(/[\s  ]/g, '').replace(',', '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null
  const value = Number(s)
  if (!Number.isFinite(value) || value < range.min || value > range.max) return null
  if (range.integer && !Number.isInteger(value)) return null
  return value
}
