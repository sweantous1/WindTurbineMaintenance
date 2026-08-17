import { useTranslation } from 'react-i18next'

interface StatusBadgeProps {
  status: 'completed' | 'processing' | 'failed' | 'draft' | 'ready' | 'in-progress' | 'low' | 'medium' | 'high' | 'critical'
}

const statusConfig: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-green-100', text: 'text-green-800' },
  processing: { bg: 'bg-blue-100', text: 'text-blue-800' },
  failed: { bg: 'bg-red-100', text: 'text-red-800' },
  draft: { bg: 'bg-gray-100', text: 'text-gray-800' },
  ready: { bg: 'bg-green-100', text: 'text-green-800' },
  'in-progress': { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  low: { bg: 'bg-green-100', text: 'text-green-800' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800' },
  critical: { bg: 'bg-red-100', text: 'text-red-800' },
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation()
  const config = statusConfig[status] || statusConfig.draft

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {t(`common.statuses.${status}`)}
    </span>
  )
}
