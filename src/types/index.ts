export interface ElectronAPI {
  getAppVersion: () => Promise<string>
  platform: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export type DefectType = 'crack' | 'corrosion' | 'delamination' | 'erosion' | 'lightning'

export interface Defect {
  id: string
  type: DefectType
  severity: 'low' | 'medium' | 'high' | 'critical'
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export interface Inspection {
  id: string
  turbineId: string
  date: string
  imageUrl: string
  defects: Defect[]
  status: 'completed' | 'processing' | 'failed'
  notes?: string
}

export interface RoutePoint {
  lat: number
  lng: number
  alt: number
}

export interface DroneRoute {
  id: string
  name: string
  turbineId: string
  points: RoutePoint[]
  status: 'draft' | 'ready' | 'in-progress' | 'completed'
}
