import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Card from '@/components/common/Card'
import { getMockStats, type DashboardStats } from '@/services/stats'

type StatKey = keyof DashboardStats

const statKeys: StatKey[] = ['inspections', 'defects', 'turbines', 'accuracy']

export default function Home() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    setStats(getMockStats())
  }, [])

  const formatValue = (v: number | null) => v !== null ? v : '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('home.title')}</h1>
          <p className="text-gray-500 mt-1">{t('home.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statKeys.map((key) => (
          <Card key={key}>
            <div className="text-center py-4">
              <p className="text-2xl font-bold text-gray-900">{stats ? formatValue(stats[key]) : '...'}</p>
              <p className="text-sm text-gray-500 mt-1">{t(`home.stats.${key}`)}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/detection')}>
          <div className="text-center py-6">
            <h3 className="font-semibold text-gray-900">{t('home.startDetection')}</h3>
            <p className="text-sm text-gray-500 mt-1">{t('home.uploadDesc')}</p>
          </div>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/router')}>
          <div className="text-center py-6">
            <h3 className="font-semibold text-gray-900">{t('home.planRoute')}</h3>
            <p className="text-sm text-gray-500 mt-1">{t('home.planDesc')}</p>
          </div>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/history')}>
          <div className="text-center py-6">
            <h3 className="font-semibold text-gray-900">{t('home.viewHistory')}</h3>
            <p className="text-sm text-gray-500 mt-1">{t('home.historyDesc')}</p>
          </div>
        </Card>
      </div>
    </div>
  )
}
