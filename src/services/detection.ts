import { v4 as uuidv4 } from 'uuid'
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
    {
      id: uuidv4(),
      type: 'crack',
      severity: 'high',
      x: 0.15 + Math.random() * 0.3,
      y: 0.15 + Math.random() * 0.3,
      width: 0.1,
      height: 0.05,
      confidence: 0.88 + Math.random() * 0.1,
    },
    {
      id: uuidv4(),
      type: 'corrosion',
      severity: 'medium',
      x: 0.4 + Math.random() * 0.3,
      y: 0.5 + Math.random() * 0.3,
      width: 0.08,
      height: 0.08,
      confidence: 0.78 + Math.random() * 0.12,
    },
    {
      id: uuidv4(),
      type: 'erosion',
      severity: 'low',
      x: 0.6 + Math.random() * 0.3,
      y: 0.1 + Math.random() * 0.3,
      width: 0.12,
      height: 0.06,
      confidence: 0.7 + Math.random() * 0.15,
    },
  ]
}
