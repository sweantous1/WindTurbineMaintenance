import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CanvasTexture, CircleGeometry, MeshBasicMaterial, SRGBColorSpace, Vector3 } from 'three'
import type { LocalPoint } from '@/lib/geo'
import type { SimTurbine } from '../simData'
import { FRAME_PRIORITY, type LabelRegistry } from './droneFrame'

// Подписи над роторами — обычный DOM поверх холста: слой рендерит React вне Canvas, а положения
// каждый кадр проставляет LabelProjector внутри Canvas прямо в style. Html из drei не подошёл:
// он заводит по React-корню на подпись, и при уходе со страницы корни падали на removeChild
const LABEL_LIFT_M = 10
const PAD_RADIUS_M = 9
const PAD_LIFT_M = 0.5
// Подписи чуть за краем кадра ещё видны наполовину — прячем с запасом
const EDGE_NDC = 1.2

interface LabelLayerProps {
  turbines: readonly SimTurbine[]
  currentVisit: number | null
  registry: LabelRegistry
}

// Подписи дублируют список «Порядок облёта» в панели, поэтому скрыты от экранного диктора
export function LabelLayer({ turbines, currentVisit, registry }: LabelLayerProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      {turbines.map((t) => (
        <div
          key={t.id}
          ref={(el) => {
            if (el) registry.elements.set(t.id, el)
            else registry.elements.delete(t.id)
          }}
          className="absolute left-0 top-0 will-change-transform"
          style={{ visibility: 'hidden' }}
        >
          <TurbineLabel turbine={t} current={currentVisit !== null && t.visitIndex === currentVisit} />
        </div>
      ))}
    </div>
  )
}

// Проекция точки над ротором в пиксели холста; подписи позади камеры и далеко за краем кадра скрыты
export function LabelProjector({ turbines, registry }: { turbines: readonly SimTurbine[]; registry: LabelRegistry }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const [v] = useState(() => new Vector3())
  useFrame(() => {
    for (const t of turbines) {
      const el = registry.elements.get(t.id)
      if (!el) continue
      v.set(t.local.x, t.hubM + t.rotorM / 2 + LABEL_LIFT_M, -t.local.y).project(camera)
      if (!(v.z > -1 && v.z < 1 && Math.abs(v.x) <= EDGE_NDC && Math.abs(v.y) <= EDGE_NDC)) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`
      if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
    }
    // После камеры: подписи встают туда, где турбины на этом кадре
  }, FRAME_PRIORITY.camera + 0.75)
  return null
}

function TurbineLabel({ turbine: t, current }: { turbine: SimTurbine; current: boolean }) {
  // Турбина вне маршрута — без номера и бледнее
  if (t.visitIndex === null) {
    return <span className="whitespace-nowrap rounded bg-white/60 px-1 text-[10px] text-gray-600 select-none">{t.name}</span>
  }
  return (
    <span className="flex select-none items-center gap-1 whitespace-nowrap">
      <span
        className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold text-white shadow ring-2 ring-white ${
          current ? 'bg-cyan-600' : 'bg-blue-600'
        }`}
      >
        {t.visitIndex + 1}
      </span>
      {current && <span className="rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-gray-900 shadow">{t.name}</span>}
    </span>
  )
}

// Метка «H» на земле в точке взлёта: текстура рисуется на холсте, без шрифтов из сети
export function TakeoffPad({ at }: { at: LocalPoint }) {
  const { geometry, material } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(64, 64, 62, 0, 2 * Math.PI)
      ctx.fill()
      ctx.lineWidth = 8
      ctx.strokeStyle = '#1d4ed8'
      ctx.beginPath()
      ctx.arc(64, 64, 52, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.fillStyle = '#1d4ed8'
      ctx.font = 'bold 72px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('H', 64, 68)
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return {
      geometry: new CircleGeometry(PAD_RADIUS_M, 48),
      material: new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false }),
    }
  }, [])
  useEffect(
    () => () => {
      material.map?.dispose()
      material.dispose()
      geometry.dispose()
    },
    [geometry, material],
  )
  return <mesh geometry={geometry} material={material} position={[at.x, PAD_LIFT_M, -at.y]} rotation-x={-Math.PI / 2} />
}
