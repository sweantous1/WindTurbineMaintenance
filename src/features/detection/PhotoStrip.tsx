import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PhotoRecord } from '@/domain/detection'
import { currentTile, parseAnalysisError } from './analysisRunner'
import type { PhotoStatus } from './detectionView'
import type { TurbineRef } from './turbineMatch'
import { usePhotoUrl } from './usePhotoUrl'

export interface StripItem {
  photo: PhotoRecord
  status: PhotoStatus
  // Место фото в идущем анализе
  run?: { kind: 'running'; tile: number; tiles: number } | { kind: 'queued' }
  turbine: TurbineRef
}

interface PhotoStripProps {
  items: readonly StripItem[]
  selectedId: string | undefined
  onSelect: (photoId: string) => void
}

export default function PhotoStrip({ items, selectedId, onSelect }: PhotoStripProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLUListElement>(null)

  // Выбранное фото (в том числе после удаления соседнего) должно быть видно в ленте.
  // Прокручиваем только ленту: scrollIntoView дёрнул бы всю страницу по вертикали
  useEffect(() => {
    const list = listRef.current
    if (!selectedId || !list) return
    const el = Array.from(list.children).find((li) => li instanceof HTMLElement && li.dataset.photoId === selectedId)
    if (!el) return
    const box = list.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.left < box.left) list.scrollLeft -= box.left - r.left + 8
    else if (r.right > box.right) list.scrollLeft += r.right - box.right + 8
  }, [selectedId, items.length])

  return (
    <ul ref={listRef} className="flex gap-3 overflow-x-auto pb-2" aria-label={t('defects.strip.listLabel')}>
      {items.map((item) => (
        <li key={item.photo.id} className="shrink-0" data-photo-id={item.photo.id}>
          <Thumb item={item} selected={item.photo.id === selectedId} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  )
}

function Thumb({ item, selected, onSelect }: { item: StripItem; selected: boolean; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const url = usePhotoUrl(item.photo.id, 'thumb')
  const chip = statusChip(item, t)
  const turbine = turbineText(item.turbine, t)

  return (
    <button
      type="button"
      onClick={() => onSelect(item.photo.id)}
      aria-pressed={selected}
      title={item.photo.fileName}
      className={`block w-40 overflow-hidden rounded-lg border bg-white text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        selected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      <span className="relative block h-24 bg-gray-100">
        {url && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
        <span
          className={`absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${chip.className}`}
          title={chip.title}
        >
          {chip.text}
        </span>
      </span>
      <span className="block px-2 py-1.5">
        <span className="block truncate text-xs font-medium text-gray-900">{item.photo.fileName}</span>
        <span className={`block truncate text-xs ${turbine.muted ? 'text-gray-400' : 'text-gray-600'}`} title={turbine.title}>
          {turbine.text}
        </span>
      </span>
    </button>
  )
}

type T = ReturnType<typeof useTranslation>['t']

function statusChip(item: StripItem, t: T): { text: string; className: string; title?: string } {
  if (item.run?.kind === 'running') {
    return {
      text:
        item.run.tiles > 0
          ? t('defects.status.runningTiles', { tile: currentTile(item.run.tile, item.run.tiles), tiles: item.run.tiles })
          : t('defects.status.running'),
      className: 'bg-blue-600 text-white',
    }
  }
  if (item.run?.kind === 'queued') return { text: t('defects.status.queued'), className: 'bg-blue-50 text-blue-700' }
  const s = item.status
  switch (s.kind) {
    case 'pending':
      return { text: t('defects.status.pending'), className: 'bg-white/90 text-gray-700' }
    case 'failed': {
      const { code, detail } = parseAnalysisError(item.photo.analysis?.error)
      return { text: t('defects.status.failed'), className: 'bg-red-600 text-white', title: [t(`defects.errors.${code}`), detail].filter(Boolean).join(': ') }
    }
    case 'done':
      if (s.found === 0) return { text: t('defects.status.none'), className: 'bg-green-100 text-green-800' }
      return {
        text: t('defects.status.found', { count: s.found }),
        className: s.high ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900',
        title: s.high ? t('defects.status.high') : undefined,
      }
  }
}

function turbineText(ref: TurbineRef, t: T): { text: string; muted: boolean; title?: string } {
  switch (ref.kind) {
    case 'assigned':
      return { text: ref.turbine.name, muted: false }
    case 'missing':
      return { text: t('defects.turbine.missing'), muted: true }
    case 'suggested':
      return {
        text: `${ref.suggestion.turbine.name}? · ${t('defects.turbine.byGps')}`,
        muted: true,
        title: t('defects.turbine.acceptHint', { distance: Math.round(ref.suggestion.distanceM) }),
      }
    case 'none':
      return { text: t('defects.turbine.unassigned'), muted: true }
  }
}
