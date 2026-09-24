import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import type { Mission } from '@/domain/types'
import { useActiveMission, useMissionMenu } from '@/hooks/useMissions'
import { missions } from '@/storage/missions'
import NewMissionDialog from './NewMissionDialog'
import { STATUS_DOT } from './missionView'

// Облетанных миссий со временем много — в шапке только последние, остальные в истории.
// Шапка есть на всех экранах: читаем только эти миссии, а не всю историю после каждой записи
const MAX_FLOWN_IN_MENU = 8

// Кольцо фокуса внутри пункта: у меню overflow-hidden, внешнее кольцо обрезалось бы.
// Фон при фокусе не меняем — иначе выбранная миссия теряла бы подсветку, а пункт с фокусом не выделялся
const ITEM_FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500'

export default function MissionSwitcher() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const menu = useMissionMenu(MAX_FLOWN_IN_MENU)
  const active = useActiveMission()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Фокус сразу на текущей миссии, чтобы стрелками листать от неё
    const items = menuItems(menuRef.current)
    const first = items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0]
    first?.focus()
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = async (m: Mission) => {
    setOpen(false)
    // Пункт меню исчезает вместе с меню — фокус возвращаем на кнопку, а не в никуда
    buttonRef.current?.focus()
    if (m.id === active?.id) return
    try {
      await missions.setActive(m.id)
    } catch (error) {
      console.error('Не удалось переключить миссию:', error)
      toast.error(t('mission.switcher.switchFailed'))
    }
  }

  const onMenuKey = (e: ReactKeyboardEvent) => {
    // Tab уводит фокус из меню — открытым оно остаться не должно, иначе висит над страницей
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    const items = menuItems(menuRef.current)
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    let next: number
    if (e.key === 'ArrowDown') next = (i + 1) % items.length
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    items[next]?.focus()
  }

  const startCreate = () => {
    setOpen(false)
    // Пункт «Новая миссия» исчезнет вместе с меню — окно должно вернуть фокус на кнопку миссии
    buttonRef.current?.focus()
    setCreating(true)
  }

  let content
  if (menu === undefined || active === undefined) {
    content = <div className="h-8 w-36 rounded-lg bg-gray-100 animate-pulse" aria-hidden="true" />
  } else if (menu.inWork.length + menu.flownTotal === 0) {
    content = (
      <button
        type="button"
        onClick={startCreate}
        title={t('mission.switcher.create')}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <PlusIcon />
        {/* На ширине около 1024 px шапка тесная: полная подпись только на широком окне */}
        <span className="hidden xl:inline">{t('mission.switcher.create')}</span>
        <span className="xl:hidden">{t('mission.switcher.createShort')}</span>
      </button>
    )
  } else {
    const { inWork, flown, flownTotal } = menu
    const statusLabel = active ? t(`common.statuses.${active.status}`) : ''
    content = (
      <>
        {/* При 1024 px навигация занимает почти всю шапку: до xl кнопка узкая, полное имя — в подсказке */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={active ? t('mission.switcher.current', { name: active.name, status: statusLabel }) : t('mission.switcher.choose')}
          title={active ? `${active.name} — ${statusLabel}` : t('mission.switcher.choose')}
          className={`inline-flex max-w-[7.5rem] items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 xl:max-w-[16rem] ${
            open ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
          }`}
        >
          {active && <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[active.status]}`} aria-hidden="true" />}
          <span className={`min-w-0 truncate ${active ? 'font-medium text-gray-800' : 'text-gray-500'}`}>
            {active ? (
              active.name
            ) : (
              // Полная подсказка «Выберите миссию» до xl не помещается и обрезалась бы на полуслове
              <>
                <span className="hidden xl:inline">{t('mission.switcher.choose')}</span>
                <span className="xl:hidden">{t('mission.switcher.chooseShort')}</span>
              </>
            )}
          </span>
          <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('mission.switcher.label')}
            onKeyDown={onMenuKey}
            className="absolute right-0 top-full z-10 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
          >
            <div className="max-h-[60vh] overflow-y-auto py-1">
              <MenuGroup title={t('mission.switcher.groupActive')}>
                {inWork.length === 0 && <p className="px-4 py-2 text-sm text-gray-500">{t('mission.switcher.emptyActive')}</p>}
                {inWork.map((m) => (
                  <MenuItem key={m.id} mission={m} active={m.id === active?.id} onSelect={choose} />
                ))}
              </MenuGroup>
              {flown.length > 0 && (
                <MenuGroup title={t('mission.switcher.groupFlown')}>
                  {flown.map((m) => (
                    <MenuItem key={m.id} mission={m} active={m.id === active?.id} onSelect={choose} />
                  ))}
                  {flownTotal > flown.length && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false)
                        navigate('/history')
                      }}
                      className={`block w-full px-4 py-2 text-left text-xs font-medium text-blue-600 hover:bg-gray-50 ${ITEM_FOCUS}`}
                    >
                      {t('mission.switcher.moreInHistory', { count: flownTotal - flown.length })}
                    </button>
                  )}
                </MenuGroup>
              )}
            </div>
            <div className="border-t border-gray-100 p-1">
              <button
                type="button"
                role="menuitem"
                onClick={startCreate}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50 ${ITEM_FOCUS}`}
              >
                <PlusIcon />
                {t('mission.switcher.new')}
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  // Диалог стоит на одном месте дерева во всех ветках: иначе после создания первой миссии
  // он бы пересоздался и мигнул пустой формой
  return (
    <div ref={rootRef} className="relative min-w-0">
      {content}
      <NewMissionDialog isOpen={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

const menuItems = (menu: HTMLElement | null): HTMLElement[] =>
  menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')) : []

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="py-1" role="group" aria-label={title}>
      {/* Название группы уже в aria-label — диктору второй раз его читать незачем */}
      <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500" aria-hidden="true">
        {title}
      </p>
      {children}
    </div>
  )
}

function MenuItem({ mission, active, onSelect }: { mission: Mission; active: boolean; onSelect: (m: Mission) => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={() => onSelect(mission)}
      title={mission.name}
      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${ITEM_FOCUS} ${active ? 'bg-blue-50/70' : 'hover:bg-gray-50'}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[mission.status]}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${active ? 'font-semibold text-blue-800' : 'text-gray-800'}`}>{mission.name}</span>
        <span className="block text-xs text-gray-500">
          {t(`common.statuses.${mission.status}`)} · {t(`mission.types.${mission.type}`)}
        </span>
      </span>
      {active && (
        <svg className="h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  )
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  )
}
