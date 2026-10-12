import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Button from '@/components/common/Button'
import Card from '@/components/common/Card'
import Modal from '@/components/common/Modal'
import ReadOnlyBanner from '@/components/mission/ReadOnlyBanner'
import RequireMission from '@/components/mission/RequireMission'
import { effectiveLimits, transitAltitudeM } from '@/domain/flightCheck'
import { canEdit } from '@/domain/missionStatus'
import type { Mission } from '@/domain/types'
import { fetchWeatherSnapshot, findHour, isStale } from '@/domain/weather'
import FlightForecastCard from '@/features/forecast/FlightForecastCard'
import CurrentWeatherCard from '@/features/weather/CurrentWeatherCard'
import FlightWindowStrip from '@/features/weather/FlightWindowStrip'
import HourlyTable from '@/features/weather/HourlyTable'
import LocationPicker from '@/features/weather/LocationPicker'
import WindChart from '@/features/weather/WindChart'
import { chartAltitudes, hasTwoAltitudes } from '@/features/weather/chartData'
import { isAbortError, weatherErrorMessage } from '@/features/weather/errors'
import { assessHours } from '@/features/weather/flightWindow'
import { formatAge } from '@/features/weather/reasons'
import { missionFlightPlan } from '@/features/weather/forecast'
import { formatNumber, formatTimeZone, formatUtcOffset, isPastHour, snapshotAge } from '@/features/weather/format'
import { farmPoint, initialForecastHours, initialPoint, parseForecastHours, type ForecastPoint } from '@/features/weather/location'
import { buildSnapshotExport, downloadJson, snapshotFileName } from '@/features/weather/snapshotExport'
import { useNow } from '@/features/weather/useNow'
import { useMissionDrone } from '@/hooks/useMissions'
import { MAX_FORECAST_HOURS } from '@/services/openMeteo'
import { missions } from '@/storage/missions'

const HOUR_PRESETS = [24, 48, 72, 168]

export default function Weather() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('weatherScreen.title')}</h1>
        <p className="mt-1 text-gray-500">{t('weatherScreen.desc')}</p>
      </div>
      {/* key: при смене миссии незавершённый запрос отменяется и точка берётся заново */}
      <RequireMission>{(mission) => <WeatherScreen key={mission.id} mission={mission} />}</RequireMission>
    </div>
  )
}

function WeatherScreen({ mission }: { mission: Mission }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const hoursId = useId()
  const drone = useMissionDrone(mission)
  const now = useNow(30_000)
  const editable = canEdit(mission.status, 'weather')
  const snapshot = mission.weather

  const [chosenPoint, setPoint] = useState<ForecastPoint | null>(() => initialPoint(mission))
  // Центр фермы берём из миссии на каждом рендере: ферму могли переимпортировать в другом окне,
  // и прогноз по старому центру был бы не для той фермы
  let point = chosenPoint
  if (chosenPoint?.source === 'farm') point = mission.farm ? farmPoint(mission.farm) : null
  const [hoursText, setHoursText] = useState(() => String(initialForecastHours(mission)))
  const [loading, setLoading] = useState(false)
  // Храним саму ошибку, а не текст, чтобы она переводилась при смене языка
  const [error, setError] = useState<unknown>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const hours = parseForecastHours(hoursText)
  const canFetch = editable && point !== null && hours.ok

  const plan = useMemo(() => (drone ? missionFlightPlan(mission, drone) : undefined), [mission, drone])
  const limits = useMemo(() => (drone ? effectiveLimits(mission.limits, drone) : undefined), [mission.limits, drone])
  // Без плана берём высоту транзита, прижатую к потолку, как в вердикте,
  // иначе график покажет ветер на 150 м, а вердикт посчитает на 120 м
  const noPlanAltM = limits ? transitAltitudeM(mission.flightAltitudeM, limits) : mission.flightAltitudeM
  const altitudes = useMemo(() => chartAltitudes(plan, noPlanAltM), [plan, noPlanAltM])
  const cells = useMemo(
    () =>
      drone && snapshot
        ? assessHours(snapshot.hourly, { limits: mission.limits, drone, plan, flightAltitudeM: mission.flightAltitudeM })
        : [],
    [drone, snapshot, mission.limits, mission.flightAltitudeM, plan],
  )
  // У облетанной миссии прошедшие часы не отмечаем: это запись, а не выбор вылета
  const isPast = useCallback(
    (time: string) => (editable && snapshot ? isPastHour(time, snapshot, now) : false),
    [editable, snapshot, now],
  )

  const fetchForecast = async () => {
    if (!canFetch || !point || !hours.ok) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const next = await fetchWeatherSnapshot(
        { lat: point.lat, lon: point.lon },
        hours.value,
        {
          source: point.source,
          ...(point.name ? { name: point.name } : {}),
          ...(mission.farm ? { farmCenter: mission.farm.center } : {}),
        },
        ctrl.signal,
      )
      // Отмена или уход с экрана уже после ответа сервера - в миссию не пишем
      if (ctrl.signal.aborted) return
      // Час вылета перечитываем из базы, пока шёл запрос его могли поменять
      const departure = (await missions.get(mission.id))?.departureTime
      const dropDeparture = departure !== undefined && findHour(next, departure) === undefined
      await missions.update(mission.id, { weather: next, ...(dropDeparture ? { departureTime: undefined } : {}) })
      toast.success(t('weatherScreen.toast.saved'))
      if (dropDeparture) toast.info(t('weatherScreen.toast.departureDropped'))
    } catch (e) {
      if (isAbortError(e)) return
      setError(e)
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }

  const selectHour = async (time: string) => {
    try {
      await missions.update(mission.id, { departureTime: time })
    } catch (e) {
      toast.error(weatherErrorMessage(e, t))
    }
  }

  const clearWeather = async () => {
    try {
      await missions.update(mission.id, { weather: undefined, departureTime: undefined })
      setConfirmClear(false)
      toast.success(t('weatherScreen.toast.cleared'))
    } catch (e) {
      toast.error(weatherErrorMessage(e, t))
    }
  }

  const exportJson = () => {
    if (!snapshot) return
    downloadJson(snapshotFileName(mission.name, snapshot.fetchedAt), buildSnapshotExport(mission, snapshot))
  }

  const age = snapshot ? snapshotAge(snapshot.fetchedAt, now) : null
  const stale = editable && snapshot !== undefined && isStale(snapshot, now)
  const alt = (m: number) => formatNumber(m, lang, 0)
  let altitudeNote: string
  if (!plan) altitudeNote = t('weatherScreen.chart.noPlan', { alt: alt(noPlanAltM) })
  else if (hasTwoAltitudes(altitudes)) {
    altitudeNote = t('weatherScreen.chart.fromPlan', { transit: alt(altitudes.transitAltM), top: alt(altitudes.topAltM) })
  } else altitudeNote = t('weatherScreen.chart.fromPlanSingle', { alt: alt(altitudes.transitAltM) })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {t('weatherScreen.missionLabel')} <span className="font-medium text-gray-900">{mission.name}</span>
        </p>
        {snapshot && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={exportJson}>
              {t('weatherScreen.actions.export')}
            </Button>
            {editable && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
                {t('weatherScreen.actions.clear')}
              </Button>
            )}
          </div>
        )}
      </div>

      <ReadOnlyBanner mission={mission} />

      {stale && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span>
            {t('weatherScreen.stale', { age: formatAge(age, t) })}
          </span>
          <Button size="sm" onClick={fetchForecast} isLoading={loading} disabled={!canFetch}>
            {t('weatherScreen.actions.refresh')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {editable && (
          <Card title={t('weatherScreen.request.title')} className="md:col-span-1">
            <div className="space-y-4">
              <LocationPicker farm={mission.farm} value={point} onChange={setPoint} disabled={loading} />

              <div>
                <label htmlFor={hoursId} className="mb-1 block text-xs font-medium text-gray-700">
                  {t('weatherScreen.request.hours')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={hoursId}
                    type="text"
                    inputMode="numeric"
                    value={hoursText}
                    disabled={loading}
                    aria-invalid={!hours.ok}
                    aria-describedby={`${hoursId}-hint`}
                    onChange={(e) => setHoursText(e.target.value)}
                    className={`w-20 rounded-lg border px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                      hours.ok ? 'border-gray-300' : 'border-red-400'
                    }`}
                  />
                  <div role="group" aria-label={t('weatherScreen.request.presets')} className="flex flex-wrap gap-1">
                    {HOUR_PRESETS.map((h) => (
                      <button
                        key={h}
                        type="button"
                        disabled={loading}
                        aria-pressed={hours.ok && hours.value === h}
                        onClick={() => setHoursText(String(h))}
                        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          hours.ok && hours.value === h ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
                <p id={`${hoursId}-hint`} className={`mt-1 text-xs ${hours.ok ? 'text-gray-500' : 'text-red-700'}`}>
                  {hours.ok
                    ? t('weatherScreen.request.hoursHint', { max: MAX_FORECAST_HOURS })
                    : t(`weatherScreen.request.hoursErrors.${hours.error}`, { max: MAX_FORECAST_HOURS })}
                </p>
              </div>

              {error != null && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {weatherErrorMessage(error, t)}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={fetchForecast} isLoading={loading} disabled={!canFetch} className="flex-1">
                  {loading ? t('weatherScreen.request.loading') : t('weatherScreen.request.fetch')}
                </Button>
                {loading && (
                  <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                    {t('common.cancel')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-gray-500">{t('weatherScreen.request.source')}</p>
            </div>
          </Card>
        )}

        <div className={editable ? 'md:col-span-2' : 'md:col-span-3'}>
          {snapshot ? (
            <CurrentWeatherCard snapshot={snapshot} farm={mission.farm} now={now} />
          ) : (
            <Card>
              <div className="space-y-2 py-10 text-center">
                <p className="font-medium text-gray-700">{t('weatherScreen.empty.title')}</p>
                <p className="text-sm text-gray-500">
                  {editable ? t('weatherScreen.empty.hint') : t('weatherScreen.empty.readOnly')}
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {snapshot && (
        <>
          <Card
            title={t('weatherScreen.window.title')}
            subtitle={t('weatherScreen.window.subtitle', {
              zone: formatTimeZone(snapshot.timezone, lang),
              offset: formatUtcOffset(snapshot.utcOffsetSeconds),
            })}
          >
            {drone ? (
              <FlightWindowStrip
                cells={cells}
                selectedTime={mission.departureTime}
                onSelect={editable ? selectHour : undefined}
                isPast={isPast}
              />
            ) : (
              <p className="py-6 text-center text-sm text-gray-500">{t('common.loading')}</p>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card title={t('weatherScreen.chart.title')} subtitle={altitudeNote} className="md:col-span-2">
              {limits ? (
                <WindChart hours={snapshot.hourly} altitudes={altitudes} limits={limits} selectedTime={mission.departureTime} />
              ) : (
                <p className="py-6 text-center text-sm text-gray-500">{t('common.loading')}</p>
              )}
            </Card>
            <div>
              <FlightForecastCard mission={mission} now={now} />
            </div>
          </div>

          <HourlyTable hours={snapshot.hourly} selectedTime={mission.departureTime} />
        </>
      )}

      <Modal isOpen={confirmClear} onClose={() => setConfirmClear(false)} title={t('weatherScreen.clearConfirm.title')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-700">{t('weatherScreen.clearConfirm.text')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={clearWeather}>
              {t('weatherScreen.actions.clear')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
