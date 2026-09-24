import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Farm, FlightPlan, GeoPoint, Turbine } from '@/domain/types'
import { orbitRadiusM, turbineHubM, turbineRotorM } from '@/domain/flightPlan'
import { escapeHtml } from '@/utils/format'
import { formatCoord, formatNumber } from './format'
import { labelElement, localizeMap, tileStatusHandlers } from './mapChrome'
import { orbitCircles, orderNumbers, planLines, viewBounds, type LatLngTuple } from './planGeometry'

export interface MapFocus {
  turbineId: string
  // Повторный запрос той же турбины тоже должен сработать
  nonce: number
}

interface RouteMapProps {
  farm?: Farm
  takeoff?: GeoPoint
  // Взлёт не задан явно и берётся из центра фермы
  takeoffIsDefault: boolean
  // Очищенный порядок облёта: номера на маркерах
  order: string[]
  plan?: FlightPlan
  // Куда смотреть, пока ферма пустая (например, точка прогноза погоды)
  fallbackCenter?: GeoPoint
  editable: boolean
  addMode: boolean
  onAddModeChange: (enabled: boolean) => void
  onAddTurbine: (p: GeoPoint) => void
  // false — правка не сохранилась, маркер возвращается на место
  onMoveTurbine: (id: string, p: GeoPoint) => Promise<boolean>
  onDeleteTurbine: (id: string) => void
  onMoveTakeoff: (p: GeoPoint) => Promise<boolean>
  focus?: MapFocus
}

const FIT_OPTIONS: L.FitBoundsOptions = { padding: [48, 48], maxZoom: 16 }
// Без фермы и без подсказки, куда смотреть, — весь мир: зашитого «центра» нет
const WORLD_VIEW = { center: [20, 0] as LatLngTuple, zoom: 2 }
const FALLBACK_ZOOM = 12
const FOCUS_ZOOM = 15

const COLORS = {
  route: '#2563eb',
  free: '#64748b',
  conflict: '#dc2626',
  takeoff: '#059669',
} as const

type TurbineState = 'route' | 'free' | 'conflict'

// Иконки кэшируются: новая иконка на каждый рендер заставила бы Leaflet пересоздавать маркер
const iconCache = new Map<string, L.DivIcon>()

function turbineIcon(label: string, state: TurbineState): L.DivIcon {
  const key = `${state}|${label}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const size = 28
  const bg = state === 'free' ? COLORS.free : COLORS.route
  const ring = state === 'conflict' ? COLORS.conflict : '#ffffff'
  const fontPx = label.length >= 3 ? 10 : 12
  const icon = L.divIcon({
    className: 'wtm-map-icon',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};color:#fff;border:${state === 'conflict' ? 3 : 2}px solid ${ring};box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:600 ${fontPx}px/1 system-ui,sans-serif">${escapeHtml(label)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    tooltipAnchor: [size / 2, 0],
  })
  iconCache.set(key, icon)
  return icon
}

const TAKEOFF_ICON_SIZE = 24
let takeoffIconCached: L.DivIcon | null = null

function takeoffIcon(): L.DivIcon {
  if (takeoffIconCached) return takeoffIconCached
  const s = TAKEOFF_ICON_SIZE
  takeoffIconCached = L.divIcon({
    className: 'wtm-map-icon',
    html: `<div style="width:${s}px;height:${s}px;border-radius:6px;background:${COLORS.takeoff};color:#fff;border:2px solid #fff;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:700 12px/1 system-ui,sans-serif">H</div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    tooltipAnchor: [s / 2, 0],
  })
  return takeoffIconCached
}

const TRANSIT_STYLE: L.PathOptions = { color: COLORS.route, weight: 3, dashArray: '8 6', interactive: false }
const CONFLICT_STYLE: L.PathOptions = { color: COLORS.conflict, weight: 4, interactive: false }
const ORBIT_STYLE: L.PathOptions = { color: COLORS.route, weight: 2, fill: false, interactive: false }
const CONFLICT_POINT_STYLE: L.PathOptions = { color: COLORS.conflict, weight: 3, fillOpacity: 0.25, interactive: false }

const toGeo = (ll: L.LatLng): GeoPoint => ({ lat: ll.lat, lon: L.Util.wrapNum(ll.lng, [-180, 180], true) })

// Перетащенный маркер Leaflet уже стоит на новом месте; если правка не сохранилась (миссию
// облетали в другом окне, ошибка базы), позиция из данных не меняется и react-leaflet
// маркер назад не вернёт — возвращаем сами, чтобы карта не показывала несохранённое
function dragEndHandler(save: (p: GeoPoint) => Promise<boolean>, position: RefObject<LatLngTuple>): L.LeafletEventHandlerFn {
  return (e) => {
    const marker = e.target as L.Marker
    void save(toGeo(marker.getLatLng())).then((saved) => {
      if (!saved) marker.setLatLng(position.current)
    })
  }
}

function usePositionRef(p: GeoPoint | undefined): RefObject<LatLngTuple> {
  const ref = useRef<LatLngTuple>(p ? [p.lat, p.lon] : [0, 0])
  useEffect(() => {
    if (p) ref.current = [p.lat, p.lon]
  }, [p])
  return ref
}

function ClickToAdd({ enabled, onAdd }: { enabled: boolean; onAdd: (p: GeoPoint) => void }) {
  const map = useMapEvents({
    click(e) {
      if (enabled) onAdd(toGeo(e.latlng))
    },
  })
  useEffect(() => {
    if (!enabled) return
    const el = map.getContainer()
    el.style.cursor = 'crosshair'
    // Двойной щелчок в этом режиме поставил бы две турбины и ещё приблизил бы карту
    map.doubleClickZoom.disable()
    return () => {
      el.style.cursor = ''
      map.doubleClickZoom.enable()
    }
  }, [enabled, map])
  return null
}

// Кнопки масштаба, ссылка на Leaflet и закрытие всплывающих окон — на языке интерфейса
function MapLabels() {
  const map = useMap()
  const { t } = useTranslation()
  const zoomIn = t('routePlan.map.zoomIn')
  const zoomOut = t('routePlan.map.zoomOut')
  const closePopup = t('routePlan.map.closePopup')
  const leafletTitle = t('routePlan.map.leafletTitle')
  useEffect(() => localizeMap(map, { zoomIn, zoomOut, closePopup, leafletTitle }), [map, zoomIn, zoomOut, closePopup, leafletTitle])
  return null
}

function FitView({ bounds, nonce }: { bounds?: [LatLngTuple, LatLngTuple]; nonce: string }) {
  const map = useMap()
  const boundsRef = useRef(bounds)
  const first = useRef(true)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])
  useEffect(() => {
    // Первый вид задаёт сам MapContainer
    if (first.current) {
      first.current = false
      return
    }
    if (boundsRef.current) map.fitBounds(boundsRef.current, FIT_OPTIONS)
  }, [nonce, map])
  return null
}

function FocusTurbine({ focus, markers }: { focus?: MapFocus; markers: RefObject<Map<string, L.Marker>> }) {
  const map = useMap()
  useEffect(() => {
    if (!focus) return
    const marker = markers.current.get(focus.turbineId)
    if (!marker) return
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), FOCUS_ZOOM))
    marker.openPopup()
    map.getContainer().scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus, map, markers])
  return null
}

interface TurbineMarkerProps {
  farm: Farm
  turbine: Turbine
  number?: number
  state: TurbineState
  editable: boolean
  onMove: (id: string, p: GeoPoint) => Promise<boolean>
  onDelete: (id: string) => void
  registerMarker: (id: string, marker: L.Marker | null) => void
}

const TurbineMarker = memo(function TurbineMarker({ farm, turbine, number, state, editable, onMove, onDelete, registerMarker }: TurbineMarkerProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const id = turbine.id
  const position = usePositionRef(turbine)
  const handlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({ dragend: dragEndHandler((p) => onMove(id, p), position) }),
    [id, onMove, position],
  )
  const m = (v: number) => t('routePlan.units.mValue', { value: formatNumber(v, lang, 1) })
  const byDefault = (own: number | undefined) => (own === undefined ? ` · ${t('routePlan.map.byDefault')}` : '')

  return (
    <Marker
      ref={(marker) => registerMarker(id, marker)}
      position={[turbine.lat, turbine.lon]}
      icon={turbineIcon(number === undefined ? '·' : String(number), state)}
      draggable={editable}
      eventHandlers={handlers}
      title={turbine.name}
    >
      <Popup minWidth={220}>
        <div className="space-y-2 text-gray-800">
          <div>
            <div className="text-sm font-semibold">{turbine.name}</div>
            <div className="text-xs text-gray-500">
              {number === undefined ? t('routePlan.map.notInRoute') : t('routePlan.map.orderNo', { n: number })}
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-gray-500">{t('routePlan.map.coords')}</dt>
            <dd className="font-mono">
              {formatCoord(turbine.lat)}, {formatCoord(turbine.lon)}
            </dd>
            <dt className="text-gray-500">{t('routePlan.map.hub')}</dt>
            <dd>
              {m(turbineHubM(farm, turbine))}
              {byDefault(turbine.hubHeightM)}
            </dd>
            <dt className="text-gray-500">{t('routePlan.map.rotor')}</dt>
            <dd>
              {m(turbineRotorM(farm, turbine))}
              {byDefault(turbine.rotorDiameterM)}
            </dd>
            <dt className="text-gray-500">{t('routePlan.map.orbit')}</dt>
            <dd>{m(orbitRadiusM(farm, turbine))}</dd>
            {turbine.groundAltM !== undefined && (
              <>
                <dt className="text-gray-500">{t('routePlan.map.groundAlt')}</dt>
                <dd>{m(turbine.groundAltM)}</dd>
              </>
            )}
          </dl>
          {state === 'conflict' && <div className="text-xs text-red-700">{t('routePlan.map.conflictHint')}</div>}
          {editable && (
            <button
              type="button"
              onClick={() => onDelete(id)}
              className="w-full px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100"
            >
              {t('routePlan.map.deleteTurbine')}
            </button>
          )}
        </div>
      </Popup>
    </Marker>
  )
})

function Legend() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 border-t-2 border-dashed" style={{ borderColor: COLORS.route }} />
        {t('routePlan.map.legend.transit')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: COLORS.route }} />
        {t('routePlan.map.legend.orbit')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 border-t-[3px]" style={{ borderColor: COLORS.conflict }} />
        {t('routePlan.map.legend.conflict')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-4 h-4 rounded text-[9px] font-bold text-white inline-flex items-center justify-center"
          style={{ background: COLORS.takeoff }}
        >
          H
        </span>
        {t('routePlan.map.legend.takeoff')}
      </span>
    </div>
  )
}

function RouteMap({
  farm,
  takeoff,
  takeoffIsDefault,
  order,
  plan,
  fallbackCenter,
  editable,
  addMode,
  onAddModeChange,
  onAddTurbine,
  onMoveTurbine,
  onDeleteTurbine,
  onMoveTakeoff,
  focus,
}: RouteMapProps) {
  const { t } = useTranslation()
  const [localFit, setLocalFit] = useState(0)
  const markers = useRef(new Map<string, L.Marker>())
  const registerMarker = useCallback((id: string, marker: L.Marker | null) => {
    if (marker) markers.current.set(id, marker)
    else markers.current.delete(id)
  }, [])

  const turbines = useMemo(() => farm?.turbines ?? [], [farm])
  const bounds = useMemo(() => viewBounds(takeoff ? [...turbines, takeoff] : turbines), [turbines, takeoff])
  // Начальный вид задаётся один раз: MapContainer не следит за изменением этих свойств
  const [initialView] = useState(() =>
    bounds
      ? { bounds, boundsOptions: FIT_OPTIONS }
      : fallbackCenter
        ? { center: [fallbackCenter.lat, fallbackCenter.lon] as LatLngTuple, zoom: FALLBACK_ZOOM }
        : WORLD_VIEW,
  )

  const numbers = useMemo(() => orderNumbers(order), [order])
  const lines = useMemo(() => (plan ? planLines(plan) : undefined), [plan])
  const circles = useMemo(() => (farm && plan ? orbitCircles(farm, plan.turbineOrder) : []), [farm, plan])
  const conflictTurbines = useMemo(() => new Set(plan?.conflicts.map((c) => c.turbineId)), [plan])
  const takeoffPosition = usePositionRef(takeoff)
  const takeoffLabel = t('routePlan.map.takeoff')
  // Маркер с клавиатуры доступен как кнопка, но у divIcon Leaflet ставит только title,
  // а он продублировал бы всплывающую подсказку; имя для экранного диктора — отдельно.
  // Ставится по 'add': MapContainer рисует маркеры со второго рендера, и эффект при открытии
  // экрана маркера ещё не застаёт
  const takeoffHandlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      dragend: dragEndHandler(onMoveTakeoff, takeoffPosition),
      add: (e) => labelElement((e.target as L.Marker).getElement(), takeoffLabel),
    }),
    [onMoveTakeoff, takeoffPosition, takeoffLabel],
  )
  const takeoffMarker = useRef<L.Marker>(null)
  // Смена языка на открытой карте: маркер уже на месте, 'add' не повторится
  useEffect(() => {
    labelElement(takeoffMarker.current?.getElement(), takeoffLabel)
  }, [takeoffLabel])

  const [tilesFailed, setTilesFailed] = useState(false)
  const tileHandlers = useMemo<L.LeafletEventHandlerFnMap>(() => tileStatusHandlers(setTilesFailed), [])
  const tileLayer = useRef<L.TileLayer>(null)
  // Упавшие тайлы Leaflet сам не запрашивает: без этого после возврата сети вид остался бы серым
  useEffect(() => {
    const retry = () => tileLayer.current?.redraw()
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-b border-gray-100">
        <label className={`inline-flex items-center gap-2 text-sm ${editable ? 'text-gray-700 cursor-pointer' : 'text-gray-400 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            role="switch"
            checked={addMode && editable}
            disabled={!editable}
            onChange={(e) => onAddModeChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          {t('routePlan.map.addMode')}
        </label>
        <div className="flex items-center gap-4">
          <Legend />
          <button
            type="button"
            onClick={() => setLocalFit((n) => n + 1)}
            disabled={!bounds}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-300"
          >
            {t('routePlan.map.fitAll')}
          </button>
        </div>
      </div>
      {addMode && editable && (
        <div className="px-4 py-1.5 text-xs text-blue-800 bg-blue-50 border-b border-blue-100">{t('routePlan.map.addModeHint')}</div>
      )}
      {/* Область объявлений есть всегда: вставленную вместе с текстом диктор может не прочесть */}
      <div role="status">
        {tilesFailed && (
          <div className="px-4 py-1.5 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">{t('routePlan.map.tilesUnavailable')}</div>
        )}
      </div>
      <div className="h-[540px]">
        {/* Кнопки масштаба ставит MapLabels: у стандартных подписи только английские */}
        <MapContainer {...initialView} className="h-full w-full" worldCopyJump zoomControl={false}>
          <MapLabels />
          {/* Условия OpenStreetMap требуют видимой атрибуции */}
          <TileLayer
            ref={tileLayer}
            eventHandlers={tileHandlers}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <ClickToAdd enabled={addMode && editable} onAdd={onAddTurbine} />
          {/* Ферму вписываем заново после импорта (новое время импорта) и по кнопке */}
          <FitView bounds={bounds} nonce={`${farm?.source?.importedAt ?? ''}|${localFit}`} />
          <FocusTurbine focus={focus} markers={markers} />

          {circles.map((c) => (
            <Circle key={`orbit-${c.turbineId}`} center={[c.center.lat, c.center.lon]} radius={c.radiusM} pathOptions={ORBIT_STYLE} />
          ))}
          {lines?.transit.map((positions, i) => (
            <Polyline key={`transit-${i}`} positions={positions} pathOptions={TRANSIT_STYLE} />
          ))}
          {lines?.conflict.map((positions, i) => (
            <Polyline key={`conflict-${i}`} positions={positions} pathOptions={CONFLICT_STYLE} />
          ))}
          {lines?.conflictPoints.map((p, i) => (
            <CircleMarker key={`conflict-point-${i}`} center={p} radius={10} pathOptions={CONFLICT_POINT_STYLE} />
          ))}

          {farm &&
            turbines.map((tb) => (
              <TurbineMarker
                key={tb.id}
                farm={farm}
                turbine={tb}
                number={numbers.get(tb.id)}
                state={conflictTurbines.has(tb.id) ? 'conflict' : numbers.has(tb.id) ? 'route' : 'free'}
                editable={editable}
                onMove={onMoveTurbine}
                onDelete={onDeleteTurbine}
                registerMarker={registerMarker}
              />
            ))}

          {takeoff && (
            <Marker
              ref={takeoffMarker}
              position={[takeoff.lat, takeoff.lon]}
              icon={takeoffIcon()}
              draggable={editable}
              eventHandlers={takeoffHandlers}
              zIndexOffset={1000}
            >
              <Tooltip direction="right" offset={[4, 0]}>
                <div className="text-xs">
                  <div className="font-semibold">{t('routePlan.map.takeoff')}</div>
                  {takeoffIsDefault && <div>{t('routePlan.map.takeoffDefault')}</div>}
                  {editable && <div className="text-gray-500">{t('routePlan.map.takeoffDrag')}</div>}
                </div>
              </Tooltip>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  )
}

export default memo(RouteMap)
