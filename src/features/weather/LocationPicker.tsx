import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Farm } from '@/domain/types'
import { geocode, type GeocodeResult } from '@/services/openMeteo'
import { isAbortError, weatherErrorMessage } from './errors'
import { formatNumber } from './format'
import {
  distanceToFarmM,
  FAR_FROM_FARM_M,
  farmPoint,
  formatCoords,
  geocodeLabel,
  parseLatitude,
  parseLongitude,
  type ForecastPoint,
  type ParseResult,
  type CoordError,
} from './location'

type Mode = ForecastPoint['source']

interface LocationPickerProps {
  farm?: Farm
  value: ForecastPoint | null
  onChange: (p: ForecastPoint | null) => void
  disabled?: boolean
}

// Пауза перед поиском: запрос уходит, когда пользователь перестал печатать
const SEARCH_DELAY_MS = 350

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-gray-50 disabled:text-gray-500'

function manualPoint(lat: string, lon: string): ForecastPoint | null {
  const a = parseLatitude(lat)
  const b = parseLongitude(lon)
  return a.ok && b.ok ? { lat: a.value, lon: b.value, source: 'manual' } : null
}

export default function LocationPicker({ farm, value, onChange, disabled = false }: LocationPickerProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'ru'
  const [mode, setMode] = useState<Mode>(() => value?.source ?? (farm ? 'farm' : 'geocode'))
  // Выбранный город и введённые координаты хранятся отдельно: смена режима их не стирает
  const [picked, setPicked] = useState<ForecastPoint | null>(() => (value?.source === 'geocode' ? value : null))
  const [latText, setLatText] = useState(() => (value?.source === 'manual' ? String(value.lat) : ''))
  const [lonText, setLonText] = useState(() => (value?.source === 'manual' ? String(value.lon) : ''))

  const modes: Mode[] = farm ? ['farm', 'geocode', 'manual'] : ['geocode', 'manual']
  const activeMode: Mode = mode === 'farm' && !farm ? 'geocode' : mode

  const selectMode = (next: Mode) => {
    setMode(next)
    if (next === 'farm') onChange(farm ? farmPoint(farm) : null)
    else if (next === 'geocode') onChange(picked)
    else onChange(manualPoint(latText, lonText))
  }

  const distanceM = distanceToFarmM(value, farm)

  return (
    <div className="space-y-3">
      {/* Кнопки-переключатели, а не radio: у radio ожидают перехода стрелками, которого тут нет */}
      <div role="group" aria-label={t('weatherScreen.location.modeLabel')} className="flex rounded-lg bg-gray-100 p-1">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={activeMode === m}
            disabled={disabled}
            onClick={() => selectMode(m)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
              activeMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t(`weatherScreen.location.modes.${m}`)}
          </button>
        ))}
      </div>

      {activeMode === 'farm' && farm && (
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <p className="font-medium">
            {farm.name
              ? t('weatherScreen.location.farmCenterNamed', { name: farm.name })
              : t('weatherScreen.location.farmCenter')}
          </p>
          <p className="font-mono text-xs text-blue-800">{formatCoords(farm.center)}</p>
        </div>
      )}

      {activeMode === 'geocode' && (
        <CitySearch
          lang={lang}
          initialQuery={picked?.name ?? ''}
          disabled={disabled}
          onPick={(p) => {
            setPicked(p)
            onChange(p)
          }}
        />
      )}

      {activeMode === 'manual' && (
        <div className="grid grid-cols-2 gap-3">
          <CoordField
            label={t('weatherScreen.location.lat')}
            placeholder="48.2150"
            value={latText}
            result={parseLatitude(latText)}
            max={90}
            disabled={disabled}
            onChange={(text) => {
              setLatText(text)
              onChange(manualPoint(text, lonText))
            }}
          />
          <CoordField
            label={t('weatherScreen.location.lon')}
            placeholder="40.2840"
            value={lonText}
            result={parseLongitude(lonText)}
            max={180}
            disabled={disabled}
            onChange={(text) => {
              setLonText(text)
              onChange(manualPoint(latText, text))
            }}
          />
        </div>
      )}

      {value && activeMode !== 'farm' && (
        <div className="text-xs text-gray-600 space-y-1">
          <p>
            {t('weatherScreen.location.selected')}{' '}
            <span className="font-medium text-gray-900">{value.name ?? t('weatherScreen.location.manualPoint')}</span>{' '}
            <span className="font-mono">({formatCoords(value)})</span>
          </p>
          {distanceM !== undefined && (
            <p className={distanceM > FAR_FROM_FARM_M ? 'text-amber-800' : undefined}>
              {t('weatherScreen.location.distanceToFarm', { km: formatNumber(distanceM / 1000, lang, 1) })}
              {distanceM > FAR_FROM_FARM_M && ` ${t('weatherScreen.location.farWarning')}`}
            </p>
          )}
        </div>
      )}
      {!value && activeMode !== 'farm' && (
        <p className="text-xs text-gray-500">{t(`weatherScreen.location.hint.${activeMode}`)}</p>
      )}
    </div>
  )
}

interface CoordFieldProps {
  label: string
  placeholder: string
  value: string
  result: ParseResult<CoordError>
  max: number
  disabled: boolean
  onChange: (text: string) => void
}

function CoordField({ label, placeholder, value, result, max, disabled, onChange }: CoordFieldProps) {
  const { t } = useTranslation()
  const id = useId()
  const [touched, setTouched] = useState(false)
  // Пустое поле не ругаем, пока пользователь в него не заходил
  const error = !result.ok && (result.error !== 'empty' || touched) ? result.error : null
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        className={`${inputClass} font-mono ${error ? 'border-red-400' : ''}`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
          {t(`weatherScreen.location.errors.${error}`, { max })}
        </p>
      )}
    </div>
  )
}

interface CitySearchProps {
  lang: 'ru' | 'en'
  initialQuery: string
  disabled: boolean
  onPick: (p: ForecastPoint) => void
}

function CitySearch({ lang, initialQuery, disabled, onPick }: CitySearchProps) {
  const { t } = useTranslation()
  const id = useId()
  const listId = `${id}-list`
  const [query, setQuery] = useState(initialQuery)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<GeocodeResult[]>([])
  // По какому запросу пришли results: «ничего не найдено» только для него, а не пока ждём ответа
  const [answeredQuery, setAnsweredQuery] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [active, setActive] = useState(-1)

  const q = query.trim()

  useEffect(() => {
    if (!open || q.length < 2) {
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      geocode(q, lang, ctrl.signal)
        .then((r) => {
          setResults(r)
          setAnsweredQuery(q)
          setError(null)
          setActive(r.length > 0 ? 0 : -1)
        })
        .catch((e: unknown) => {
          if (isAbortError(e)) return
          setResults([])
          setAnsweredQuery(null)
          setError(e)
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false)
        })
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [q, open, lang])

  const pick = (r: GeocodeResult) => {
    const label = geocodeLabel(r)
    setQuery(label)
    setOpen(false)
    setResults([])
    setAnsweredQuery(null)
    onPick({ lat: r.lat, lon: r.lon, name: label, source: 'geocode' })
  }

  const showList = open && results.length > 0
  const nothingFound = open && !searching && !error && answeredQuery === q && results.length === 0

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter' && showList && active >= 0) {
      e.preventDefault()
      pick(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  let status: ReactNode = null
  if (searching) status = <p className="text-xs text-gray-500">{t('weatherScreen.location.searching')}</p>
  else if (open && error != null) {
    status = (
      <p role="alert" className="text-xs text-red-700">
        {weatherErrorMessage(error, t)}
      </p>
    )
  } else if (nothingFound) status = <p className="text-xs text-gray-500">{t('weatherScreen.location.nothingFound')}</p>

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {t('weatherScreen.location.cityLabel')}
      </label>
      <div className="relative">
        <input
          id={id}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={query}
          disabled={disabled}
          placeholder={t('weatherScreen.location.cityPlaceholder')}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          className={inputClass}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
          >
            {results.map((r, i) => (
              <li
                key={`${r.lat},${r.lon},${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, а не click: иначе поле теряет фокус и список закрывается раньше выбора
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(r)
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-blue-50' : ''}`}
              >
                <div className="font-medium text-gray-900">{r.name}</div>
                <div className="text-xs text-gray-500">
                  {[r.admin1, r.country].filter(Boolean).join(', ')}
                  {r.admin1 || r.country ? ' · ' : ''}
                  <span className="font-mono">{formatCoords(r)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {status}
    </div>
  )
}
