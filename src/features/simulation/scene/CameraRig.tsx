import { useRef, useState, type ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MOUSE, PerspectiveCamera, Vector3 } from 'three'
import { boundsSize, type LocalBounds } from '../sceneMath'
import { smoothAngle, topViewDistance, type CameraMode } from '../simView'
import { FRAME_PRIORITY, type DroneFrame } from './droneFrame'

// "За дроном" догоняет плавно из любого положения, "сверху" подлетает к ферме за TOP_FLIGHT_S

export const FOLLOW_BACK_M = 60
export const FOLLOW_UP_M = 25
const FOLLOW_RATE = 2.5
const FOLLOW_YAW_RATE = 2
// Потолок скорости разворота на ускорении, иначе на углах маршрута кадр дёргается
const MAX_FOLLOW_YAW_RATE = 10
const LOOK_RATE = 5
const TOP_TILT_RAD = (22 * Math.PI) / 180
const TOP_FLIGHT_S = 1.2
const MIN_ORBIT_DISTANCE_M = 5
// Камера не уходит под землю
const MAX_POLAR_RAD = Math.PI / 2 - 0.03

interface CameraRigProps {
  mode: CameraMode
  frame: DroneFrame
  bounds: LocalBounds
  farM: number
}

export default function CameraRig({ mode, frame, bounds, farM }: CameraRigProps) {
  if (mode === 'free') return <FreeCamera frame={frame} farM={farM} />
  if (mode === 'top') return <TopCamera frame={frame} bounds={bounds} farM={farM} />
  return <FollowCamera frame={frame} />
}

// Камера относительно дрона в цилиндрических координатах, чтобы при развороте
// обходить его по дуге, а не проходить насквозь
interface FollowState {
  yaw: number
  dist: number
  height: number
  // Куда смотрит камера относительно дрона, сходится к нулю
  look: Vector3
}

function FollowCamera({ frame }: { frame: DroneFrame }) {
  const camera = useThree((s) => s.camera)
  const state = useRef<FollowState | null>(null)
  const [aim] = useState(() => new Vector3())

  useFrame((_, dt) => {
    if (!frame.sample) return
    const drone = frame.position
    let s = state.current
    if (!s) {
      // Начинаем с того места и направления, где камера уже стоит
      const ox = camera.position.x - drone.x
      const oz = camera.position.z - drone.z
      const dist = Math.hypot(ox, oz)
      const look = camera.getWorldDirection(new Vector3()).multiplyScalar(camera.position.distanceTo(drone)).add(camera.position).sub(drone)
      s = { yaw: dist > 1e-6 ? Math.atan2(ox, oz) : frame.rotationY, dist, height: camera.position.y - drone.y, look }
      state.current = s
    }
    const k = 1 - Math.exp(-FOLLOW_RATE * dt)
    // Позади дрона: нос смотрит на (-sin r, 0, -cos r)
    s.yaw = smoothAngle(s.yaw, frame.rotationY, dt, Math.min(MAX_FOLLOW_YAW_RATE, FOLLOW_YAW_RATE * frame.pace))
    s.dist += (FOLLOW_BACK_M - s.dist) * k
    s.height += (FOLLOW_UP_M - s.height) * k
    s.look.multiplyScalar(Math.exp(-LOOK_RATE * dt))
    camera.position.set(drone.x + Math.sin(s.yaw) * s.dist, drone.y + s.height, drone.z + Math.cos(s.yaw) * s.dist)
    camera.lookAt(aim.copy(drone).add(s.look))
  }, FRAME_PRIORITY.camera)

  return null
}

function FreeCamera({ frame, farM }: { frame: DroneFrame; farM: number }) {
  // Цель там, где был дрон при переключении, дальше её двигает только пользователь
  const [target] = useState(() => frame.position.clone())
  return (
    <OrbitControls
      makeDefault
      target={target}
      minDistance={MIN_ORBIT_DISTANCE_M}
      maxDistance={farM * 0.45}
      maxPolarAngle={MAX_POLAR_RAD}
    />
  )
}

type Controls = ComponentRef<typeof OrbitControls>

interface Flight {
  t: number
  fromPos: Vector3
  fromTarget: Vector3
  toPos: Vector3
  toTarget: Vector3
}

function TopCamera({ frame, bounds, farM }: { frame: DroneFrame; bounds: LocalBounds; farM: number }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useRef<Controls>(null)
  // Вид считаем один раз при входе в режим, чтобы ресайз окна не сбрасывал зум и сдвиг
  const [flight] = useState<Flight>(() => {
    const { width, depth, center } = boundsSize(bounds)
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50
    const d = Math.min(topViewDistance(width, depth, fov, size.width / Math.max(1, size.height)), farM * 0.4)
    const toTarget = new Vector3(center.x, 0, -center.y)
    // Лёгкий наклон: камера чуть южнее центра, север вверху экрана
    const toPos = toTarget.clone().add(new Vector3(0, Math.cos(TOP_TILT_RAD) * d, Math.sin(TOP_TILT_RAD) * d))
    // Цель берём на текущем луче взгляда, чтобы вид не дёрнулся на первом кадре подлёта
    const lookDistance = Math.min(farM * 0.45, Math.max(MIN_ORBIT_DISTANCE_M, camera.position.distanceTo(frame.position)))
    const fromTarget = camera.getWorldDirection(new Vector3()).multiplyScalar(lookDistance).add(camera.position)
    return { t: 0, fromPos: camera.position.clone(), fromTarget, toPos, toTarget }
  })

  useFrame((_, dt) => {
    const c = controls.current
    if (!c || flight.t >= 1) return
    flight.t = Math.min(1, flight.t + dt / TOP_FLIGHT_S)
    // Плавный разгон и торможение
    const k = flight.t * flight.t * (3 - 2 * flight.t)
    camera.position.lerpVectors(flight.fromPos, flight.toPos, k)
    c.target.lerpVectors(flight.fromTarget, flight.toTarget, k)
  }, FRAME_PRIORITY.objects)

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={flight.fromTarget}
      minDistance={MIN_ORBIT_DISTANCE_M}
      maxDistance={farM * 0.45}
      maxPolarAngle={MAX_POLAR_RAD}
      // Как на карте: левая кнопка сдвигает, колесо приближает, правая наклоняет и вращает
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
      onStart={() => {
        // Пользователь взялся за камеру, подлёт прекращаем
        flight.t = 1
      }}
    />
  )
}
