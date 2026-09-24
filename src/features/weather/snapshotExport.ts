import type { Mission, WeatherSnapshot } from '@/domain/types'

export const SNAPSHOT_EXPORT_KIND = 'wtm-weather-snapshot'

export interface SnapshotExport {
  kind: typeof SNAPSHOT_EXPORT_KIND
  version: 1
  exportedAt: string
  mission: { id: string; name: string }
  departureTime?: string
  snapshot: WeatherSnapshot
}

// Снимок как есть плюс, к какой миссии и часу вылета он относится: без этого файл
// через месяц ни с чем не сопоставить
export function buildSnapshotExport(
  m: Pick<Mission, 'id' | 'name' | 'departureTime'>,
  snapshot: WeatherSnapshot,
  now: Date = new Date(),
): SnapshotExport {
  return {
    kind: SNAPSHOT_EXPORT_KIND,
    version: 1,
    exportedAt: now.toISOString(),
    mission: { id: m.id, name: m.name },
    ...(m.departureTime ? { departureTime: m.departureTime } : {}),
    snapshot,
  }
}

// Запрещённые в Windows символы и пробелы — в подчёркивания; имя миссии бывает любым
export function snapshotFileName(missionName: string, fetchedAt: string): string {
  const printable = Array.from(missionName, (ch) => (ch.charCodeAt(0) < 32 ? '_' : ch)).join('')
  const name =
    printable
      .replace(/[\\/:*?"<>|\s]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._]+|[._]+$/g, '')
      .slice(0, 60) || 'mission'
  const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fetchedAt) ? fetchedAt.slice(0, 16).replace(':', '-') : 'snapshot'
  return `weather_${name}_${stamp}.json`
}

export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Сразу отзывать нельзя: загрузка стартует асинхронно, а в Electron сперва открывается
  // окно сохранения. Запас как у экспорта маршрута
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
