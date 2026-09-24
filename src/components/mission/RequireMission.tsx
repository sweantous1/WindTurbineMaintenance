import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import Card from '@/components/common/Card'
import { useActiveMission } from '@/hooks/useMissions'
import type { Mission } from '@/domain/types'

interface RequireMissionProps {
  children: (mission: Mission) => ReactNode
}

// Экраны, которым нужна активная миссия, без неё показывают подсказку, а не падают
export default function RequireMission({ children }: RequireMissionProps) {
  const { t } = useTranslation()
  const mission = useActiveMission()

  if (mission === undefined) {
    return <p className="text-sm text-gray-400 py-12 text-center">{t('common.loading')}</p>
  }

  if (mission === null) {
    return (
      <Card>
        <div className="text-center py-10 space-y-3">
          <p className="text-gray-700 font-medium">{t('missionShared.noActiveTitle')}</p>
          <p className="text-sm text-gray-500">{t('missionShared.noActiveHint')}</p>
          <Link to="/" className="inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
            {t('missionShared.goHome')}
          </Link>
        </div>
      </Card>
    )
  }

  return <>{children(mission)}</>
}
