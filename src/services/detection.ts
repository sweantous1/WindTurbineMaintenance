import { apiFetch, apiUpload } from './api'
import type { Defect } from '@/types'

export async function analyzeImage(file: File): Promise<Defect[]> {
  const formData = new FormData()
  formData.append('image', file)
  const res = await apiUpload('/detect', formData)
  return res.json()
}

export function getMockDefects(): Defect[] {
  return [
    { id: '1', type: 'crack', severity: 'high', x: 0.2, y: 0.3, width: 0.1, height: 0.05, confidence: 0.92 },
    { id: '2', type: 'corrosion', severity: 'medium', x: 0.5, y: 0.6, width: 0.08, height: 0.08, confidence: 0.87 },
    { id: '3', type: 'erosion', severity: 'low', x: 0.7, y: 0.2, width: 0.12, height: 0.06, confidence: 0.76 },
  ]
}
