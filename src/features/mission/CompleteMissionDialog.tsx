import { useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import type { Mission } from '@/domain/types'
import { missions } from '@/storage/missions'
import { completionGaps, completionGapsKey, type CompletionGap } from './missionView'

interface CompleteMissionDialogProps {
  // Снимок миссии на момент открытия. После завершения активная миссия сбрасывается,
  // поэтому диалог не должен зависеть от «живой» активной миссии — иначе он исчезнет на последнем шаге.
  mission: Mission | null
  onClose: () => void
}

export default function CompleteMissionDialog({ mission, onClose }: CompleteMissionDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal isOpen={mission !== null} onClose={onClose} title={t('mission.complete.title')}>
      {mission && <CompleteFlow key={mission.id} mission={mission} onClose={onClose} />}
    </Modal>
  )
}

type Step = { kind: 'confirm' } | { kind: 'missing'; missing: CompletionGap[] } | { kind: 'done'; mission: Mission }

function CompleteFlow({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>({ kind: 'confirm' })
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const run = async (force: boolean) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      if (!force) {
        // Репозиторий считает маршрутом любой RoutePlan, даже с пустым порядком, и не спрашивает
        // про час вылета. Предупреждаем по правилам шагов главной, по свежей записи из базы
        const current = await missions.get(mission.id)
        const gaps = current ? completionGaps(current) : []
        if (gaps.length > 0) {
          setStep({ kind: 'missing', missing: gaps })
          return
        }
      }
      // Без force репозиторий сам сообщает, чего не хватает, и ничего не меняет
      const res = await missions.complete(mission.id, { force })
      if (res.ok) {
        toast.success(t('mission.toast.completed'))
        setStep({ kind: 'done', mission: res.mission })
      } else {
        setStep({ kind: 'missing', missing: res.missing })
      }
    } catch (error) {
      console.error('Не удалось завершить полёт:', error)
      toast.error(t('mission.errors.completeFailed'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // Escape обрабатываем здесь: во время записи окно не закрывается.
  // preventDefault сообщает Modal, что Escape уже обработан
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    if (!busyRef.current) onClose()
  }

  // key у каждого шага: кнопки создаются заново, и autoFocus ставит фокус внутрь окна,
  // а не оставляет его на исчезнувшей кнопке прошлого шага
  if (step.kind === 'done') {
    return (
      <div key="done" className="space-y-4" onKeyDown={onKeyDown}>
        <div className="flex items-start gap-3" role="status">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium text-gray-900 break-words">{t('mission.complete.doneTitle', { name: step.mission.name })}</p>
            <p className="text-gray-600">{t('mission.complete.doneBody')}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} autoFocus>
            {t('mission.close')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onClose()
              navigate('/history')
            }}
          >
            {t('mission.complete.openHistory')}
          </Button>
        </div>
      </div>
    )
  }

  if (step.kind === 'missing') {
    return (
      <div key="missing" className="space-y-4" onKeyDown={onKeyDown}>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          <p className="font-medium">{t(`mission.complete.missing.${completionGapsKey(step.missing)}`)}</p>
          <p className="mt-1 text-amber-800">{t('mission.complete.missingBody')}</p>
        </div>
        <div className="flex justify-end gap-2">
          {/* Фокус на отмене: запись о полёте без данных — осознанный выбор, а не лишний Enter */}
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} autoFocus>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => run(true)} isLoading={busy}>
            {t('mission.complete.force')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div key="confirm" className="space-y-4" onKeyDown={onKeyDown}>
      <p className="text-sm text-gray-700 break-words">{t('mission.complete.confirm', { name: mission.name })}</p>
      <p className="text-sm text-gray-500">{t('mission.complete.nothingDeleted')}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy} autoFocus>
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={() => run(false)} isLoading={busy}>
          {t('mission.complete.submit')}
        </Button>
      </div>
    </div>
  )
}
