import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Button from '@/components/common/Button'
import Card from '@/components/common/Card'
import Modal from '@/components/common/Modal'
import { DEFAULT_DRONE_PROFILE, DEFAULT_DRONE_PROFILE_ID } from '@/domain/defaults'
import type { DroneProfile } from '@/domain/types'
import { formatNumber } from '@/features/weather/format'
import {
  DRONE_FIELD_RANGES,
  DRONE_NUMERIC_FIELDS,
  droneToForm,
  validateDroneForm,
  type DroneFormValues,
  type DroneNumericField,
  type FieldError,
} from '@/features/weather/droneProfileForm'
import { useActiveMission, useDroneProfiles, useMissions } from '@/hooks/useMissions'
import { droneProfiles } from '@/storage/droneProfiles'
import { missions } from '@/storage/missions'
import { draftValuesFor, getDroneDraft, setDroneDraft } from './droneDraft'
import { droneDisplayName, hasBuiltinName } from './droneName'

// Выбор в списке: id профиля или новый, ещё не сохранённый
const NEW = '__new__'

const UNIT_KEYS: Record<DroneNumericField, string> = {
  maxWindMs: 'weatherScreen.units.ms',
  maxGustMs: 'weatherScreen.units.ms',
  cruiseSpeedMs: 'weatherScreen.units.ms',
  enduranceMin: 'weatherScreen.units.min',
  reservePct: 'weatherScreen.units.pct',
  maxAltitudeM: 'weatherScreen.units.m',
}

export default function DroneProfilesSection() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const profiles = useDroneProfiles()
  const allMissions = useMissions()
  const activeMission = useActiveMission()
  // при возврате на экран открываем профиль с несохранёнными правками
  const [selectedId, setSelectedId] = useState<string>(() => getDroneDraft()?.selectedId ?? DEFAULT_DRONE_PROFILE_ID)
  const [pendingDelete, setPendingDelete] = useState<DroneProfile | null>(null)
  // форма сообщает о несохранённых правках, чтобы не потерять их при смене профиля
  const [formDirty, setFormDirty] = useState(false)
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)

  if (!profiles) {
    return (
      <Card title={t('settings.drones.title')}>
        <p className="py-6 text-center text-sm text-gray-500">{t('common.loading')}</p>
      </Card>
    )
  }

  // профиль по умолчанию первым, остальные по имени
  const sorted = [...profiles].sort((a, b) =>
    a.id === DEFAULT_DRONE_PROFILE_ID ? -1 : b.id === DEFAULT_DRONE_PROFILE_ID ? 1 : a.name.localeCompare(b.name, lang),
  )
  const selected = selectedId === NEW ? null : (profiles.find((p) => p.id === selectedId) ?? sorted[0] ?? null)
  // ключ по содержимому, чтобы после сохранения форма перечитала профиль из базы;
  // язык тоже в ключе - от него зависит десятичный разделитель
  const baseKey = selected ? JSON.stringify(selected) : NEW
  const formKey = `${baseKey}|${lang}`
  const draftKey = selected ? selected.id : NEW
  const name = (p: DroneProfile) => droneDisplayName(p, t)
  const usedBy = (id: string) => allMissions?.filter((m) => m.droneProfileId === id).length ?? 0

  const requestSelect = (id: string) => {
    if (id === selectedId) return
    if (formDirty) setPendingSelect(id)
    else setSelectedId(id)
  }

  const initial: DroneFormValues = selected
    ? droneToForm({ ...selected, name: name(selected) }, lang)
    : droneToForm({ ...DEFAULT_DRONE_PROFILE, name: t('settings.drones.newName') }, lang)

  // длина маршрута зависит от потолка профиля; ошибка пересчёта сохранение не отменяет
  const recompute = async (profileId: string) => {
    try {
      await missions.recomputeRouteLengths(profileId)
    } catch (e) {
      toast.error(t('settings.drones.recomputeFailed', { message: e instanceof Error ? e.message : String(e) }))
    }
  }

  const save = async (profile: Omit<DroneProfile, 'id'>) => {
    // нетронутое переведённое имя встроенного профиля не пишем, пусть переводится и дальше
    const keepName = selected !== null && hasBuiltinName(selected) && profile.name === name(selected)
    const next = keepName ? { ...profile, name: selected.name } : profile
    let saved: DroneProfile
    try {
      saved = await droneProfiles.save(selected ? { ...next, id: selected.id } : next)
    } catch (e) {
      toast.error(t('settings.drones.saveFailed', { message: e instanceof Error ? e.message : String(e) }))
      return
    }
    setSelectedId(saved.id)
    toast.success(t('settings.drones.saved', { name: name(saved) }))
    await recompute(saved.id)
  }

  const remove = async (p: DroneProfile) => {
    try {
      await droneProfiles.remove(p.id)
    } catch (e) {
      toast.error(t('settings.drones.deleteFailed', { message: e instanceof Error ? e.message : String(e) }))
      return
    }
    setPendingDelete(null)
    setSelectedId(DEFAULT_DRONE_PROFILE_ID)
    toast.success(t('settings.drones.deleted', { name: name(p) }))
    // миссии удалённого профиля переходят на профиль по умолчанию
    await recompute(p.id)
  }

  return (
    <Card
      title={t('settings.drones.title')}
      subtitle={t('settings.drones.subtitle')}
      actions={
        <Button size="sm" variant="secondary" onClick={() => requestSelect(NEW)} disabled={selectedId === NEW}>
          {t('settings.drones.add')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <ul className="space-y-1.5 md:col-span-1" aria-label={t('settings.drones.listLabel')}>
          {sorted.map((p) => {
            const active = p.id === selected?.id && selectedId !== NEW
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={active || undefined}
                  onClick={() => requestSelect(p.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    active ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="block text-sm font-medium text-gray-900">{name(p)}</span>
                  <span className="block text-xs text-gray-500">
                    {t('settings.drones.summary', {
                      wind: formatNumber(p.maxWindMs, lang, 1),
                      endurance: formatNumber(p.enduranceMin, lang, 0),
                      alt: formatNumber(p.maxAltitudeM, lang, 0),
                    })}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {p.id === DEFAULT_DRONE_PROFILE_ID && <Badge>{t('settings.drones.defaultBadge')}</Badge>}
                    {activeMission?.droneProfileId === p.id && <Badge tone="blue">{t('settings.drones.activeBadge')}</Badge>}
                  </span>
                </button>
              </li>
            )
          })}
          {selectedId === NEW && (
            <li className="rounded-lg border border-dashed border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              {t('settings.drones.newItem')}
            </li>
          )}
        </ul>

        <div className="md:col-span-2">
          <DroneProfileForm
            key={formKey}
            initial={initial}
            draft={draftValuesFor(draftKey, baseKey)}
            onDraftChange={(values) => setDroneDraft(values ? { selectedId: draftKey, baseKey, values } : null)}
            isNew={selected === null}
            canDelete={selected !== null && selected.id !== DEFAULT_DRONE_PROFILE_ID}
            onSave={save}
            onCancelNew={() => setSelectedId(DEFAULT_DRONE_PROFILE_ID)}
            onDelete={() => selected && setPendingDelete(selected)}
            onDirtyChange={setFormDirty}
          />
        </div>
      </div>

      <Modal isOpen={pendingSelect !== null} onClose={() => setPendingSelect(null)} title={t('settings.drones.discardTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-700">{t('settings.drones.discardText')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingSelect(null)}>
              {t('settings.drones.discardStay')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingSelect !== null) setSelectedId(pendingSelect)
                setPendingSelect(null)
              }}
            >
              {t('settings.drones.discardConfirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('settings.drones.deleteTitle')}
      >
        {pendingDelete && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">{t('settings.drones.deleteText', { name: name(pendingDelete) })}</p>
            {usedBy(pendingDelete.id) > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t('settings.drones.deleteUsed', { count: usedBy(pendingDelete.id) })}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPendingDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => remove(pendingDelete)}>
                {t('common.delete')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}

function Badge({ children, tone = 'gray' }: { children: string; tone?: 'gray' | 'blue' }) {
  const cls = tone === 'blue' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

interface DroneProfileFormProps {
  initial: DroneFormValues
  // несохранённые правки с прошлого захода
  draft?: DroneFormValues
  onDraftChange: (values: DroneFormValues | null) => void
  isNew: boolean
  canDelete: boolean
  onSave: (profile: Omit<DroneProfile, 'id'>) => Promise<void>
  onCancelNew: () => void
  onDelete: () => void
  onDirtyChange: (dirty: boolean) => void
}

function DroneProfileForm({
  initial,
  draft,
  onDraftChange,
  isNew,
  canDelete,
  onSave,
  onCancelNew,
  onDelete,
  onDirtyChange,
}: DroneProfileFormProps) {
  const { t } = useTranslation()
  const id = useId()
  const [values, setValues] = useState(() => draft ?? initial)
  const [touched, setTouched] = useState<Partial<Record<keyof DroneFormValues, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const result = validateDroneForm(values)
  const errors = result.ok ? {} : result.errors
  const dirty = (Object.keys(values) as (keyof DroneFormValues)[]).some((k) => values[k] !== initial[k])
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  // при размонтировании черновик не чистим, чтобы правки пережили уход с экрана
  useEffect(() => onDraftChange(dirty ? values : null), [dirty, values, onDraftChange])

  const shown = (field: keyof DroneFormValues): FieldError | undefined =>
    submitted || touched[field] ? errors[field] : undefined

  const set = (field: keyof DroneFormValues, value: string) => setValues((v) => ({ ...v, [field]: value }))

  const submit = async () => {
    setSubmitted(true)
    if (!result.ok) return
    setSaving(true)
    try {
      await onSave(result.profile)
    } finally {
      setSaving(false)
    }
  }

  const inputClass = (error: FieldError | undefined) =>
    `w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
      error ? 'border-red-400' : 'border-gray-300'
    }`

  const nameError = shown('name')

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div>
        <label htmlFor={`${id}-name`} className="mb-1 block text-xs font-medium text-gray-700">
          {t('settings.drones.fields.name')}
        </label>
        <input
          id={`${id}-name`}
          type="text"
          value={values.name}
          aria-invalid={nameError !== undefined}
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          onChange={(e) => set('name', e.target.value)}
          onBlur={() => setTouched((s) => ({ ...s, name: true }))}
          className={inputClass(nameError)}
        />
        {nameError && (
          <p id={`${id}-name-error`} className="mt-1 text-xs text-red-700">
            {t(nameError.key, nameError.params)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DRONE_NUMERIC_FIELDS.map((field) => {
          const error = shown(field)
          const range = DRONE_FIELD_RANGES[field]
          const fieldId = `${id}-${field}`
          return (
            <div key={field}>
              <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-gray-700">
                {t(`settings.drones.fields.${field}`)}, {t(UNIT_KEYS[field])}
              </label>
              <input
                id={fieldId}
                type="text"
                inputMode="decimal"
                value={values[field]}
                aria-invalid={error !== undefined}
                aria-describedby={`${fieldId}-hint`}
                onChange={(e) => set(field, e.target.value)}
                onBlur={() => setTouched((s) => ({ ...s, [field]: true }))}
                className={`${inputClass(error)} tabular-nums`}
              />
              <p id={`${fieldId}-hint`} className={`mt-1 text-xs ${error ? 'text-red-700' : 'text-gray-500'}`}>
                {error ? t(error.key, error.params) : t(`settings.drones.hints.${field}`, range)}
              </p>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <div className="flex gap-2">
          <Button type="submit" isLoading={saving} disabled={!isNew && !dirty}>
            {isNew ? t('settings.drones.create') : t('common.save')}
          </Button>
          {isNew ? (
            <Button type="button" variant="secondary" onClick={onCancelNew}>
              {t('common.cancel')}
            </Button>
          ) : (
            dirty && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setValues(initial)
                  setTouched({})
                  setSubmitted(false)
                }}
              >
                {t('settings.drones.reset')}
              </Button>
            )
          )}
        </div>
        {!isNew &&
          (canDelete ? (
            <Button type="button" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={onDelete}>
              {t('common.delete')}
            </Button>
          ) : (
            <span className="text-xs text-gray-500">{t('settings.drones.defaultLocked')}</span>
          ))}
      </div>
      {!isNew && dirty && <p className="text-xs text-amber-800">{t('settings.drones.unsaved')}</p>}
    </form>
  )
}
