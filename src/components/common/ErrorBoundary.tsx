import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

function ErrorFallback({ error }: { error: Error }) {
  const { t } = useTranslation()

  return (
    <div role="alert" className="max-w-xl mx-auto mt-16 bg-white rounded-xl border border-red-200 p-6 space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{t('common.errorTitle')}</h2>
      <p className="text-sm text-gray-600">{t('common.errorDesc')}</p>
      <pre className="text-xs text-red-700 bg-red-50 rounded-lg p-3 whitespace-pre-wrap break-words">{error.message}</pre>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
      >
        {t('common.reload')}
      </button>
    </div>
  )
}

// Без этой обёртки любая ошибка при отрисовке экрана оставляет пустое белое окно
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ошибка при отрисовке экрана:', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} />
    return this.props.children
  }
}
