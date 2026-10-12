import { useTranslation } from 'react-i18next'

interface UndoToastProps {
  message: string
  onUndo: () => void
}

// тост вида "Турбина перенесена · Отменить"
export default function UndoToast({ message, onUndo }: UndoToastProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 px-2 py-1 rounded-md font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        {t('routePlan.undo.action')}
      </button>
    </div>
  )
}
