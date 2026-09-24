import { DEFECT_COLORS, type Detection } from '@/domain/detection'
import { exportSize, exportUnitsPerPx, layoutOverlay, overlayStyle, type Size } from './overlayGeometry'

// Снимок с нарисованными рамками — тем же расположением, что и на экране (геометрия в overlayGeometry)
export async function renderDetectionsPng(
  image: Blob,
  natural: Size,
  detections: readonly Detection[],
  labelText: (d: Detection) => string,
): Promise<Blob> {
  const size = exportSize(natural)
  // Декодируем сразу в размер выгрузки: полный кадр 45 Мп занял бы в памяти ещё ~180 МБ
  const bitmap = await createImageBitmap(image, {
    imageOrientation: 'from-image',
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: 'high',
  })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D недоступен')
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)

    const style = overlayStyle(exportUnitsPerPx(size))
    ctx.font = `600 ${style.fontSize}px system-ui, -apple-system, 'Segoe UI', sans-serif`
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'miter'
    for (const it of layoutOverlay(detections, size, style, labelText)) {
      const color = DEFECT_COLORS[it.item.defectClass]
      ctx.strokeStyle = color
      ctx.lineWidth = style.strokeWidth
      ctx.strokeRect(it.x, it.y, it.w, it.h)
      ctx.fillStyle = color
      ctx.fillRect(it.label.x, it.label.y, it.label.width, it.label.height)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(it.label.text, it.label.textX, it.label.textY)
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось закодировать PNG'))), 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Сразу после click() скачивание ещё не началось — освобождаем ссылку позже
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
