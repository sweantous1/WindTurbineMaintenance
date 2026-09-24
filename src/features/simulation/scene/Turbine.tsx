import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  type Group,
} from 'three'
import type { SimTurbine, SimWind } from '../simData'
import { nacelleRotationY, rotorRpm } from '../sceneMath'
import { RING_COLORS } from '../simView'

// Процедурная ветроустановка в реальном масштабе по высоте ступицы и диаметру ротора.
// Геометрии и материалы общие для всех турбин (единичные размеры, масштаб — у меша):
// на ферме в 200 башен это 200 наборов мешей, но одна копия данных

// Без прогноза ветра гондолы смотрят на запад, роторы стоят
const NO_WIND_FROM_DEG = 270
const FULL_TURN = 2 * Math.PI
const BLADE_ANGLES = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
// Кольца лежат чуть выше тайлов карты
const RING_LIFT_M = 0.4

interface TurbineKit {
  tower: CylinderGeometry
  box: BoxGeometry
  spinner: SphereGeometry
  blade: CylinderGeometry
  ring: RingGeometry
  body: MeshStandardMaterial
  conflictRing: MeshBasicMaterial
  currentRing: MeshBasicMaterial
}

function createKit(): TurbineKit {
  // Башня сужается к верху; основание в нуле
  const tower = new CylinderGeometry(0.55, 1, 1, 24, 1)
  tower.translate(0, 0.5, 0)
  // Лопасть длиной 1: широкая у ступицы, узкая к концу, плоская
  const blade = new CylinderGeometry(0.012, 0.04, 1, 10, 1)
  blade.scale(1, 1, 0.3)
  blade.translate(0, 0.5, 0)
  const ring = new RingGeometry(0.86, 1, 64)
  ring.rotateX(-Math.PI / 2)
  const ringMaterial = (color: string) =>
    new MeshBasicMaterial({ color, side: DoubleSide, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })
  return {
    tower,
    box: new BoxGeometry(1, 1, 1),
    spinner: new SphereGeometry(1, 20, 14),
    blade,
    ring,
    body: new MeshStandardMaterial({ color: '#eceef1', roughness: 0.55, metalness: 0.05 }),
    conflictRing: ringMaterial(RING_COLORS.conflict),
    currentRing: ringMaterial(RING_COLORS.current),
  }
}

function disposeKit(kit: TurbineKit): void {
  for (const item of Object.values(kit)) item.dispose()
}

interface TurbinesProps {
  turbines: readonly SimTurbine[]
  wind: SimWind | null
  // Номер турбины (с нуля), которую облетаем сейчас
  currentVisit: number | null
}

export default function Turbines({ turbines, wind, currentVisit }: TurbinesProps) {
  const kit = useMemo(createKit, [])
  useEffect(() => () => disposeKit(kit), [kit])

  const rotors = useRef<(Group | null)[]>([])
  // Угловая скорость каждого ротора, рад/с: обороты зависят от диаметра
  const speeds = useMemo(() => turbines.map((t) => (rotorRpm(wind?.hubMs, t.rotorM) * FULL_TURN) / 60), [turbines, wind])
  const nacelleY = nacelleRotationY(wind?.fromDeg ?? NO_WIND_FROM_DEG)

  // Роторы крутятся в реальном времени, независимо от скорости проигрывания: это погода, а не полёт
  useFrame((_, dt) => {
    const list = rotors.current
    for (let i = 0; i < list.length; i++) {
      const rotor = list[i]
      const w = speeds[i]
      if (rotor && w > 0) rotor.rotation.z = (rotor.rotation.z + w * dt) % FULL_TURN
    }
  })

  return (
    <group>
      {turbines.map((t, i) => (
        <Turbine
          key={t.id}
          turbine={t}
          kit={kit}
          nacelleY={nacelleY}
          current={currentVisit !== null && t.visitIndex === currentVisit}
          rotorRef={(g) => {
            rotors.current[i] = g
          }}
        />
      ))}
    </group>
  )
}

interface TurbineProps {
  turbine: SimTurbine
  kit: TurbineKit
  nacelleY: number
  current: boolean
  rotorRef: (g: Group | null) => void
}

function Turbine({ turbine: t, kit, nacelleY, current, rotorRef }: TurbineProps) {
  const towerR = Math.max(1, t.hubM / 45)
  const nacelleLen = t.rotorM / 12
  const nacelleSide = t.rotorM / 30
  const spinnerR = t.rotorM / 40
  const ringR = Math.max(15, t.rotorM / 4)
  return (
    <group position={[t.local.x, 0, -t.local.y]}>
      <mesh geometry={kit.tower} material={kit.body} scale={[towerR, t.hubM, towerR]} />
      {/* Гондола: нос с ротором при нулевом повороте смотрит на север (−Z) */}
      <group position-y={t.hubM} rotation-y={nacelleY}>
        <mesh geometry={kit.box} material={kit.body} position-z={nacelleLen * 0.25} scale={[nacelleSide, nacelleSide, nacelleLen]} />
        {/* Положительный поворот вокруг Z — по часовой стрелке, если смотреть навстречу ветру, как у настоящих машин */}
        <group ref={rotorRef} position-z={-nacelleLen * 0.25 - spinnerR * 0.4}>
          <mesh geometry={kit.spinner} material={kit.body} scale={[spinnerR, spinnerR, spinnerR * 1.4]} />
          {BLADE_ANGLES.map((a) => (
            <mesh key={a} geometry={kit.blade} material={kit.body} rotation-z={a} scale={t.rotorM / 2} />
          ))}
        </group>
      </group>
      {t.conflict && <mesh geometry={kit.ring} material={kit.conflictRing} position-y={RING_LIFT_M} scale={ringR} />}
      {current && <mesh geometry={kit.ring} material={kit.currentRing} position-y={RING_LIFT_M + 0.05} scale={ringR * 1.3} />}
    </group>
  )
}
