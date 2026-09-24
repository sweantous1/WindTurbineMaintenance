import { useTranslation } from 'react-i18next'
import type { MissionStatus } from '@/domain/types'

type GeneralStatus = 'completed' | 'processing' | 'failed' | 'draft' | 'ready' | 'in-progress' | 'low' | 'medium' | 'high' | 'critical'

interface StatusBadgeProps {
  status: GeneralStatus | MissionStatus
}

const statusConfig: Record<GeneralStatus | MissionStatus, { bg: string; text: string }> = {
  completed: { bg: 'bg-green-100', text: 'text-green-800' },
  processing: { bg: 'bg-blue-100', text: 'text-blue-800' },
  failed: { bg: 'bg-red-100', text: 'text-red-800' },
  draft: { bg: 'bg-gray-100', text: 'text-gray-800' },
  // У миссии это «Час вылета выбран»: данные заданы, но допуск к полёту даёт только вердикт прогноза,
  // поэтому не зелёный
  ready: { bg: 'bg-sky-100', text: 'text-sky-800' },
  'in-progress': { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  low: { bg: 'bg-green-100', text: 'text-green-800' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800' },
  critical: { bg: 'bg-red-100', text: 'text-red-800' },
  // Статусы миссии (draft и ready общие с перечнем выше)
  planned: { bg: 'bg-blue-100', text: 'text-blue-800' },
  flown: { bg: 'bg-indigo-100', text: 'text-indigo-800' },
  analyzed: { bg: 'bg-teal-100', text: 'text-teal-800' },
  archived: { bg: 'bg-slate-100', text: 'text-slate-600' },
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation()
  // Запись из старой базы может нести статус, которого нет в перечне
  const config = statusConfig[status] ?? statusConfig.draft

  return (
    <span className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {t(`common.statuses.${status}`)}
    </span>
  )
}
