import { useEffect, useState, type RefObject } from 'react'
import { photos } from '@/storage/photos'

// Ссылка на изображение или миниатюру из базы. undefined — ещё читается, null — изображения нет.
// Ссылка освобождается при смене фото и при размонтировании: снимки по десятку мегабайт
export function usePhotoUrl(photoId: string | undefined, kind: 'blob' | 'thumb'): string | null | undefined {
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null)
  const key = photoId ? `${photoId}|${kind}` : ''

  useEffect(() => {
    if (!photoId) return
    let alive = true
    let url: string | undefined
    photos
      .getBlob(photoId)
      .then((rec) => {
        if (!alive) return
        const blob = rec ? (kind === 'blob' ? rec.blob : rec.thumb) : undefined
        url = blob ? URL.createObjectURL(blob) : undefined
        setState({ key: `${photoId}|${kind}`, url: url ?? null })
      })
      .catch((error: unknown) => {
        console.warn(`Не удалось прочитать изображение ${photoId}:`, error)
        if (alive) setState({ key: `${photoId}|${kind}`, url: null })
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [photoId, kind])

  if (!photoId) return null
  return state?.key === key ? state.url : undefined
}

// Размер элемента в CSS-пикселях; следит за изменением окна и раскладки
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setSize((prev) => (prev && prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }))
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return size
}
