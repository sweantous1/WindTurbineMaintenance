import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import { ToastContainer, type CloseButtonProps } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import Header from './Header'
import ErrorBoundary from '@/components/common/ErrorBoundary'

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea'))

// Файл, брошенный мимо зоны загрузки, иначе открывается в окне вместо приложения.
// Текст в поля ввода перетаскивать можно, а зона загрузки на экране дефектов обрабатывает drop сама.
const preventStrayDrop = (e: DragEvent) => {
  if (e.defaultPrevented) return
  const hasFiles = e.dataTransfer?.types.includes('Files') ?? false
  if (!hasFiles && isEditable(e.target)) return
  e.preventDefault()
  if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none'
}

// Кнопка закрытия как у react-toastify, но с переведённой подписью: у стандартной она «close»
// и снаружи не задаётся, а CloseButton пакет объявляет только в типах — в сборке его нет.
// closeToast и theme подставляет сам react-toastify, клонируя элемент для каждого уведомления
function ToastCloseButton({ closeToast, theme = 'light', label }: Partial<CloseButtonProps> & { label: string }) {
  return (
    <button
      type="button"
      className={`Toastify__close-button Toastify__close-button--${theme}`}
      onClick={(e) => {
        e.stopPropagation()
        closeToast?.(true)
      }}
      aria-label={label}
    >
      <svg aria-hidden="true" viewBox="0 0 14 16">
        <path
          fillRule="evenodd"
          d="M7.71 8.23l3.75 3.75-1.48 1.48-3.75-3.75-3.75 3.75L1 11.98l3.75-3.75L1 4.48 2.48 3l3.75 3.75L9.98 3l1.48 1.48-3.75 3.75z"
        />
      </svg>
    </button>
  )
}

export default function Layout() {
  const { t } = useTranslation()
  const location = useLocation()
  const closeLabel = t('common.closeNotification')

  useEffect(() => {
    document.addEventListener('dragover', preventStrayDrop)
    document.addEventListener('drop', preventStrayDrop)
    return () => {
      document.removeEventListener('dragover', preventStrayDrop)
      document.removeEventListener('drop', preventStrayDrop)
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      {/* tabIndex=-1: сюда окно возвращает фокус, если кнопки, которая его открыла, уже нет */}
      <main tabIndex={-1} className="p-6 max-w-7xl mx-auto focus:outline-none">
        {/* key сбрасывает ошибку при переходе на другой экран */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      {/* У react-toastify подписи области уведомлений и кнопки закрытия только английские */}
      <ToastContainer
        position="bottom-right"
        autoClose={3000}
        aria-label={t('common.notifications')}
        closeButton={<ToastCloseButton label={closeLabel} />}
      />
    </div>
  )
}
