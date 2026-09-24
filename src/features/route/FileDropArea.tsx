import { useState, type DragEvent, type ReactNode } from 'react'

interface FileDropAreaProps {
  enabled: boolean
  onFiles: (files: FileList) => void
  // Подпись поверх области, пока над ней держат файл
  overlayText: string
  children: ReactNode
  className?: string
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

// Своя зона сброса файла: Layout отменяет drop на document (иначе Electron открыл бы файл
// вместо приложения), поэтому здесь preventDefault обязателен и в dragover, и в drop
export default function FileDropArea({ enabled, onFiles, overlayText, children, className = '' }: FileDropAreaProps) {
  // Счётчик, а не флаг: dragenter/dragleave приходят и от вложенных элементов
  const [depth, setDepth] = useState(0)
  const active = enabled && depth > 0

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={(e) => {
        if (!enabled || !hasFiles(e)) return
        e.preventDefault()
        setDepth((d) => d + 1)
      }}
      onDragOver={(e) => {
        if (!enabled || !hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!enabled || !hasFiles(e)) return
        setDepth((d) => Math.max(0, d - 1))
      }}
      onDrop={(e) => {
        if (!enabled || !hasFiles(e)) return
        e.preventDefault()
        setDepth(0)
        if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files)
      }}
    >
      {children}
      {active && (
        // Выше панелей Leaflet (до 1000), но ниже шапки и модальных окон
        <div className="absolute inset-0 z-[1100] rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/85 flex items-center justify-center pointer-events-none">
          <p className="text-sm font-medium text-blue-700 px-4 text-center">{overlayText}</p>
        </div>
      )}
    </div>
  )
}
