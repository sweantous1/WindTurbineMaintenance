import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'

// Раньше здесь хранились фото в base64 — одно фото с дрона переполняло localStorage.
// Освобождаем место; фото сохраняются в IndexedDB на следующем этапе.
try {
  localStorage.removeItem('wtm_detection_data')
} catch (error) {
  console.warn('Не удалось очистить старые данные детекции:', error)
}

// Фото живут в памяти окна: переживают переход между экранами, но не перезагрузку
let sessionImages: string[] = []

export default function Detection() {
  const { t } = useTranslation()
  const [images, setImages] = useState<string[]>(sessionImages)

  useEffect(() => {
    sessionImages = images
  }, [images])

  const readFiles = useCallback((files: FileList) => {
    const validFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (validFiles.length === 0) {
      toast.error(t('detection.onlyImages'))
      return
    }
    // URL создаём вне функции-обновлятора: в StrictMode React вызывает её дважды, и лишний URL утекал бы
    const urls = validFiles.map((file) => URL.createObjectURL(file))
    setImages((prev) => [...prev, ...urls])
  }, [t])

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) readFiles(e.target.files)
    e.target.value = ''
  }, [readFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files) readFiles(e.dataTransfer.files)
  }, [readFiles])

  const handleRemoveImage = (index: number) => {
    URL.revokeObjectURL(images[index])
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleRemoveAll = () => {
    images.forEach((src) => URL.revokeObjectURL(src))
    setImages([])
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('detection.title')}</h1>
        <p className="text-gray-500 mt-1">{t('detection.uploadDesc')}</p>
      </div>

      <Card title={t('detection.upload')} actions={images.length > 0 ? (
        <>
          {/* Модели пока нет: кнопка не делает вид, что анализирует */}
          <Button size="sm" disabled title={t('detection.modelMissingHint')}>
            {t('detection.modelMissing')}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleRemoveAll}>
            {t('common.clear')}
          </Button>
        </>
      ) : undefined}>
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
          onClick={() => document.getElementById('fileInput')?.click()}
        >
          {images.length === 0 ? (
            <>
              <div className="text-5xl mb-3">+</div>
              <p className="text-gray-600 font-medium">{t('detection.uploadHint')}</p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 justify-center">
                {images.map((src, i) => (
                  <div key={src} className="relative group w-32 h-32">
                    <img
                      src={src}
                      alt=""
                      className="w-full h-full object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveImage(i) }}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 flex items-center justify-center"
                      aria-label={t('common.delete')}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-sm text-blue-600 mt-3">
                + {t('detection.upload')}
              </p>
            </>
          )}
          <input
            id="fileInput"
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      </Card>

      <Card title={t('detection.results')}>
        <div className="text-center py-12 text-gray-400">
          <div className="text-5xl mb-3">~</div>
          <p className="text-sm">{t('detection.modelMissingHint')}</p>
        </div>
      </Card>
    </div>
  )
}
