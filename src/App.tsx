import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Layout from '@/components/layout/Layout'
import Home from '@/pages/Home'
import { missions } from '@/storage/missions'

// Тяжёлые экраны грузятся лениво, чтобы стартовый бандл не тянул Leaflet, recharts, three.js и KML
const Detection = lazy(() => import('@/pages/Detection'))
const Router = lazy(() => import('@/pages/Router'))
const Weather = lazy(() => import('@/pages/Weather'))
const Simulation = lazy(() => import('@/pages/Simulation'))
const History = lazy(() => import('@/pages/History'))
const Docs = lazy(() => import('@/pages/Docs'))
const Settings = lazy(() => import('@/pages/Settings'))

function PageFallback() {
  const { t } = useTranslation()
  return <p className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</p>
}

export default function App() {
  // Длина маршрута хранится в миссии, а построение плана меняется от версии к версии, поэтому
  // пересчитываем при запуске. Пересчёт идемпотентен, двойной вызов в StrictMode не мешает
  useEffect(() => {
    missions.recomputeRouteLengths().catch((error: unknown) => {
      console.warn('Не удалось пересчитать длины маршрутов:', error)
    })
  }, [])

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/detection" element={<Suspense fallback={<PageFallback />}><Detection /></Suspense>} />
        <Route path="/router" element={<Suspense fallback={<PageFallback />}><Router /></Suspense>} />
        <Route path="/weather" element={<Suspense fallback={<PageFallback />}><Weather /></Suspense>} />
        <Route path="/simulation" element={<Suspense fallback={<PageFallback />}><Simulation /></Suspense>} />
        <Route path="/history" element={<Suspense fallback={<PageFallback />}><History /></Suspense>} />
        <Route path="/docs" element={<Suspense fallback={<PageFallback />}><Docs /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageFallback />}><Settings /></Suspense>} />
      </Route>
    </Routes>
  )
}
