import { useTranslation } from 'react-i18next'
import { isPreFlight } from '@/domain/missionStatus'
import type { Mission } from '@/domain/types'

// После облёта погода, маршрут и ферма миссии только для чтения
export default function ReadOnlyBanner({ mission }: { mission: Mission }) {
  const { t } = useTranslation()
  if (isPreFlight(mission.status)) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      {t('missionShared.readOnly')}
    </div>
  )
}
