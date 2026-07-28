import { apiFetch } from './api'
import type { Inspection } from '@/types'

export async function fetchInspections(params?: Record<string, string>): Promise<Inspection[]> {
  const query = params ? '?' + new URLSearchParams(params).toString() : ''
  return apiFetch<Inspection[]>(`/inspections${query}`)
}

export async function deleteInspection(id: string): Promise<void> {
  return apiFetch(`/inspections/${id}`, { method: 'DELETE' })
}

export function getMockInspections(): Inspection[] {
  return [
    { id: '1', turbineId: 'WT-001', date: '2026-07-15', imageUrl: '', defects: [], status: 'completed' },
    { id: '2', turbineId: 'WT-002', date: '2026-07-14', imageUrl: '', defects: [], status: 'completed' },
    { id: '3', turbineId: 'WT-003', date: '2026-07-13', imageUrl: '', defects: [], status: 'processing' },
    { id: '4', turbineId: 'WT-004', date: '2026-07-12', imageUrl: '', defects: [], status: 'completed' },
    { id: '5', turbineId: 'WT-001', date: '2026-07-10', imageUrl: '', defects: [], status: 'failed' },
  ]
}
