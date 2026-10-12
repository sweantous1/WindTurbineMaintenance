import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import type { Farm, GeoPoint, WeatherSnapshot } from '@/domain/types'
import { diffTurbines, importedFarmName, type FarmImport } from '@/lib/kml'
import { FAR_TAKEOFF_M, importDropsWeather, importTakeoffDistanceM, importWeatherDistanceM } from './farmEdit'
import { formatNumber } from './format'

interface ImportFarmDialogProps {
  imp: FarmImport
  currentFarm?: Farm
  // точка взлёта миссии; undefined - не задана, станет центром новой фермы
  takeoff?: GeoPoint
  // прогноз миссии и выбран ли по нему час вылета: если ферма далеко, импорт его сбросит
  weather?: WeatherSnapshot
  hasDepartureTime: boolean
  hasRoute: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: (opts: { moveTakeoff: boolean }) => void
}

function Stat({ label, value, hint, tone = 'normal' }: { label: string; value: string; hint?: string; tone?: 'normal' | 'good' | 'bad' | 'warn' }) {
  const color = { normal: 'text-gray-900', good: 'text-green-700', bad: 'text-red-700', warn: 'text-amber-700' }[tone]
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  )
}

// Показывает, что нашлось в файле и чем новая ферма отличается от текущей, до замены
export default function ImportFarmDialog({
  imp,
  currentFarm,
  takeoff,
  weather,
  hasDepartureTime,
  hasRoute,
  busy,
  onCancel,
  onConfirm,
}: ImportFarmDialogProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const replacing = !!currentFarm && currentFarm.turbines.length > 0
  const diff = replacing ? diffTurbines(currentFarm.turbines, imp.turbines) : undefined
  const sameFile = replacing && currentFarm.source?.sha256 === imp.sha256
  const takeoffDistanceM = importTakeoffDistanceM(takeoff, imp)
  const takeoffFar = takeoffDistanceM !== undefined && takeoffDistanceM > FAR_TAKEOFF_M
  const [moveTakeoff, setMoveTakeoff] = useState(takeoffFar)
  const weatherDistanceM = importWeatherDistanceM(weather, imp)
  const dropsWeather = importDropsWeather(weather, imp)
  // имя, которое реально сохранится: старое переносится только на ту же ферму
  const farmName = importedFarmName(imp, currentFarm)
  const n = (v: number) => formatNumber(v, lang)
  const actions = useRef<HTMLDivElement>(null)
  // фиксируем на момент открытия, чтобы фокус не прыгал, если ферму поменяли в другом окне
  const focusCancel = useRef(replacing)

  // при замене фермы фокус на "Отмене", чтобы Enter случайно не сбросил маршрут;
  // после закрытия возвращаем фокус на кнопку импорта
  useEffect(() => {
    const previous = document.activeElement
    const buttons = actions.current?.querySelectorAll('button')
    buttons?.[focusCancel.current ? 0 : buttons.length - 1]?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  return (
    <Modal isOpen onClose={busy ? () => {} : onCancel} title={t('routePlan.import.title')}>
      <div className="space-y-4">
        <div className="text-sm text-gray-600 space-y-0.5">
          <p className="break-all">
            <span className="text-gray-500">{t('routePlan.import.file')}: </span>
            {imp.fileName}
          </p>
          <p>
            <span className="text-gray-500">{t('routePlan.import.farmName')}: </span>
            {farmName ?? t('routePlan.import.noName')}
            {farmName !== undefined && !imp.name && <span className="text-gray-500"> ({t('routePlan.import.nameFromCurrent')})</span>}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label={t('routePlan.import.found')} value={n(imp.turbines.length)} tone="good" />
          <Stat label={t('routePlan.import.skipped')} value={n(imp.skipped)} hint={t('routePlan.import.skippedHint')} />
          <Stat label={t('routePlan.import.merged')} value={n(imp.merged)} hint={t('routePlan.import.mergedHint')} />
        </div>

        {diff && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-800">
              {t('routePlan.import.diffTitle', { count: currentFarm?.turbines.length ?? 0 })}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('routePlan.import.added')} value={`+${n(diff.added)}`} tone={diff.added > 0 ? 'good' : 'normal'} />
              <Stat label={t('routePlan.import.removed')} value={`−${n(diff.removed)}`} tone={diff.removed > 0 ? 'bad' : 'normal'} />
              <Stat label={t('routePlan.import.moved')} value={n(diff.moved)} tone={diff.moved > 0 ? 'warn' : 'normal'} />
            </div>
            {sameFile && <p className="text-xs text-gray-500">{t('routePlan.import.sameFile')}</p>}
            <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
              {hasRoute ? t('routePlan.import.replaceWithRoute') : t('routePlan.import.replace')}
            </p>
          </div>
        )}

        {takeoffFar && takeoffDistanceM !== undefined && (
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={moveTakeoff}
              onChange={(e) => setMoveTakeoff(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            {t('routePlan.import.moveTakeoff', { km: formatNumber(takeoffDistanceM / 1000, lang, 1) })}
          </label>
        )}

        {dropsWeather && weatherDistanceM !== undefined && (
          <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
            {t(hasDepartureTime ? 'routePlan.import.weatherResetWithDeparture' : 'routePlan.import.weatherReset', {
              km: formatNumber(weatherDistanceM / 1000, lang),
            })}
          </p>
        )}

        <div ref={actions} className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button isLoading={busy} onClick={() => onConfirm({ moveTakeoff })}>
            {replacing ? t('routePlan.import.confirmReplace') : t('routePlan.import.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
