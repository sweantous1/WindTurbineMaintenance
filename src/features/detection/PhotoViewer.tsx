import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFECT_COLORS, type Detection, type PhotoRecord } from '@/domain/detection'
import { NO_ZOOM, fitScale, layoutOverlay, overlayStyle, zoomToBox } from './overlayGeometry'
import { useElementSize, usePhotoUrl } from './usePhotoUrl'

interface PhotoViewerProps {
  photo: PhotoRecord
  // Видимые находки фото (после порога и фильтра классов)
  detections: readonly Detection[]
  selectedId: string | null
  onSelect: (detectionId: string | null) => void
  labelText: (d: Detection) => string
  ariaLabel: (d: Detection) => string
  zoomed: boolean
}

// Снимок вписан через object-contain, а SVG поверх — с viewBox по натуральному размеру
// и preserveAspectRatio «meet»: оба вписываются одинаково, и рамки в пикселях оригинала ложатся точно
export default function PhotoViewer({ photo, detections, selectedId, onSelect, labelText, ariaLabel, zoomed }: PhotoViewerProps) {
  const { t } = useTranslation()
  const url = usePhotoUrl(photo.id, 'blob')
  // Снимок на 45 Мп декодируется заметное время: до события load рамки висели бы над пустым полем
  const [shown, setShown] = useState<{ url: string; ok: boolean } | null>(null)
  const loaded = !!url && shown?.url === url && shown.ok
  const broken = !!url && shown?.url === url && !shown.ok
  const boxRef = useRef<HTMLDivElement>(null)
  const box = useElementSize(boxRef)
  const natural = useMemo(() => ({ width: photo.width, height: photo.height }), [photo.width, photo.height])

  const selected = selectedId ? detections.find((d) => d.id === selectedId) : undefined
  const zoom = zoomed && selected && box ? zoomToBox(selected, natural, box) : NO_ZOOM
  const fit = box ? fitScale(natural, box) : 0
  // Линии и подписи одной толщины на экране при любом размере снимка и приближении
  const unitsPerPx = fit > 0 ? 1 / (fit * zoom.scale) : Math.max(natural.width, natural.height) / 800
  const style = useMemo(() => overlayStyle(unitsPerPx), [unitsPerPx])
  const laid = useMemo(() => layoutOverlay(detections, natural, style, labelText), [detections, natural, style, labelText])
  // Выбранная рамка — поверх остальных
  const items = selected ? [...laid.filter((it) => it.item.id !== selected.id), ...laid.filter((it) => it.item.id === selected.id)] : laid

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Escape' && selectedId) {
      e.preventDefault()
      onSelect(null)
      return
    }
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onSelect(id)
  }

  return (
    <div ref={boxRef} className="relative h-[clamp(320px,56vh,640px)] overflow-hidden rounded-lg bg-gray-900">
      {(url === undefined || (url && !loaded && !broken)) && <Overlay text={t('defects.viewer.loading')} />}
      {url === null && <Overlay text={t('defects.viewer.imageMissing')} />}
      {broken && <Overlay text={t('defects.viewer.imageBroken')} />}
      {url && (
        <div
          className="absolute inset-0 origin-top-left transition-transform duration-300 ease-out"
          style={{ transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` }}
        >
          <img
            src={url}
            alt={t('defects.viewer.imageAlt', { name: photo.fileName })}
            className="absolute inset-0 h-full w-full select-none object-contain"
            draggable={false}
            decoding="async"
            onLoad={() => setShown({ url, ok: true })}
            onError={() => setShown({ url, ok: false })}
          />
          {loaded && (
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${natural.width} ${natural.height}`}
              preserveAspectRatio="xMidYMid meet"
              onClick={() => onSelect(null)}
            >
              {items.map(({ item, x, y, w, h, label }) => {
                const color = DEFECT_COLORS[item.defectClass]
                const isSelected = item.id === selectedId
                return (
                  <g
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={ariaLabel(item)}
                    aria-pressed={isSelected}
                    className="group cursor-pointer outline-none"
                    opacity={selectedId && !isSelected ? 0.6 : 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(item.id)
                    }}
                    onKeyDown={(e) => onKey(e, item.id)}
                  >
                    {/* Своя отметка фокуса с клавиатуры: обводку фокуса у элементов SVG рисуют не все браузеры */}
                    <g className="invisible group-focus-visible:visible" pointerEvents="none">
                      <rect
                        x={x - style.selectedStrokeWidth * 2}
                        y={y - style.selectedStrokeWidth * 2}
                        width={w + style.selectedStrokeWidth * 4}
                        height={h + style.selectedStrokeWidth * 4}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth={style.strokeWidth * 2}
                      />
                      <rect
                        x={x - style.selectedStrokeWidth * 2}
                        y={y - style.selectedStrokeWidth * 2}
                        width={w + style.selectedStrokeWidth * 4}
                        height={h + style.selectedStrokeWidth * 4}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={style.strokeWidth}
                        strokeDasharray={`${style.strokeWidth * 3} ${style.strokeWidth * 2}`}
                      />
                    </g>
                    {isSelected && (
                      // Светлая обводка под выбранной рамкой: её видно и на тёмном, и на светлом фоне
                      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#ffffff" strokeWidth={style.selectedStrokeWidth * 2} />
                    )}
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill="transparent"
                      stroke={color}
                      strokeWidth={isSelected ? style.selectedStrokeWidth : style.strokeWidth}
                      // Выбранная рамка лежит сверху: кликается только по контуру, чтобы рамки внутри неё оставались доступны
                      pointerEvents={isSelected ? 'visibleStroke' : 'all'}
                    />
                    <rect x={label.x} y={label.y} width={label.width} height={label.height} fill={color} />
                    <text
                      x={label.textX}
                      y={label.textY}
                      fill="#ffffff"
                      fontSize={style.fontSize}
                      fontWeight={600}
                      dominantBaseline="central"
                      className="select-none"
                    >
                      {label.text}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      )}
    </div>
  )
}

function Overlay({ text }: { text: string }) {
  return <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-300">{text}</p>
}
