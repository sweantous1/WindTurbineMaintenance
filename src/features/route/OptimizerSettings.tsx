import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import type { SolveProgress } from '@/domain/route'
import NumberField from './NumberField'
import { formatKm, formatNumber } from './format'
import {
  ALGORITHMS,
  FLIGHT_ALTITUDE_RANGE,
  PARAM_DEFS,
  THETA_RANGE,
  defaultParams,
  normalizeParams,
  withAlgorithm,
  type ParamDef,
} from './optimizerParams'
import type { OptimizerSettings as Settings } from './routeLogic'

export interface SolvingState {
  progress?: SolveProgress
}

interface OptimizerSettingsProps {
  settings: Settings
  onSettingsChange: (next: Settings) => void
  flightAltitudeM: number
  onFlightAltitudeChange: (altM: number) => void
  ceilingM: number
  // Миссия облетана — всё только для просмотра
  readOnly: boolean
  solving: SolvingState | null
  // Почему строить нельзя (нет турбин); undefined — можно
  buildBlockedReason?: string
  hasRoute: boolean
  changedFromRoute: boolean
  onBuild: () => void
  onCancel: () => void
}

export default function OptimizerSettings({
  settings,
  onSettingsChange,
  flightAltitudeM,
  onFlightAltitudeChange,
  ceilingM,
  readOnly,
  solving,
  buildBlockedReason,
  hasRoute,
  changedFromRoute,
  onBuild,
  onCancel,
}: OptimizerSettingsProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const groupId = useId()
  const disabled = readOnly || solving !== null
  const params = normalizeParams(settings.algorithm, settings.params)
  const defaults = defaultParams(settings.algorithm)

  const setParam = (key: string, value: number) => onSettingsChange({ ...settings, params: { ...params, [key]: value } })

  const formatDefault = (def: ParamDef, value: number) => {
    const option = def.options?.find((o) => o.value === value)
    return option ? t(option.labelKey) : formatNumber(value, lang, 3)
  }

  const renderParam = (def: ParamDef) => {
    const label = t(`routePlan.settings.params.${def.key}`)
    const defaultHint = t('routePlan.settings.defaultValue', { value: formatDefault(def, defaults[def.key]) })
    if (def.options) {
      const selectId = `${groupId}-${def.key}`
      return (
        <div key={def.key}>
          <label htmlFor={selectId} className="block text-xs font-medium text-gray-600 mb-1">
            {label}
          </label>
          <select
            id={selectId}
            value={params[def.key]}
            disabled={disabled}
            onChange={(e) => setParam(def.key, Number(e.target.value))}
            className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-400"
          >
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </div>
      )
    }
    return (
      <NumberField
        key={def.key}
        label={label}
        value={params[def.key]}
        range={def}
        disabled={disabled}
        hint={defaultHint}
        onCommit={(v) => setParam(def.key, v)}
      />
    )
  }

  const progress = solving?.progress
  const progressPct = progress && progress.total > 0 ? Math.min(100, (progress.iteration / progress.total) * 100) : undefined

  return (
    <Card title={t('routePlan.settings.title')}>
      <div className="space-y-4">
        <NumberField
          label={t('routePlan.settings.flightAltitude')}
          unit={t('routePlan.units.m')}
          value={flightAltitudeM}
          range={FLIGHT_ALTITUDE_RANGE}
          disabled={disabled}
          onCommit={onFlightAltitudeChange}
          hint={
            flightAltitudeM > ceilingM
              ? t('routePlan.settings.altitudeAboveCeiling', { ceiling: formatNumber(ceilingM, lang) })
              : t('routePlan.settings.altitudeHint', { ceiling: formatNumber(ceilingM, lang) })
          }
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.returnToTakeoff}
            disabled={disabled}
            onChange={(e) => onSettingsChange({ ...settings, returnToTakeoff: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          {t('routePlan.settings.returnToTakeoff')}
        </label>

        <fieldset disabled={disabled}>
          <legend className="block text-xs font-medium text-gray-600 mb-1.5">{t('routePlan.settings.algorithm')}</legend>
          <div className="space-y-1.5">
            {ALGORITHMS.map((a) => (
              <label
                key={a}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                  settings.algorithm === a ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                } ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name={`${groupId}-algorithm`}
                  checked={settings.algorithm === a}
                  onChange={() => onSettingsChange(withAlgorithm(settings, a))}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800">{t(`routePlan.settings.algorithms.${a}`)}</span>
                  <span className="block text-xs text-gray-500">{t(`routePlan.settings.algorithmHints.${a}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <details className="rounded-lg border border-gray-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700">
            {t('routePlan.settings.expert')}
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-3">
            <NumberField
              label={t('routePlan.settings.thetaMax')}
              unit="°"
              value={settings.thetaMaxDeg}
              range={THETA_RANGE}
              disabled={disabled}
              hint={t('routePlan.settings.thetaHint')}
              onCommit={(v) => onSettingsChange({ ...settings, thetaMaxDeg: v })}
            />
            <p className="text-xs font-medium text-gray-500 pt-1">
              {t('routePlan.settings.paramsOf', { algorithm: t(`routePlan.settings.algorithms.${settings.algorithm}`) })}
            </p>
            <div className="grid grid-cols-2 gap-3">{PARAM_DEFS[settings.algorithm].map(renderParam)}</div>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onSettingsChange({ ...settings, params: defaultParams(settings.algorithm) })}
            >
              {t('routePlan.settings.resetParams')}
            </Button>
          </div>
        </details>

        {hasRoute && changedFromRoute && !readOnly && (
          <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
            {t('routePlan.settings.changed')}
          </p>
        )}

        {solving && (
          <div className="space-y-2">
            <div
              role="progressbar"
              aria-label={t('routePlan.build.progressLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct === undefined ? undefined : Math.round(progressPct)}
              className="h-2 rounded-full bg-gray-100 overflow-hidden"
            >
              {progressPct === undefined ? (
                <div className="h-full w-1/3 bg-blue-400 animate-pulse" />
              ) : (
                <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${progressPct}%` }} />
              )}
            </div>
            <p className="text-xs text-gray-600">
              {progress
                ? t('routePlan.build.progress', {
                    iteration: formatNumber(progress.iteration, lang),
                    total: formatNumber(progress.total, lang),
                  })
                : t('routePlan.build.starting')}
            </p>
            {progress && Number.isFinite(progress.bestLengthM) && (
              <p className="text-xs text-gray-600">{t('routePlan.build.best', { km: formatKm(progress.bestLengthM, lang) })}</p>
            )}
          </div>
        )}

        {/* Одна и та же кнопка становится «Отменой» на время расчёта: фокус клавиатуры не теряется */}
        {(solving || !readOnly) && (
          <div className="space-y-1.5">
            <Button
              variant={solving ? 'secondary' : 'primary'}
              className="w-full"
              disabled={!solving && buildBlockedReason !== undefined}
              onClick={(e) => {
                if (!solving) onBuild()
                // Второй щелчок двойного клика по «Построить» не должен тут же отменить расчёт
                else if (e.detail <= 1) onCancel()
              }}
            >
              {solving ? t('routePlan.build.cancel') : hasRoute ? t('routePlan.build.rebuild') : t('routePlan.build.button')}
            </Button>
            {!solving && buildBlockedReason && <p className="text-xs text-gray-500">{buildBlockedReason}</p>}
          </div>
        )}
      </div>
    </Card>
  )
}
