import type { ReactNode } from 'react'
import { useEffect, useId, useInsertionEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Если открывшей кнопки уже нет или она отключена, фокус идёт на main, а не в body
function restoreFocus(opener: HTMLElement | null) {
  const usable = opener && opener !== document.body && opener.isConnected && !(opener as HTMLButtonElement).disabled
  if (usable) {
    opener.focus()
    if (document.activeElement === opener) return
  }
  document.querySelector<HTMLElement>('main[tabindex]')?.focus()
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  // onClose бывает новым на каждом рендере, держим последний без перезапуска эффекта
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Запоминаем до layout-фазы: autoFocus содержимого срабатывает раньше useEffect,
  // и иначе запомнилась бы кнопка самого окна
  useInsertionEffect(() => {
    if (isOpen) openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'

    // Если содержимое не поставило фокус само, ставим на первое поле или на окно
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const first = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Диалог мог обработать Escape сам (например, не закрываться во время записи)
        if (e.defaultPrevented) return
        onCloseRef.current()
        return
      }
      // Tab не выпускает фокус за пределы окна
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      // Окно на месте - это повторный эффект StrictMode, а не закрытие
      if (panel?.isConnected) return
      // Фокус уже перевели на что-то на странице, не отбираем
      const current = document.activeElement
      if (current && current !== document.body && current.isConnected) return
      restoreFocus(openerRef.current)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    // z-index выше панелей Leaflet (до 1000), иначе окно окажется под картой
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto focus:outline-none"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-gray-400 hover:text-gray-600 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div ref={bodyRef} className="p-5">{children}</div>
      </div>
    </div>
  )
}
