import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { BackSide, Color, PerspectiveCamera, ShaderMaterial, Vector3, type Mesh } from 'three'
import { sampleAt, type Trajectory } from '@/domain/flightPath'
import type { SimClock } from '../simClock'
import type { SimReady } from '../simData'
import { boundsSize, toScene, yawToRotationY } from '../sceneMath'
import { smoothAngle, type CameraMode } from '../simView'
import { useCurrentVisit } from '../useSimClock'
import CameraRig, { FOLLOW_BACK_M, FOLLOW_UP_M } from './CameraRig'
import Drone from './Drone'
import FlightPath from './FlightPath'
import Ground from './Ground'
import { LabelLayer, LabelProjector, TakeoffPad } from './Labels'
import Turbines from './Turbine'
import { createDroneFrame, createLabelRegistry, FRAME_PRIORITY, type DroneFrame, type LabelRegistry } from './droneFrame'

// Грузится лениво, чтобы three.js, R3F и drei были только в этом чанке

interface SimulationCanvasProps {
  data: SimReady
  clock: SimClock
  cameraMode: CameraMode
  groundMap: boolean
}

// Дальняя плоскость с запасом от диагонали, но не ближе 20 км, чтобы влезали вид сверху и дымка
const MIN_FAR_M = 20_000
const FOV_DEG = 50
const NEAR_M = 0.5
// Доворот носа дрона, 1/с времени полёта
const YAW_RATE = 6
// Солнце с юго-запада, высоко: тени от башен не нужны, а свет ровный
const SUN_DIRECTION = new Vector3(-0.45, 0.75, 0.5).normalize()
// Дымка и туман одного цвета, чтобы земля уходила в небо без шва
const HAZE_COLOR = '#cddbe8'
const ZENITH_COLOR = '#5b93cf'

export default function SimulationCanvas({ data, clock, cameraMode, groundMap }: SimulationCanvasProps) {
  const { t } = useTranslation()
  const [frame] = useState(createDroneFrame)
  const [labels] = useState(createLabelRegistry)
  const { width, depth } = boundsSize(data.bounds)
  const diagonal = Math.hypot(width, depth)
  const farM = Math.max(MIN_FAR_M, diagonal * 4)
  // По умолчанию камера за дроном, сразу ставим её туда
  const [initialCamera] = useState(() => {
    const s = sampleAt(data.trajectory, clock.timeS())
    const [x, y, z] = toScene(s.position)
    const r = yawToRotationY(s.yawRad)
    return {
      position: [x + Math.sin(r) * FOLLOW_BACK_M, y + FOLLOW_UP_M, z + Math.cos(r) * FOLLOW_BACK_M] as [number, number, number],
      lookAt: new Vector3(x, y, z),
    }
  })

  return (
    <div className="relative h-full w-full">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
        camera={{ fov: FOV_DEG, near: NEAR_M, far: farM, position: initialCamera.position }}
        onCreated={(state) => state.camera.lookAt(initialCamera.lookAt)}
        role="img"
        aria-label={t('sim.scene.label')}
      >
        <SceneContent
          data={data}
          clock={clock}
          cameraMode={cameraMode}
          groundMap={groundMap}
          frame={frame}
          farM={farM}
          diagonal={diagonal}
          labels={labels}
        />
      </Canvas>
      <SceneLabels data={data} clock={clock} labels={labels} />
    </div>
  )
}

function SceneLabels({ data, clock, labels }: { data: SimReady; clock: SimClock; labels: LabelRegistry }) {
  const currentVisit = useCurrentVisit(clock, data.trajectory)
  return <LabelLayer turbines={data.turbines} currentVisit={currentVisit} registry={labels} />
}

interface SceneContentProps extends SimulationCanvasProps {
  frame: DroneFrame
  labels: LabelRegistry
  farM: number
  diagonal: number
}

function SceneContent({ data, clock, cameraMode, groundMap, frame, farM, diagonal, labels }: SceneContentProps) {
  const currentVisit = useCurrentVisit(clock, data.trajectory)
  const sun = useMemo(() => SUN_DIRECTION.clone().multiplyScalar(1000), [])
  // Дымка начинается за фермой и к краю видимости скрывает обрыв дальней земли
  const fogNear = Math.max(3000, diagonal * 1.5)
  const fogFar = Math.max(fogNear * 2, farM * 0.9)

  return (
    <>
      <CameraFar farM={farM} />
      <color attach="background" args={[HAZE_COLOR]} />
      <fog attach="fog" args={[HAZE_COLOR, fogNear, fogFar]} />
      <SkyDome radius={farM * 0.5} />
      <hemisphereLight args={['#e0ecff', '#6f8a55', 1.4]} />
      <directionalLight position={sun} intensity={2.2} />

      <SimDriver clock={clock} trajectory={data.trajectory} frame={frame} />
      <Ground bounds={data.bounds} frame={data.frame} showMap={groundMap} farM={farM} />
      <TakeoffPad at={data.takeoff} />
      <Turbines turbines={data.turbines} wind={data.wind} currentVisit={currentVisit} />
      <LabelProjector turbines={data.turbines} registry={labels} />
      <FlightPath trajectory={data.trajectory} conflictSegments={data.conflictSegments} frame={frame} />
      <Drone frame={frame} />
      <CameraRig mode={cameraMode} frame={frame} bounds={data.bounds} farM={farM} />
    </>
  )
}

// Часы тикают только здесь: считаем точку траектории и курс, остальные только читают frame
function SimDriver({ clock, trajectory, frame }: { clock: SimClock; trajectory: Trajectory; frame: DroneFrame }) {
  useFrame((_, delta) => {
    clock.tick(delta)
    const s = sampleAt(trajectory, clock.timeS())
    const [x, y, z] = toScene(s.position)
    frame.position.set(x, y, z)
    const target = yawToRotationY(s.yawRad)
    // Доворот во времени полёта, иначе на x20 нос отстаёт от турбины. На паузе в реальном времени,
    // при большой перемотке и на первом кадре сразу по курсу
    const advanced = frame.sample ? Math.abs(s.timeS - frame.sample.timeS) : Infinity
    frame.rotationY = smoothAngle(frame.rotationY, target, Math.max(delta, advanced), YAW_RATE)
    frame.pace = delta > 0 && Number.isFinite(advanced) ? Math.max(1, advanced / delta) : 1
    frame.sample = s
  }, FRAME_PRIORITY.driver)
  return null
}

// Рамка сцены может смениться (ферму поправили в другом окне), а камера создаётся один раз
function CameraFar({ farM }: { farM: number }) {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || camera.far === farM) return
    camera.far = farM
    camera.updateProjectionMatrix()
  }, [camera, farM])
  return null
}

// Градиент от дымки к синему в зените. Sky из drei при экспозиции R3F выгорает у горизонта и не совпадает с туманом
function SkyDome({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera)
  const mesh = useRef<Mesh>(null)
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { horizon: { value: new Color(HAZE_COLOR) }, zenith: { value: new Color(ZENITH_COLOR) } },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 horizon;
          uniform vec3 zenith;
          varying vec3 vDir;
          void main() {
            gl_FragColor = vec4(mix(horizon, zenith, pow(clamp(vDir.y, 0.0, 1.0), 0.55)), 1.0);
            #include <colorspace_fragment>
          }`,
        side: BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  // Купол всегда вокруг камеры и рисуется первым: всё остальное ложится поверх
  useFrame(() => mesh.current?.position.copy(camera.position), FRAME_PRIORITY.camera + 0.5)
  return (
    <mesh ref={mesh} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  )
}
