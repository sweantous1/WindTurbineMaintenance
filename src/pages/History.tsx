import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import { getMockInspections } from '@/services/inspections'

export default function History() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filtered = getMockInspections().filter((i) =>
    i.turbineId.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('history.title')}</h1>
          <p className="text-gray-500 mt-1">Browse and manage inspection records</p>
        </div>
        <Button variant="secondary">{t('history.export')}</Button>
      </div>

      <Card>
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100 mb-4">
          <input
            type="text"
            placeholder={t('history.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <Button variant="secondary" size="sm">{t('history.filter')}</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-3 font-medium">{t('history.date')}</th>
                <th className="pb-3 font-medium">{t('history.turbine')}</th>
                <th className="pb-3 font-medium">{t('history.defects')}</th>
                <th className="pb-3 font-medium">{t('history.status')}</th>
                <th className="pb-3 font-medium">{t('history.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-8">{t('common.noData')}</td>
                </tr>
              )}
            </tbody>
          </table>

        </div>
      </Card>
    </div>
  )
}
