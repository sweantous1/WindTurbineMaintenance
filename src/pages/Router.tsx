import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import type { RoutePoint, DroneRoute } from '@/types'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { makeId } from '@/utils'

// Иконки маркеров из пакета leaflet, а не с unpkg: без интернета карта всё равно покажет точки.
// imagePath = '' отключает угадывание пути по leaflet.css: иначе в dev путь склеивается дважды
L.Icon.Default.imagePath = ''
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const STORAGE_KEY = 'wtm_route_data'
const DEFAULT_CENTER: [number, number] = [55.751244, 37.618423]

const isRoutePoint = (p: unknown): p is RoutePoint =>
  typeof p === 'object' && p !== null &&
  ['lat', 'lng', 'alt'].every((k) => Number.isFinite((p as Record<string, unknown>)[k]))

const newRoute = (): DroneRoute => ({
  id: makeId(),
  name: 'New Route',
  turbineId: 'WT-001',
  points: [],
  status: 'draft',
})

// Сохранённые данные проверяем по форме: битый JSON не должен ронять экран
const loadSavedRoute = (): DroneRoute => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      const points = (parsed as Partial<DroneRoute> | null)?.points
      if (Array.isArray(points) && points.every(isRoutePoint)) {
        return { ...newRoute(), ...(parsed as DroneRoute), points }
      }
      console.warn('Сохранённый маршрут повреждён, начинаем новый')
    }
  } catch (error) {
    console.warn('Не удалось прочитать сохранённый маршрут:', error)
  }
  return newRoute()
}

const saveRoute = (route: DroneRoute): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(route))
    return true
  } catch (error) {
    console.error('Не удалось сохранить маршрут:', error)
    return false
  }
}

function ClickMarker({ onMapClick }: { onMapClick: (p: RoutePoint) => void }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng, alt: 50 })
    },
  })
  return null
}

export default function Router() {
  const { t } = useTranslation()
  const [route, setRoute] = useState<DroneRoute>(loadSavedRoute)

  useEffect(() => {
    saveRoute(route)
  }, [route])

  const addPoint = (point: RoutePoint) => {
    setRoute((prev) => ({
      ...prev,
      points: [...prev.points, point],
    }))
  }

  const removePoint = (index: number) => {
    setRoute((prev) => ({
      ...prev,
      points: prev.points.filter((_, i) => i !== index),
    }))
  }

  const updatePoint = (index: number, field: keyof RoutePoint, value: number) => {
    setRoute((prev) => {
      const points = [...prev.points]
      points[index] = { ...points[index], [field]: value }
      return { ...prev, points }
    })
  }

  const handleSave = () => {
    if (saveRoute(route)) toast.success(t('router.saved'))
    else toast.error(t('router.saveFailed'))
  }

  // Карта открывается на первой точке маршрута, если она есть
  const [center] = useState<[number, number]>(() =>
    route.points.length > 0 ? [route.points[0].lat, route.points[0].lng] : DEFAULT_CENTER,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('router.title')}</h1>
          <p className="text-gray-500 mt-1">{t('router.desc')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave}>{t('router.saveRoute')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card title={t('router.map')}>
            <div className="h-[500px] rounded-lg overflow-hidden -m-5">
              {typeof window !== 'undefined' && (
                <MapContainer center={center} zoom={10} className="h-full w-full">
                  {/* Условия OpenStreetMap требуют видимой атрибуции */}
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <ClickMarker onMapClick={addPoint} />
                  {route.points.map((point, i) => (
                    <Marker key={i} position={[point.lat, point.lng]} />
                  ))}
                  {route.points.length > 1 && (
                    <Polyline
                      positions={route.points.map((p) => [p.lat, p.lng])}
                      color="#2563eb"
                      weight={3}
                    />
                  )}
                </MapContainer>
              )}
            </div>
          </Card>
        </div>

        <div>
          <Card title={t('router.routePoints')} subtitle={t('router.pointsCount', { count: route.points.length })}>
            {route.points.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">{t('router.noPoints')}</p>
            ) : (
              <div className="space-y-2 max-h-[440px] overflow-y-auto">
                {route.points.map((point, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        {t('router.point')} {i + 1}
                      </span>
                      <button onClick={() => removePoint(i)} className="text-red-500 hover:text-red-700 text-xs">
                        ✕
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-xs text-gray-500">
                      <div>
                        <span className="block text-gray-400">{t('router.lat')}</span>
                        {point.lat.toFixed(4)}
                      </div>
                      <div>
                        <span className="block text-gray-400">{t('router.lng')}</span>
                        {point.lng.toFixed(4)}
                      </div>
                      <div>
                        <label className="block text-gray-400 text-xs">{t('router.alt')}</label>
                        <input
                          type="number"
                          value={point.alt}
                          onChange={(e) => updatePoint(i, 'alt', Number(e.target.value))}
                          className="w-16 px-1 py-0.5 border rounded text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
