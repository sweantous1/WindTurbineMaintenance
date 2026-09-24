import { useMemo, useRef, type ComponentRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Color, type InterleavedBufferAttribute } from 'three'
import type { Trajectory } from '@/domain/flightPath'
import { toScene, type SceneVec } from '../sceneMath'
import { PATH_COLORS, pathKind } from '../simView'
import { FRAME_PRIORITY, type DroneFrame } from './droneFrame'

// Путь облёта отрезками траектории. Весь план — тонкой линией; пройденное — вторая линия
// с теми же отрезками поверх, у которой рисуется только нужное число первых отрезков
// (instanceCount): ничего не перестраивается, пока номер отрезка не сменится.
// «Хвост» от начала текущего отрезка до дрона правится на месте каждый кадр

type LineObject = ComponentRef<typeof Line>
type RGB = [number, number, number]

const PLAN_WIDTH_PX = 2
const PASSED_WIDTH_PX = 4.5
// Точки хвоста до первого кадра: дальше они правятся прямо в буфере геометрии
const EMPTY_TAIL: SceneVec[] = [
  [0, 0, 0],
  [0, 0, 0],
]

interface FlightPathProps {
  trajectory: Trajectory
  conflictSegments: ReadonlySet<number>
  frame: DroneFrame
}

export default function FlightPath({ trajectory, conflictSegments, frame }: FlightPathProps) {
  const { points, planColors, passedColors, tailColors } = useMemo(() => {
    const pts: SceneVec[] = []
    const plan: RGB[] = []
    const passed: RGB[] = []
    const tail: Color[] = []
    trajectory.segments.forEach((s, i) => {
      const kind = pathKind(s.phase, conflictSegments.has(i))
      const planColor = new Color(PATH_COLORS[kind].plan).toArray() as RGB
      const passedColor = new Color(PATH_COLORS[kind].passed)
      pts.push(toScene(s.from), toScene(s.to))
      plan.push(planColor, planColor)
      passed.push(passedColor.toArray() as RGB, passedColor.toArray() as RGB)
      tail.push(passedColor)
    })
    return { points: pts, planColors: plan, passedColors: passed, tailColors: tail }
  }, [trajectory, conflictSegments])

  const passedRef = useRef<LineObject>(null)
  const tailRef = useRef<LineObject>(null)

  useFrame(() => {
    const sample = frame.sample
    const passed = passedRef.current
    const tail = tailRef.current
    if (!sample || !passed || !tail) return
    const { segments } = trajectory
    // Полностью пройдены отрезки до текущего; в конце — все
    passed.geometry.instanceCount = sample.finished ? segments.length : Math.max(0, sample.segmentIndex)

    const seg = segments[sample.segmentIndex]
    tail.visible = !sample.finished && seg !== undefined
    if (!tail.visible || !seg) return
    const start = tail.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
    const arr = start.data.array as Float32Array
    // Порядок как в toScene: x — восток, y — высота, z — юг
    arr[0] = seg.from.x
    arr[1] = seg.from.z
    arr[2] = -seg.from.y
    arr[3] = frame.position.x
    arr[4] = frame.position.y
    arr[5] = frame.position.z
    start.data.needsUpdate = true
    tail.material.color.copy(tailColors[sample.segmentIndex])
  }, FRAME_PRIORITY.objects)

  if (points.length === 0) return null

  return (
    <group>
      {/* Без записи глубины: пройденная линия с теми же точками ложится поверх без мерцания */}
      <Line
        points={points}
        vertexColors={planColors}
        segments
        lineWidth={PLAN_WIDTH_PX}
        depthWrite={false}
        renderOrder={1}
        toneMapped={false}
      />
      <Line ref={passedRef} points={points} vertexColors={passedColors} segments lineWidth={PASSED_WIDTH_PX} renderOrder={2} toneMapped={false} />
      {/* Хвост двигается каждый кадр — ограничивающая сфера у него устаревшая, отсечение по ней выключено */}
      <Line ref={tailRef} points={EMPTY_TAIL} segments lineWidth={PASSED_WIDTH_PX} renderOrder={2} toneMapped={false} frustumCulled={false} />
    </group>
  )
}
