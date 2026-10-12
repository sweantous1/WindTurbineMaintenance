import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, Group, Quaternion, Vector3, type Material, type Mesh, type Object3D, type Texture } from 'three'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import { DRONE_VISUAL_SPAN_M } from '../simView'
import { AIRBORNE_M, FRAME_PRIORITY, type DroneFrame } from './droneFrame'

// Модель liz3d (CC BY 4.0, public/models/drone), пока грузится или при ошибке рисуем дрон из примитивов.
// Модель центрируем по рамке, нос (сторона камеры) на -Z, размах DRONE_VISUAL_SPAN_M

const FULL_TURN = 2 * Math.PI
// Видимая скорость винтов, настоящие 100 об/с на экране дают стробоскоп
const PROPELLER_RAD_S = 30
const SHADOW_LIFT_M = 0.6
const STALK_RADIUS_M = 0.12

interface Propeller {
  pivot: Object3D
  // Вертикаль сцены в осях родителя pivot
  axis: Vector3
  // Соседние винты крутятся в разные стороны
  dir: 1 | -1
}

// Относительно документа: одинаково на dev-сервере, в веб-сборке и под app://bundle в Electron
function droneModelUrl(): string {
  return new URL('models/drone/drone.glb', document.baseURI).href
}

export default function Drone({ frame }: { frame: DroneFrame }) {
  const body = useRef<Group>(null)
  const shadow = useRef<Mesh>(null)
  const stalk = useRef<Mesh>(null)
  const propellers = useRef<Propeller[]>([])
  const spin = useRef(0)
  const setPropellers = useCallback((list: Propeller[]) => {
    propellers.current = list
  }, [])

  useFrame((_, dt) => {
    const p = frame.position
    body.current?.position.copy(p)
    if (body.current) body.current.rotation.y = frame.rotationY
    const airborne = p.y > AIRBORNE_M
    if (airborne) spin.current = (spin.current + dt * PROPELLER_RAD_S) % FULL_TURN
    for (const prop of propellers.current) prop.pivot.quaternion.setFromAxisAngle(prop.axis, spin.current * prop.dir)
    // Тень и отвес до земли показывают высоту, когда камера смотрит сбоку или сверху
    if (shadow.current) {
      shadow.current.visible = airborne
      shadow.current.position.set(p.x, SHADOW_LIFT_M, p.z)
    }
    if (stalk.current) {
      stalk.current.visible = airborne
      stalk.current.position.set(p.x, p.y / 2, p.z)
      stalk.current.scale.set(1, Math.max(p.y, 1e-3), 1)
    }
  }, FRAME_PRIORITY.objects)

  return (
    <>
      <group ref={body}>
        <ErrorBoundary fallback={<FallbackDrone />}>
          <Suspense fallback={<FallbackDrone />}>
            <DroneModel onPropellers={setPropellers} />
          </Suspense>
        </ErrorBoundary>
      </group>
      <mesh ref={shadow} rotation-x={-Math.PI / 2} visible={false}>
        <circleGeometry args={[DRONE_VISUAL_SPAN_M * 0.4, 32]} />
        <meshBasicMaterial color="#111827" transparent opacity={0.3} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={stalk} visible={false}>
        <cylinderGeometry args={[STALK_RADIUS_M, STALK_RADIUS_M, 1, 6]} />
        <meshBasicMaterial color="#374151" transparent opacity={0.5} toneMapped={false} />
      </mesh>
    </>
  )
}

function DroneModel({ onPropellers }: { onPropellers: (list: Propeller[]) => void }) {
  // Без Draco и Meshopt, иначе drei тянет декодеры с CDN, а модели они не нужны
  const gltf = useGLTF(droneModelUrl(), false, false)
  const prepared = useMemo(() => prepareDrone(gltf.scene), [gltf.scene])
  useLayoutEffect(() => {
    onPropellers(prepared.propellers)
    return () => onPropellers([])
  }, [prepared, onPropellers])
  // R3F не освобождает ресурсы из кэша загрузчика, и старые рендереры держатся на них через dispose.
  // Освобождаем сами, three.js заново загрузит их в GPU при следующем показе
  useEffect(() => () => disposeModel(gltf.scene), [gltf.scene])
  return <primitive object={prepared.root} />
}

function disposeModel(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if ((value as Texture | null)?.isTexture) (value as Texture).dispose()
      }
      material.dispose()
    }
  })
}

// Перестраиваем копию, а не сцену из кэша. Геометрии и материалы общие и не меняются
function prepareDrone(source: Object3D): { root: Group; propellers: Propeller[] } {
  const model = source.clone(true)
  model.position.set(0, 0, 0)
  model.quaternion.identity()
  model.scale.set(1, 1, 1)
  model.updateMatrixWorld(true)

  const box = new Box3().setFromObject(model)
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())

  // Нос там, где камера. Берём центр самой камеры: у её узла точка на оси подвеса позади объектива.
  // Поворот округляем до 90°, камера под брюхом чуть смещена вбок
  let turn = 0
  const camera = model.getObjectByName('camera')
  if (camera) {
    const c = new Box3().setFromObject(camera).getCenter(new Vector3())
    const dx = c.x - center.x
    const dz = c.z - center.z
    if (Math.hypot(dx, dz) > 1e-9) turn = Math.round((Math.PI - Math.atan2(dx, dz)) / (Math.PI / 2)) * (Math.PI / 2)
  }

  const propellers = extractPropellers(model, center)

  // По горизонтали центр рамки, низ на точке траектории, чтобы на земле дрон не утопал
  model.position.set(-center.x, -box.min.y, -center.z)
  const root = new Group()
  root.rotation.y = turn
  root.scale.setScalar(DRONE_VISUAL_SPAN_M / Math.max(size.x, size.z, 1e-6))
  root.add(model)
  return { root, propellers }
}

// У мешей винтов нет своей оси, поэтому вешаем каждый на узел в центре его рамки и крутим узел.
// Геометрию не трогаем, она квантованная и общая с кэшем
function extractPropellers(model: Object3D, modelCenter: Vector3): Propeller[] {
  const nodes: Object3D[] = []
  model.traverse((o) => {
    if (o.name.startsWith('helice')) nodes.push(o)
  })
  const up = new Vector3(0, 1, 0)
  const result: Propeller[] = []
  for (const node of nodes) {
    const meshes = node.children.filter((c): c is Mesh => (c as Mesh).isMesh === true)
    for (const mesh of meshes) {
      const geometry = mesh.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      const localCenter = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3()
      // Центр меша в осях узла helice
      const pivotAt = localCenter.applyMatrix4(mesh.matrix)
      const pivot = new Group()
      pivot.position.copy(pivotAt)
      node.add(pivot)
      pivot.add(mesh)
      mesh.position.sub(pivotAt)
      // Дальше модель только вращается вокруг вертикали и масштабируется равномерно, так что ось берём сейчас
      const toLocal = node.getWorldQuaternion(new Quaternion()).invert()
      const axis = up.clone().applyQuaternion(toLocal).normalize()
      const world = node.localToWorld(pivotAt.clone())
      const dir = (world.x - modelCenter.x) * (world.z - modelCenter.z) >= 0 ? 1 : -1
      result.push({ pivot, axis, dir })
    }
  }
  return result
}

// Запасной дрон тех же размеров: крестовина, корпус, четыре винта и красный нос на -Z
function FallbackDrone() {
  const span = DRONE_VISUAL_SPAN_M
  const arm = span * 0.72
  const rotorAt = arm / 2 / Math.SQRT2
  return (
    <group position-y={span * 0.08}>
      <mesh>
        <boxGeometry args={[span * 0.22, span * 0.1, span * 0.3]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh position={[0, 0, -span * 0.16]}>
        <boxGeometry args={[span * 0.08, span * 0.06, span * 0.04]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
      {[Math.PI / 4, -Math.PI / 4].map((a) => (
        <mesh key={a} rotation-y={a}>
          <boxGeometry args={[arm, span * 0.03, span * 0.04]} />
          <meshStandardMaterial color="#4b5563" />
        </mesh>
      ))}
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[sx * rotorAt, span * 0.04, sz * rotorAt]}>
          <cylinderGeometry args={[span * 0.13, span * 0.13, span * 0.01, 20]} />
          <meshStandardMaterial color="#9ca3af" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  )
}
