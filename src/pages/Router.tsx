import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import type { RoutePoint, DroneRoute } from '@/types'
import { v4 as uuidv4 } from 'uuid'

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const STORAGE_KEY = 'wtm_route_data'

const loadSavedRoute = (): DroneRoute => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return {
    id: uuidv4(),
    name: 'New Route',
    turbineId: 'WT-001',
    points: [],
    status: 'draft',
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(route))
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(route))
    toast.success(t('router.saved'))
  }

  const center: [number, number] = [55.751244, 37.618423]

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
                  <TileLayer
                    attribution=""
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <style>{`.leaflet-control-attribution { display: none !important; }`}</style>
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
          <Card title={t('router.routePoints')} subtitle={`${route.points.length} ${t('router.points')}`}>
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
