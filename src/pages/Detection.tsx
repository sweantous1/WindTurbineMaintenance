import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Card from '@/components/common/Card'
import Button from '@/components/common/Button'
import ImagePreview from '@/components/detection/ImagePreview'
import AnalysisResult from '@/components/detection/AnalysisResult'
import type { Defect } from '@/types'
import { getMockDefects } from '@/services/detection'

export default function Detection() {
  const { t } = useTranslation()
  const [image, setImage] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [defects, setDefects] = useState<Defect[] | null>(null)

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file')
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      setImage(ev.target?.result as string)
      setDefects(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      setImage(ev.target?.result as string)
      setDefects(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleAnalyze = async () => {
    if (!image) return
    setIsAnalyzing(true)

    await new Promise((r) => setTimeout(r, 2000))

    const mockDefects = getMockDefects()
    setDefects(mockDefects)
    setIsAnalyzing(false)
    toast.success('Analysis complete')
  }

  const handleRemoveImage = () => {
    setImage(null)
    setDefects(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('detection.title')}</h1>
        <p className="text-gray-500 mt-1">Upload a turbine blade photo for defect analysis</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title={t('detection.upload')}>
          {!image ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors cursor-pointer"
              onClick={() => document.getElementById('fileInput')?.click()}
            >
              <div className="text-5xl mb-3">+</div>
              <p className="text-gray-600 font-medium">{t('detection.uploadHint')}</p>
              <input
                id="fileInput"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <ImagePreview src={image} onRemove={handleRemoveImage} />
              <Button
                onClick={handleAnalyze}
                isLoading={isAnalyzing}
                className="w-full"
                size="lg"
              >
                {isAnalyzing ? t('detection.analyzing') : t('detection.analyze')}
              </Button>
            </div>
          )}
        </Card>

        <Card title={t('detection.results')}>
          {defects ? (
            <AnalysisResult defects={defects} />
          ) : (
            <div className="text-center py-12 text-gray-400">
              <div className="text-5xl mb-3">~</div>
              <p className="text-sm">Upload an image and click Analyze to see results</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
