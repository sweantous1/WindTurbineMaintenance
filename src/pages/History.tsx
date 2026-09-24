import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import StatusBadge from '@/components/common/StatusBadge'
import { getMockInspections } from '@/services/inspections'
import type { Inspection } from '@/types'
import { escapeHtml } from '@/utils'
import { readLocal, writeLocal } from '@/utils/storage'

type StatusFilter = 'all' | 'completed' | 'processing' | 'failed'

export default function History() {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState(() => readLocal('wtm_history_search') || '')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    (readLocal('wtm_history_status') as StatusFilter) || 'all'
  )
  const [showFilter, setShowFilter] = useState(false)

  useEffect(() => {
    writeLocal('wtm_history_search', search)
  }, [search])

  useEffect(() => {
    writeLocal('wtm_history_status', statusFilter)
  }, [statusFilter])

  const inspections = getMockInspections()

  const filtered = inspections.filter((i) => {
    const matchesSearch = i.turbineId.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || i.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const handleExport = () => {
    const labels = {
      title: escapeHtml(t('history.report.title')),
      date: escapeHtml(t('history.date')),
      turbine: escapeHtml(t('history.turbine')),
      defects: escapeHtml(t('history.defects')),
      status: escapeHtml(t('history.status')),
      footer: escapeHtml(t('history.report.footer')),
      demo: escapeHtml(t('history.demoNotice')),
    }

    // Все значения экранируются: иначе ID турбины вида <script> попадёт в отчёт как разметка
    const rows = filtered.map(
      (i) => `<tr>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(i.date)}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(i.turbineId)}</td>
        <td style="padding:8px;border:1px solid #ddd">${i.defects.length}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t(`history.statuses.${i.status}`))}</td>
      </tr>`
    ).join('')

    const html = `<!DOCTYPE html>
<html lang="${escapeHtml(i18n.resolvedLanguage ?? 'ru')}"><head><meta charset="utf-8"><title>${labels.title}</title></head>
<body style="font-family:sans-serif;padding:20px">
  <h1 style="color:#2563eb">${labels.title}</h1>
  <p style="color:#b45309">${labels.demo}</p>
  <table style="width:100%;border-collapse:collapse">
    <thead><tr style="background:#f3f4f6">
      <th style="padding:8px;border:1px solid #ddd;text-align:left">${labels.date}</th>
      <th style="padding:8px;border:1px solid #ddd;text-align:left">${labels.turbine}</th>
      <th style="padding:8px;border:1px solid #ddd;text-align:left">${labels.defects}</th>
      <th style="padding:8px;border:1px solid #ddd;text-align:left">${labels.status}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#9ca3af;font-size:12px;margin-top:20px">${labels.footer}</p>
</body></html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'report.html'
    a.click()
    // Сразу после click() скачивание ещё не началось — освобождаем ссылку чуть позже
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(t('history.exported'))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('history.title')}</h1>
          <p className="text-gray-500 mt-1">{t('history.desc')}</p>
        </div>
        <Button variant="secondary" onClick={handleExport}>{t('history.export')}</Button>
      </div>

      {/* Пока миссий нет, записи ниже — примеры, а не настоящие инспекции */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {t('history.demoNotice')}
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
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setShowFilter(!showFilter)}>
              {t('history.filter')}
            </Button>
            {showFilter && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-44">
                {(['all', 'completed', 'processing', 'failed'] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
                      statusFilter === s ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                    }`}
                    onClick={() => { setStatusFilter(s); setShowFilter(false) }}
                  >
                    {s === 'all' ? t('history.all') : t(`history.statuses.${s}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-3 font-medium">{t('history.date')}</th>
                <th className="pb-3 font-medium">{t('history.turbine')}</th>
                <th className="pb-3 font-medium">{t('history.defects')}</th>
                <th className="pb-3 font-medium">{t('history.status')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-gray-400 py-8">{t('common.noData')}</td>
                </tr>
              ) : (
                filtered.map((inspection: Inspection) => (
                  <tr key={inspection.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 text-gray-900">{inspection.date}</td>
                    <td className="py-3 font-medium text-gray-900">{inspection.turbineId}</td>
                    <td className="py-3 text-gray-900">{inspection.defects.length}</td>
                    <td className="py-3"><StatusBadge status={inspection.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
