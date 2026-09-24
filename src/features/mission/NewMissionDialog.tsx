import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { DEFAULT_DRONE_PROFILE_ID, DEFAULT_FLIGHT_ALTITUDE_M, DEFAULT_LIMITS } from '@/domain/defaults'
import type { Mission, MissionType } from '@/domain/types'
import { useDroneProfile } from '@/hooks/useMissions'
import { missions } from '@/storage/missions'
import { DroneSelect, DroneSummary, Field, TextInput, TypePicker } from './MissionFields'
import { FLIGHT_ALTITUDE_MAX_M, FLIGHT_ALTITUDE_MIN_M, formatValue, parseInRange, validateName } from './missionView'

interface NewMissionDialogProps {
  isOpen: boolean
  onClose: () => void
  // Вызывается после записи; новая миссия к этому моменту уже активная
  onCreated?: (mission: Mission) => void
}

export default function NewMissionDialog({ isOpen, onClose, onCreated }: NewMissionDialogProps) {
  const { t } = useTranslation()
  // Modal не рисует содержимое закрытым, поэтому форма каждый раз открывается чистой
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('mission.newDialog.title')}>
      <NewMissionForm onClose={onClose} onCreated={onCreated} />
    </Modal>
  )
}

function NewMissionForm({ onClose, onCreated }: Omit<NewMissionDialogProps, 'isOpen'>) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const [name, setName] = useState('')
  const [type, setType] = useState<MissionType>('planned')
  const [droneId, setDroneId] = useState(DEFAULT_DRONE_PROFILE_ID)
  const [altitude, setAltitude] = useState(String(DEFAULT_FLIGHT_ALTITUDE_M))
  const [touched, setTouched] = useState({ name: false, altitude: false })
  const [saving, setSaving] = useState(false)
  // Два Enter подряд успевают до перерисовки с заблокированной кнопкой — без флага вышли бы две миссии
  const savingRef = useRef(false)
  const drone = useDroneProfile(droneId)

  const nameError = validateName(name)
  const alt = parseInRange(altitude, FLIGHT_ALTITUDE_MIN_M, FLIGHT_ALTITUDE_MAX_M)
  // Лимиты новой миссии — по умолчанию; для потолка действует меньшее из миссии и дрона
  const ceilingM = drone ? Math.min(drone.maxAltitudeM, DEFAULT_LIMITS.maxAltitudeM) : DEFAULT_LIMITS.maxAltitudeM
  const aboveCeiling = alt.ok && alt.value > ceilingM

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched({ name: true, altitude: true })
    if (nameError || !alt.ok || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const mission = await missions.create({ name: name.trim(), type, droneProfileId: droneId, flightAltitudeM: alt.value })
      toast.success(t('mission.toast.created'))
      onClose()
      onCreated?.(mission)
    } catch (error) {
      console.error('Не удалось создать миссию:', error)
      toast.error(t('mission.errors.createFailed'))
      savingRef.current = false
      setSaving(false)
    }
  }

  // Escape обрабатываем здесь: во время записи окно не закрывается.
  // preventDefault сообщает Modal, что Escape уже обработан
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    if (!savingRef.current) onClose()
  }

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} noValidate className="space-y-4">
      <Field id="new-mission-name" label={t('mission.fields.name')} error={touched.name ? nameError : null}>
        <TextInput
          id="new-mission-name"
          value={name}
          maxLength={120}
          autoFocus
          placeholder={t('mission.newDialog.namePlaceholder')}
          error={touched.name ? nameError : null}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <TypePicker name="new-mission-type" value={type} onChange={setType} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field id="new-mission-drone" label={t('mission.fields.drone')} hint={<DroneSummary drone={drone} />}>
          <DroneSelect id="new-mission-drone" value={droneId} onChange={setDroneId} hasHint={!!drone} />
        </Field>
        <Field
          id="new-mission-altitude"
          label={t('mission.fields.flightAltitude')}
          error={touched.altitude && !alt.ok ? alt.error : null}
          hint={t('mission.newDialog.altitudeHint', { min: FLIGHT_ALTITUDE_MIN_M, max: FLIGHT_ALTITUDE_MAX_M })}
        >
          <TextInput
            id="new-mission-altitude"
            inputMode="decimal"
            value={altitude}
            hasHint
            error={touched.altitude && !alt.ok ? alt.error : null}
            onChange={(e) => setAltitude(e.target.value)}
            onBlur={() => setTouched((s) => ({ ...s, altitude: true }))}
          />
        </Field>
      </div>

      {aboveCeiling && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('mission.aboveCeiling', { value: formatValue(ceilingM, lang) })}
        </p>
      )}

      <p className="text-xs text-gray-500">{t('mission.newDialog.limitsNote')}</p>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" isLoading={saving}>
          {t('mission.newDialog.submit')}
        </Button>
      </div>
    </form>
  )
}
