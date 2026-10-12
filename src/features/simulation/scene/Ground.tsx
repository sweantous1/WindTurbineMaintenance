import { useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import type { LocalFrame } from '@/lib/geo'
import { boundsSize, groundTiles, type LocalBounds } from '../sceneMath'

// Поле цвета травы по рамке сцены и, если включено, тайлы OSM поверх.
// С логарифмическим буфером глубины долей метра между слоями хватает, чтобы не мерцало

export const GRASS_COLOR = '#7f9f5b'
const FAR_GROUND_COLOR = '#8aa36c'
const TILE_LIFT_M = 0.15
const FAR_GROUND_DROP_M = 0.5
// Не больше 64 тайлов на ферму, чтобы не нагружать серверы OSM
const MAX_TILES = 64
const MAX_ZOOM = 16

interface GroundProps {
  bounds: LocalBounds
  frame: LocalFrame
  showMap: boolean
  // Дальняя плоскость камеры, до неё тянется дальняя земля
  farM: number
}

export default function Ground({ bounds, frame, showMap, farM }: GroundProps) {
  const { width, depth, center } = boundsSize(bounds)
  return (
    <group>
      {/* Земля за рамкой, чтобы за крайними башнями не было обрыва в небо */}
      <mesh rotation-x={-Math.PI / 2} position={[center.x, -FAR_GROUND_DROP_M, -center.y]}>
        <planeGeometry args={[farM * 2, farM * 2]} />
        <meshLambertMaterial color={FAR_GROUND_COLOR} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[center.x, 0, -center.y]}>
        <planeGeometry args={[width, depth]} />
        <meshLambertMaterial color={GRASS_COLOR} />
      </mesh>
      {showMap && <MapTiles bounds={bounds} frame={frame} />}
    </group>
  )
}

function MapTiles({ bounds, frame }: { bounds: LocalBounds; frame: LocalFrame }) {
  const gl = useThree((s) => s.gl)
  const tiles = useMemo(() => groundTiles(frame, bounds, MAX_TILES, MAX_ZOOM), [frame, bounds])
  const [group] = useState(() => new Group())

  useEffect(() => {
    // Одна геометрия на все тайлы: размер и место задаёт масштаб меша
    const geometry = new PlaneGeometry(1, 1)
    const materials: MeshBasicMaterial[] = []
    const textures: Texture[] = []
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    const loader = new TextureLoader()
    // OSM отдаёт Access-Control-Allow-Origin: *, без crossOrigin WebGL текстуру не примет
    loader.setCrossOrigin('anonymous')
    let disposed = false

    for (const tile of tiles) {
      // Пока тайла нет, плоскость цвета травы. toneMapped: false, чтобы цвета карты были как есть
      const material = new MeshBasicMaterial({ color: GRASS_COLOR, toneMapped: false })
      materials.push(material)
      const mesh = new Mesh(geometry, material)
      const { minX, maxX, minY, maxY } = tile.rect
      mesh.position.set((minX + maxX) / 2, TILE_LIFT_M, -(minY + maxY) / 2)
      mesh.rotation.x = -Math.PI / 2
      mesh.scale.set(maxX - minX, maxY - minY, 1)
      group.add(mesh)
      loader.load(
        tile.url,
        (texture) => {
          // Ответ пришёл после ухода со сцены или выключения карты
          if (disposed) {
            texture.dispose()
            return
          }
          texture.colorSpace = SRGBColorSpace
          texture.anisotropy = anisotropy
          textures.push(texture)
          material.map = texture
          material.color.set('#ffffff')
          material.needsUpdate = true
        },
        undefined,
        () => {
          // Нет сети или сервер отказал, остаётся плоскость без текстуры
        },
      )
    }

    return () => {
      disposed = true
      group.clear()
      geometry.dispose()
      for (const m of materials) m.dispose()
      for (const tx of textures) tx.dispose()
    }
  }, [group, tiles, gl])

  return <primitive object={group} />
}
