import type { InputHTMLAttributes, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DroneProfile, MissionType } from '@/domain/types'
import { droneDisplayName } from '@/features/settings/droneName'
import { useDroneProfiles } from '@/hooks/useMissions'
import { formatValue, MISSION_TYPES, type FieldError } from './missionView'

// Поля миссии, общие для диалогов создания и параметров

const controlClass =
  'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed'

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  error?: FieldError | null
  // Есть подсказка в Field, диктор прочитает её вместе с подписью
  hasHint?: boolean
}

// Field показывает либо ошибку, либо подсказку, describedby ссылается на видимую
const describedBy = (id: string, error: FieldError | null | undefined, hasHint: boolean | undefined) =>
  error ? `${id}-error` : hasHint ? `${id}-hint` : undefined

export function TextInput({ id, error, hasHint, className = '', ...props }: TextInputProps) {
  return (
    <input
      id={id}
      type="text"
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, error, hasHint)}
      className={`${controlClass} ${error ? 'border-red-400' : 'border-gray-300'} ${className}`}
      {...props}
    />
  )
}

interface FieldProps {
  id: string
  label: string
  error?: FieldError | null
  hint?: ReactNode
  children: ReactNode
}

export function Field({ id, label, error, hint, children }: FieldProps) {
  const { t } = useTranslation()
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {t(error.key, error.params)}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

interface TypePickerProps {
  name: string
  value: MissionType
  onChange: (type: MissionType) => void
  disabled?: boolean
  lockedHint?: string
}

export function TypePicker({ name, value, onChange, disabled, lockedHint }: TypePickerProps) {
  const { t } = useTranslation()
  return (
    <fieldset disabled={disabled} title={disabled ? lockedHint : undefined} className="min-w-0">
      <legend className="block text-sm font-medium text-gray-700 mb-1">{t('mission.fields.type')}</legend>
      <div className="grid grid-cols-3 gap-2">
        {MISSION_TYPES.map((type) => {
          const checked = value === type
          return (
            <label
              key={type}
              className={`flex items-center justify-center rounded-lg border px-2 py-2 text-center text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 ${
                checked ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-700'
              } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}
            >
              <input
                type="radio"
                name={name}
                value={type}
                checked={checked}
                onChange={() => onChange(type)}
                className="sr-only"
              />
              {t(`mission.types.${type}`)}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

interface DroneSelectProps {
  id: string
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  title?: string
  hasHint?: boolean
  // Имя дрона из снимка облетанной миссии - показываем тот, с которым летали
  fixedName?: string
}

export function DroneSelect({ id, value, onChange, disabled, title, hasHint, fixedName }: DroneSelectProps) {
  const { t } = useTranslation()
  const profiles = useDroneProfiles()
  // Профиль могли удалить в настройках, тогда расчёты идут по профилю по умолчанию
  const known = profiles?.some((p) => p.id === value) ?? true

  if (fixedName !== undefined) {
    return (
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled
        title={title}
        aria-describedby={describedBy(id, null, hasHint)}
        className={`${controlClass} border-gray-300 bg-white`}
      >
        <option value={value}>{fixedName}</option>
      </select>
    )
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || !profiles}
      title={title}
      aria-describedby={describedBy(id, null, hasHint)}
      className={`${controlClass} border-gray-300 bg-white`}
    >
      {!profiles && <option value={value}>{t('common.loading')}</option>}
      {profiles && !known && <option value={value}>{t('mission.droneMissing')}</option>}
      {profiles?.map((p) => (
        <option key={p.id} value={p.id}>
          {droneDisplayName(p, t)}
        </option>
      ))}
    </select>
  )
}

// Сводка выбранного профиля под списком
export function DroneSummary({ drone }: { drone: DroneProfile | undefined }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  if (!drone) return null
  return (
    <>
      {t('mission.droneSummary', {
        wind: formatValue(drone.maxWindMs, lang),
        gust: formatValue(drone.maxGustMs, lang),
        alt: formatValue(drone.maxAltitudeM, lang),
        endurance: formatValue(drone.enduranceMin, lang, 0),
      })}
    </>
  )
}
