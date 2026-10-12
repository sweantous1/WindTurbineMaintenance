import { useTranslation } from 'react-i18next'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Фокус на отмене; пока идёт запись, окно не закрыть
export default function ConfirmDialog({ isOpen, title, body, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal isOpen={isOpen} onClose={() => !busy && onCancel()} title={title}>
      <div className="space-y-4">
        <p className="break-words text-sm text-gray-700">{body}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant={danger ? 'danger' : 'primary'} onClick={onConfirm} isLoading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
