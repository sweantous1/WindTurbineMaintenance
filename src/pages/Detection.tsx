import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import AnalysisResult from '@/components/detection/AnalysisResult'
import type { Defect } from '@/types'
import { getMockDefects } from '@/services/detection'

const STORAGE_KEY = 'wtm_detection_data'

const loadSaved = (): { images: string[]; results: Record<string, Defect[]> } => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return { images: parsed.images || [], results: parsed.results || {} }
    }
  } catch {}
  return { images: [], results: {} }
}

export default function Detection() {
  const { t } = useTranslation()
  const [images, setImages] = useState<string[]>(() => loadSaved().images)
  const [results, setResults] = useState<Record<string, Defect[]>>(() => loadSaved().results)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ images, results }))
  }, [images, results])

  const readFiles = (files: FileList) => {
    const validFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (validFiles.length === 0) {
      toast.error('Please upload image files')
      return
    }

    const readers = validFiles.map((file) => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target?.result as string)
        reader.readAsDataURL(file)
      })
    })

    Promise.all(readers).then((urls) => {
      setImages((prev) => [...prev, ...urls])
    })
  }

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) readFiles(e.target.files)
    e.target.value = ''
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files) readFiles(e.dataTransfer.files)
  }, [])

  const handleAnalyze = async () => {
    if (images.length === 0) return
    const unanalyzed = images.filter((img) => !results[img])
    if (unanalyzed.length === 0) return
    setIsAnalyzing(true)

    await new Promise((r) => setTimeout(r, 2000))

    const newResults: Record<string, Defect[]> = { ...results }
    unanalyzed.forEach((img) => {
      newResults[img] = getMockDefects()
    })

    setResults(newResults)
    setIsAnalyzing(false)
    toast.success('Analysis complete')
  }

  const handleRemoveImage = (index: number) => {
    const removed = images[index]
    setImages((prev) => prev.filter((_, i) => i !== index))
    setResults((prev) => {
      const next = { ...prev }
      delete next[removed]
      return next
    })
  }

  const handleRemoveAll = () => {
    setImages([])
    setResults({})
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('detection.title')}</h1>
        <p className="text-gray-500 mt-1">{t('detection.uploadDesc')}</p>
      </div>

      <Card title={t('detection.upload')} actions={images.length > 0 ? (
        <>
          <Button size="sm" onClick={handleAnalyze} isLoading={isAnalyzing}>
            {isAnalyzing ? t('detection.analyzing') : t('detection.analyze')}
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
                  <div key={i} className="relative group w-32 h-32">
                    <img
                      src={src}
                      alt=""
                      className="w-full h-full object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveImage(i) }}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 flex items-center justify-center"
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
        {Object.keys(results).length > 0 ? (
          <div className="space-y-6">
            {images.map((img, i) => {
              const defects = results[img]
              if (!defects) return null
              return (
                <div key={i} className="flex gap-4 items-start p-4 bg-gray-50 rounded-lg">
                  <img
                    src={img}
                    alt=""
                    className="w-48 h-48 object-cover rounded-lg border border-gray-200 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 mb-3">
                      {t('detection.found')} {defects.length} {defects.length > 1 ? t('detection.defects') : t('detection.defect')}
                    </p>
                    <AnalysisResult defects={defects} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <div className="text-5xl mb-3">~</div>
            <p className="text-sm">{t('detection.resultsHint')}</p>
          </div>
        )}
      </Card>
    </div>
  )
}
