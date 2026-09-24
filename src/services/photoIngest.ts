import type { PreparedPhoto } from '@/storage/photos'

const THUMB_MAX_SIDE = 320
// Фото с дрона бывают по 20–45 Мп; больше 100 МБ на снимок — почти наверняка не фото
const MAX_PHOTO_BYTES = 100 * 1024 * 1024

export class PhotoIngestError extends Error {
  readonly code: 'notImage' | 'tooLarge' | 'decodeFailed'
  readonly fileName: string
  constructor(code: PhotoIngestError['code'], fileName: string, cause?: unknown) {
    super(`${fileName}: ${code}`, { cause })
    this.name = 'PhotoIngestError'
    this.code = code
    this.fileName = fileName
  }
}

// Размеры, миниатюра и EXIF (время съёмки и GPS) — только в браузере
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new PhotoIngestError('notImage', file.name)
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoIngestError('tooLarge', file.name)

  let bitmap: ImageBitmap
  try {
    // imageOrientation учитывает поворот из EXIF — рамки потом рисуются по тому же изображению
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    throw new PhotoIngestError('decodeFailed', file.name, error)
  }

  try {
    const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoIngestError('decodeFailed', file.name)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const thumb = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
    const exif = await readExif(file)
    return {
      fileName: file.name,
      mimeType: file.type,
      blob: file,
      thumb,
      width: bitmap.width,
      height: bitmap.height,
      ...exif,
    }
  } finally {
    bitmap.close()
  }
}

async function readExif(file: File): Promise<Pick<PreparedPhoto, 'takenAt' | 'gps'>> {
  try {
    // exifr подгружается только при импорте фото
    const exifr = (await import('exifr')).default
    const data = await exifr.parse(file, { gps: true, pick: ['DateTimeOriginal', 'latitude', 'longitude'] })
    if (!data) return {}
    const out: Pick<PreparedPhoto, 'takenAt' | 'gps'> = {}
    if (data.DateTimeOriginal instanceof Date && !Number.isNaN(data.DateTimeOriginal.getTime())) {
      out.takenAt = data.DateTimeOriginal.toISOString()
    }
    if (Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) out.gps = { lat: data.latitude, lon: data.longitude }
    return out
  } catch {
    // Нет EXIF или он битый — фото всё равно годится для анализа
    return {}
  }
}
