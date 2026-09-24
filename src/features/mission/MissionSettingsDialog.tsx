import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { DEFAULT_LIMITS } from '@/domain/defaults'
import { canEdit, isPreFlight } from '@/domain/missionStatus'
import type { Mission, MissionPatch, MissionType } from '@/domain/types'
import { useDroneProfile } from '@/hooks/useMissions'
import { MissionLockedError, missions } from '@/storage/missions'
import { DroneSelect, DroneSummary, Field, TextInput, TypePicker } from './MissionFields'
import {
  buildSettingsPatch,
  FLIGHT_ALTITUDE_MAX_M,
  FLIGHT_ALTITUDE_MIN_M,
  formatValue,
  LIMIT_FIELDS,
  limitsToForm,
  parseInRange,
  parseLimits,
  validateName,
  withRouteLength,
  type FieldError,
  type LimitKey,
  type LimitsForm,
} from './missionView'

interface MissionSettingsDialogProps {
  mission: Mission
  isOpen: boolean
  onClose: () => void
}

export default function MissionSettingsDialog({ mission, isOpen, onClose }: MissionSettingsDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('mission.settings.title')}>
      <SettingsForm mission={mission} onClose={onClose} />
    </Modal>
  )
}

const EDITABLE_FIELDS: readonly (keyof MissionPatch)[] = ['name', 'type', 'droneProfileId', 'flightAltitudeM', 'limits']

function SettingsForm({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const editable = (f: keyof MissionPatch) => canEdit(mission.status, f)
  const [nameDraft, setName] = useState(mission.name)
  const [typeDraft, setType] = useState<MissionType>(mission.type)
  const [droneDraft, setDroneId] = useState(mission.droneProfileId)
  const [altitudeDraft, setAltitude] = useState(String(mission.flightAltitudeM))
  const [limitsDraft, setLimitsForm] = useState<LimitsForm>(() => limitsToForm(mission.limits))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  // Запрещённое поле показывает записанное значение, а не черновик: миссию могли завершить,
  // пока окно открыто, и тогда в отключённом поле осталась бы несохранённая правка
  const name = editable('name') ? nameDraft : mission.name
  const type = editable('type') ? typeDraft : mission.type
  const droneId = editable('droneProfileId') ? droneDraft : mission.droneProfileId
  const altitude = editable('flightAltitudeM') ? altitudeDraft : String(mission.flightAltitudeM)
  const limitsForm = editable('limits') ? limitsDraft : limitsToForm(mission.limits)
  const drone = useDroneProfile(droneId)

  // Запрещённые поля не проверяем: в них то, что записано, и в патч они не попадут
  const nameError = editable('name') ? validateName(name) : null
  const alt = editable('flightAltitudeM')
    ? parseInRange(altitude, FLIGHT_ALTITUDE_MIN_M, FLIGHT_ALTITUDE_MAX_M)
    : { ok: true as const, value: mission.flightAltitudeM }
  const limits = editable('limits') ? parseLimits(limitsForm) : { limits: mission.limits, errors: {} }
  const limitErrors: Partial<Record<LimitKey, FieldError>> = limits.errors
  const anyEditable = EDITABLE_FIELDS.some(editable)
  const lockedHint = mission.status === 'archived' ? t('mission.settings.lockedArchived') : t('mission.settings.lockedFlown')

  const ceilingLimit = limits.limits?.maxAltitudeM ?? mission.limits.maxAltitudeM
  const ceilingM = drone ? Math.min(ceilingLimit, drone.maxAltitudeM) : ceilingLimit
  // Облетанную миссию поправить уже нельзя — предупреждать не о чем
  const aboveCeiling = isPreFlight(mission.status) && alt.ok && alt.value > ceilingM

  const setLimit = (k: LimitKey, v: string) => setLimitsForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (savingRef.current || nameError || !alt.ok || !limits.limits) return
    // Патч — от той миссии, что видел человек: если её тем временем завершили,
    // репозиторий откажет с MissionLockedError, и правка не пропадёт молча
    const patch = buildSettingsPatch(mission, {
      name,
      type,
      droneProfileId: droneId,
      flightAltitudeM: alt.value,
      limits: limits.limits,
    })
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      // Маршрут берётся из базы: его могли пересчитать на другом экране
      const fresh = (await missions.get(mission.id)) ?? mission
      await missions.update(mission.id, drone ? withRouteLength(fresh, patch, ceilingM) : patch)
      toast.success(t('mission.toast.saved'))
      onClose()
    } catch (error) {
      savingRef.current = false
      setSaving(false)
      if (error instanceof MissionLockedError) {
        const fields = error.fields.map((f) => t(`mission.fieldNames.${f}`, { defaultValue: f })).join(', ')
        toast.error(t('mission.errors.locked', { fields }))
        return
      }
      console.error('Не удалось сохранить параметры миссии:', error)
      toast.error(t('mission.errors.saveFailed'))
    }
  }

  const limitLocked = !editable('limits')
  const showError = (k: LimitKey) => (submitted ? limitErrors[k] : null)

  // Escape обрабатываем здесь: пока идёт запись, окно не закрывается.
  // preventDefault сообщает Modal, что Escape уже обработан
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    if (!savingRef.current) onClose()
  }

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} noValidate className="space-y-4">
      {!isPreFlight(mission.status) && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{lockedHint}</p>
      )}

      <Field id="mission-settings-name" label={t('mission.fields.name')} error={submitted ? nameError : null}>
        <TextInput
          id="mission-settings-name"
          value={name}
          maxLength={120}
          autoFocus={editable('name')}
          disabled={!editable('name')}
          title={!editable('name') ? lockedHint : undefined}
          error={submitted ? nameError : null}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <TypePicker
        name="mission-settings-type"
        value={type}
        onChange={setType}
        disabled={!editable('type')}
        lockedHint={lockedHint}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field id="mission-settings-drone" label={t('mission.fields.drone')} hint={<DroneSummary drone={drone} />}>
          <DroneSelect
            id="mission-settings-drone"
            value={droneId}
            onChange={setDroneId}
            hasHint={!!drone}
            disabled={!editable('droneProfileId')}
            title={!editable('droneProfileId') ? lockedHint : undefined}
          />
        </Field>
        <Field
          id="mission-settings-altitude"
          label={t('mission.fields.flightAltitude')}
          error={submitted && !alt.ok ? alt.error : null}
          hint={t('mission.newDialog.altitudeHint', { min: FLIGHT_ALTITUDE_MIN_M, max: FLIGHT_ALTITUDE_MAX_M })}
        >
          <TextInput
            id="mission-settings-altitude"
            inputMode="decimal"
            value={altitude}
            hasHint
            disabled={!editable('flightAltitudeM')}
            title={!editable('flightAltitudeM') ? lockedHint : undefined}
            error={submitted && !alt.ok ? alt.error : null}
            onChange={(e) => setAltitude(e.target.value)}
          />
        </Field>
      </div>

      {aboveCeiling && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('mission.aboveCeiling', { value: formatValue(ceilingM, lang) })}
        </p>
      )}

      <section className="space-y-3 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-900">{t('mission.settings.limitsTitle')}</h4>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={limitLocked}
            title={limitLocked ? lockedHint : undefined}
            onClick={() => setLimitsForm(limitsToForm(DEFAULT_LIMITS))}
          >
            {t('mission.settings.resetLimits')}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {LIMIT_FIELDS.map((k) => (
            <Field key={k} id={`mission-limit-${k}`} label={t(`mission.fields.${k}`)} error={showError(k)}>
              <TextInput
                id={`mission-limit-${k}`}
                inputMode="decimal"
                value={limitsForm[k]}
                disabled={limitLocked}
                title={limitLocked ? lockedHint : undefined}
                error={showError(k)}
                onChange={(e) => setLimit(k, e.target.value)}
              />
            </Field>
          ))}
        </div>
        {drone && (
          <p className="text-xs text-gray-500">
            {t('mission.settings.droneLimitsNote', {
              wind: formatValue(drone.maxWindMs, lang),
              gust: formatValue(drone.maxGustMs, lang),
              alt: formatValue(drone.maxAltitudeM, lang),
            })}
          </p>
        )}
      </section>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving} autoFocus={!anyEditable}>
          {anyEditable ? t('common.cancel') : t('mission.close')}
        </Button>
        {anyEditable && (
          <Button type="submit" isLoading={saving}>
            {t('common.save')}
          </Button>
        )}
      </div>
    </form>
  )
}
