import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './i18n'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from '@/components/common/ErrorBoundary'

// HashRouter: в собранном Electron BrowserRouter видит путь к index.html, а не маршрут
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
