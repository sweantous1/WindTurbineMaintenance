import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Layout from '@/components/layout/Layout'
import Home from '@/pages/Home'

// Тяжёлые экраны (карта, графики) грузятся, только когда их открыли:
// так стартовый бандл не тянет Leaflet, recharts и разбор KML
const Detection = lazy(() => import('@/pages/Detection'))
const Router = lazy(() => import('@/pages/Router'))
const Weather = lazy(() => import('@/pages/Weather'))
const History = lazy(() => import('@/pages/History'))
const Docs = lazy(() => import('@/pages/Docs'))
const Settings = lazy(() => import('@/pages/Settings'))

function PageFallback() {
  const { t } = useTranslation()
  return <p className="py-12 text-center text-sm text-gray-400">{t('common.loading')}</p>
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/detection" element={<Suspense fallback={<PageFallback />}><Detection /></Suspense>} />
        <Route path="/router" element={<Suspense fallback={<PageFallback />}><Router /></Suspense>} />
        <Route path="/weather" element={<Suspense fallback={<PageFallback />}><Weather /></Suspense>} />
        <Route path="/history" element={<Suspense fallback={<PageFallback />}><History /></Suspense>} />
        <Route path="/docs" element={<Suspense fallback={<PageFallback />}><Docs /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageFallback />}><Settings /></Suspense>} />
      </Route>
    </Routes>
  )
}
