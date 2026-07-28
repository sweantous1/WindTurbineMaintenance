interface StatusBadgeProps {
  status: 'completed' | 'processing' | 'failed' | 'draft' | 'ready' | 'in-progress' | 'low' | 'medium' | 'high' | 'critical'
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Completed' },
  processing: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Processing' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
  draft: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Draft' },
  ready: { bg: 'bg-green-100', text: 'text-green-800', label: 'Ready' },
  'in-progress': { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'In Progress' },
  low: { bg: 'bg-green-100', text: 'text-green-800', label: 'Low' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Medium' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'High' },
  critical: { bg: 'bg-red-100', text: 'text-red-800', label: 'Critical' },
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.draft

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  )
}
