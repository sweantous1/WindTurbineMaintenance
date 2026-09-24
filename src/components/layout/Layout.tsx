import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
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

export default function Layout() {
  const location = useLocation()

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
      <main className="p-6 max-w-7xl mx-auto">
        {/* key сбрасывает ошибку при переходе на другой экран */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  )
}
