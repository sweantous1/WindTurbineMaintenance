import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import StatusBadge from '@/components/common/StatusBadge'
import { isPreFlight } from '@/domain/missionStatus'
import type { Mission } from '@/domain/types'
import { useActiveMission, useMissions } from '@/hooks/useMissions'
import { useDetectionCounts } from '@/hooks/usePhotos'
import { missions } from '@/storage/missions'
import NewMissionDialog from '@/features/mission/NewMissionDialog'
import {
  buildMissionsReportHtml,
  countByFilter,
  departureHour,
  downloadText,
  filterMissions,
  HISTORY_FILTERS,
  hourWeatherParts,
  localDateStamp,
  missionFileName,
  missionRow,
  parseHistoryFilter,
  type HistoryFilter,
} from '@/features/mission/missionView'
import { readLocal, writeLocal } from '@/utils/storage'

const FILTER_KEY = 'wtm_history_filter'

type PendingAction = { kind: 'delete' | 'archive'; mission: Mission }

export default function History() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const navigate = useNavigate()
  const list = useMissions()
  const active = useActiveMission()
  const defectCounts = useDetectionCounts()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<HistoryFilter>(() => parseHistoryFilter(readLocal(FILTER_KEY)))
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => (list ? filterMissions(list, filter, search) : []), [list, filter, search])
  const counts = useMemo(() => countByFilter(list ?? []), [list])

  const changeFilter = (f: HistoryFilter) => {
    setFilter(f)
    writeLocal(FILTER_KEY, f)
  }

  const resetFilters = () => {
    setSearch('')
    changeFilter('all')
  }

  // Облетанная миссия откроется на главной в режиме просмотра
  const open = async (m: Mission) => {
    try {
      await missions.setActive(m.id)
      navigate('/')
    } catch (error) {
      console.error('Не удалось открыть миссию:', error)
      toast.error(t('missionHistory.errors.openFailed'))
    }
  }

  const exportJson = (m: Mission) => {
    downloadText(JSON.stringify(m, null, 2), missionFileName(m, 'json'), 'application/json')
    toast.success(t('missionHistory.toast.exportedJson'))
  }

  const exportReport = () => {
    const html = buildMissionsReportHtml({ missions: filtered, t, lang, filter, search })
    downloadText(html, `wtm-missions-${localDateStamp()}.html`, 'text/html')
    toast.success(t('missionHistory.toast.exportedReport'))
  }

  const confirmPending = async () => {
    if (!pending || busy) return
    setBusy(true)
    try {
      if (pending.kind === 'delete') {
        await missions.remove(pending.mission.id)
        toast.success(t('missionHistory.toast.deleted'))
      } else {
        await missions.archive(pending.mission.id)
        toast.success(t('missionHistory.toast.archived'))
      }
      setPending(null)
    } catch (error) {
      console.error('Не удалось изменить миссию:', error)
      toast.error(t(pending.kind === 'delete' ? 'missionHistory.errors.deleteFailed' : 'missionHistory.errors.archiveFailed'))
    } finally {
      setBusy(false)
    }
  }

  let content: ReactNode
  if (list === undefined) {
    content = <p className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</p>
  } else if (list.length === 0) {
    content = (
      <div className="mx-auto max-w-lg space-y-3 py-10 text-center">
        <p className="font-medium text-gray-800">{t('missionHistory.empty.title')}</p>
        <p className="text-sm text-gray-500">{t('missionHistory.empty.hint')}</p>
        <Button onClick={() => setCreating(true)}>{t('mission.switcher.create')}</Button>
      </div>
    )
  } else {
    content = (
      <>
        <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-gray-100 pb-4">
          <input
            type="search"
            placeholder={t('missionHistory.search')}
            aria-label={t('missionHistory.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[12rem] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="inline-flex rounded-lg bg-gray-100 p-1" role="group" aria-label={t('missionHistory.filterLabel')}>
            {HISTORY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => changeFilter(f)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t(`missionHistory.filters.${f}`)}
                <span className="ml-1.5 text-xs text-gray-500">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="space-y-3 py-10 text-center">
            <p className="text-sm text-gray-500">{t('missionHistory.noMatches')}</p>
            <Button variant="secondary" size="sm" onClick={resetFilters}>
              {t('missionHistory.resetFilters')}
            </Button>
          </div>
        ) : (
          // relative: иначе скрытая подпись sr-only в шапке таблицы растягивает всю страницу по ширине
          <div className="relative -mx-5 overflow-x-auto px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">{t('missionHistory.columns.name')}</th>
                  <th className="px-2 py-2 font-medium">{t('missionHistory.columns.status')}</th>
                  <th className="px-2 py-2 font-medium">{t('missionHistory.columns.dates')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('missionHistory.columns.turbines')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('missionHistory.columns.routeKm')}</th>
                  <th className="px-2 py-2 text-right font-medium" title={t('defects.history.hint')}>
                    {t('defects.history.column')}
                  </th>
                  <th className="px-2 py-2 font-medium">{t('missionHistory.columns.departureWeather')}</th>
                  <th className="py-2 pl-2 text-right font-medium">
                    <span className="sr-only">{t('missionHistory.columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const r = missionRow(m, t, lang)
                  const hour = departureHour(m)
                  const weatherParts = hour ? hourWeatherParts(hour, t, lang) : null
                  const isActive = m.id === active?.id
                  const canArchive = !isPreFlight(m.status) && m.status !== 'archived'
                  // Кнопки-значки в каждой строке одинаковые — диктору нужно и название миссии
                  const aria = (action: string) => t('missionHistory.actionLabel', { action, name: m.name })
                  return (
                    <tr key={m.id} className={`border-b border-gray-50 align-top ${isActive ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                      <td className="max-w-[12rem] py-3 pr-3">
                        <button
                          type="button"
                          onClick={() => open(m)}
                          title={m.name}
                          className="block max-w-full truncate text-left font-medium text-gray-900 hover:text-blue-700 hover:underline"
                        >
                          {m.name}
                        </button>
                        <span className="text-xs text-gray-500">
                          {r.type}
                          {isActive && <span className="ml-1.5 font-medium text-blue-700">· {t('missionHistory.activeTag')}</span>}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-3">
                        <span className="block text-gray-900" title={t('missionHistory.createdAt')}>
                          {r.createdAt}
                        </span>
                        <span className="block text-xs text-gray-500" title={t('missionHistory.completedAt')}>
                          {r.completedAt ?? t('missionHistory.notCompleted')}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-gray-900">{r.turbines ?? <Dash />}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-gray-900">{r.routeKm ?? <Dash />}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-gray-900">{defectCounts?.get(m.id) || <Dash />}</td>
                      <td className="max-w-[10rem] px-2 py-3">
                        {r.departure ? (
                          <>
                            <span className="block whitespace-nowrap text-gray-900">{r.departure}</span>
                            {hour ? (
                              <>
                                {weatherParts?.measures && <span className="block whitespace-nowrap text-xs text-gray-600">{weatherParts.measures}</span>}
                                <span className="block truncate text-xs text-gray-500" title={weatherParts?.description}>
                                  {weatherParts?.description}
                                </span>
                              </>
                            ) : (
                              <span className="block text-xs text-gray-500">{t('missionHistory.noHourWeather')}</span>
                            )}
                          </>
                        ) : (
                          <Dash />
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3 pl-2">
                        <div className="flex justify-end gap-1">
                          <IconButton label={t('missionHistory.actions.open')} ariaLabel={aria(t('missionHistory.actions.open'))} onClick={() => open(m)}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                          </IconButton>
                          <IconButton
                            label={t('missionHistory.actions.exportJson')}
                            ariaLabel={aria(t('missionHistory.actions.exportJson'))}
                            onClick={() => exportJson(m)}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                            />
                          </IconButton>
                          {canArchive ? (
                            <IconButton
                              label={t('missionHistory.actions.archive')}
                              ariaLabel={aria(t('missionHistory.actions.archive'))}
                              onClick={() => setPending({ kind: 'archive', mission: m })}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
                              />
                            </IconButton>
                          ) : (
                            // Пустое место держит колонку ровной
                            <span className="h-7 w-7" aria-hidden="true" />
                          )}
                          <IconButton
                            label={t('missionHistory.actions.delete')}
                            ariaLabel={aria(t('missionHistory.actions.delete'))}
                            danger
                            onClick={() => setPending({ kind: 'delete', mission: m })}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    )
  }

  const pendingName = pending?.mission.name ?? ''

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('missionHistory.title')}</h1>
          <p className="mt-1 text-gray-500">{t('missionHistory.desc')}</p>
        </div>
        <Button variant="secondary" onClick={exportReport} disabled={filtered.length === 0} title={t('missionHistory.reportHint')}>
          {t('missionHistory.exportReport')}
        </Button>
      </div>

      <Card>{content}</Card>

      <Modal
        isOpen={pending !== null}
        onClose={() => !busy && setPending(null)}
        title={pending?.kind === 'archive' ? t('missionHistory.confirm.archiveTitle') : t('missionHistory.confirm.deleteTitle')}
      >
        {/* Escape закрывает окно через Modal (onClose не срабатывает во время записи); фокус на отмене — удаление необратимо */}
        <div className="space-y-4">
          <p className="break-words text-sm text-gray-700">
            {pending?.kind === 'archive'
              ? t('missionHistory.confirm.archiveBody', { name: pendingName })
              : t('missionHistory.confirm.deleteBody', { name: pendingName })}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPending(null)} disabled={busy} autoFocus>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant={pending?.kind === 'archive' ? 'primary' : 'danger'} onClick={confirmPending} isLoading={busy}>
              {pending?.kind === 'archive' ? t('missionHistory.confirm.archive') : t('missionHistory.confirm.delete')}
            </Button>
          </div>
        </div>
      </Modal>

      <NewMissionDialog isOpen={creating} onClose={() => setCreating(false)} onCreated={() => navigate('/')} />
    </div>
  )
}

function Dash() {
  return <span className="text-gray-500">—</span>
}

interface IconButtonProps {
  // Видимая подсказка; для диктора — ariaLabel с названием миссии
  label: string
  ariaLabel: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}

function IconButton({ label, ariaLabel, onClick, danger, children }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={ariaLabel}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        danger ? 'text-gray-400 hover:bg-red-50 hover:text-red-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <svg className="h-[1.125rem] w-[1.125rem]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}
