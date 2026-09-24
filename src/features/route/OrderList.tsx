import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import type { Farm } from '@/domain/types'

interface OrderListProps {
  farm: Farm
  // Уже очищенный порядок: только турбины фермы, без повторов
  order: string[]
  disabled: boolean
  // По id: индекс из отрисованного списка устаревает при быстрых повторных нажатиях
  onMove: (turbineId: string, delta: number) => void
  onShow: (turbineId: string) => void
}

const arrowButton =
  'w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed'

// Порядок облёта: перестановка стрелками помечает маршрут как изменённый вручную
export default function OrderList({ farm, order, disabled, onMove, onShow }: OrderListProps) {
  const { t } = useTranslation()
  const names = new Map(farm.turbines.map((tb) => [tb.id, tb.name]))
  const inRoute = new Set(order)
  const rest = farm.turbines.filter((tb) => !inRoute.has(tb.id))

  return (
    <Card title={t('routePlan.order.title')}>
      {order.length === 0 ? (
        <p className="text-sm text-gray-500">{t('routePlan.order.empty')}</p>
      ) : (
        <ol className="space-y-1 max-h-80 overflow-y-auto -mx-2 px-2">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50">
              <span className="w-7 h-7 shrink-0 rounded-full bg-blue-600 text-white text-xs font-semibold inline-flex items-center justify-center">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => onShow(id)}
                title={t('routePlan.order.showOnMap')}
                className="flex-1 min-w-0 text-left text-sm text-gray-800 truncate hover:text-blue-700"
              >
                {names.get(id) ?? id}
              </button>
              <button
                type="button"
                className={arrowButton}
                disabled={disabled || i === 0}
                onClick={() => onMove(id, -1)}
                aria-label={t('routePlan.order.up', { name: names.get(id) ?? id })}
                title={t('routePlan.order.up', { name: names.get(id) ?? id })}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                type="button"
                className={arrowButton}
                disabled={disabled || i === order.length - 1}
                onClick={() => onMove(id, 1)}
                aria-label={t('routePlan.order.down', { name: names.get(id) ?? id })}
                title={t('routePlan.order.down', { name: names.get(id) ?? id })}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </li>
          ))}
        </ol>
      )}
      {order.length > 0 && rest.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-1">{t('routePlan.order.notInRoute')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {rest.map((tb) => (
              <li key={tb.id}>
                <button
                  type="button"
                  onClick={() => onShow(tb.id)}
                  className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  {tb.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
