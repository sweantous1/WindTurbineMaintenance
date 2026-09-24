import { describe, expect, it } from 'vitest'
import forecast from '@/domain/__tests__/fixtures/openMeteo-48.215_40.284-24h.json'
import { normalizeForecast } from '@/domain/weather'
import { buildSnapshotExport, SNAPSHOT_EXPORT_KIND, snapshotFileName } from '../snapshotExport'

const snapshot = normalizeForecast(forecast, { source: 'farm', fetchedAt: '2026-09-24T16:20:00.000Z' })

describe('экспорт снимка', () => {
  it('снимок без изменений плюс миссия и час вылета', () => {
    const now = new Date('2026-09-25T08:00:00.000Z')
    const data = buildSnapshotExport({ id: 'm1', name: 'Облёт', departureTime: '2026-09-25T10:00' }, snapshot, now)
    expect(data).toEqual({
      kind: SNAPSHOT_EXPORT_KIND,
      version: 1,
      exportedAt: '2026-09-25T08:00:00.000Z',
      mission: { id: 'm1', name: 'Облёт' },
      departureTime: '2026-09-25T10:00',
      snapshot,
    })
    // После JSON снимок возвращается тем же: в нём нет Infinity и функций
    expect(JSON.parse(JSON.stringify(data)).snapshot).toEqual(snapshot)
  })

  it('без часа вылета поле не пишется', () => {
    expect(buildSnapshotExport({ id: 'm1', name: 'x' }, snapshot)).not.toHaveProperty('departureTime')
  })

  it('имя файла без запрещённых в Windows символов', () => {
    expect(snapshotFileName('Облёт: ряд 1/2 "север"?', '2026-09-24T16:20:00.000Z')).toBe(
      'weather_Облёт_ряд_1_2_север_2026-09-24T16-20.json',
    )
    expect(snapshotFileName('  ', 'не дата')).toBe('weather_mission_snapshot.json')
    expect(snapshotFileName('a\u0001b', '2026-09-24T16:20:00Z')).toBe('weather_a_b_2026-09-24T16-20.json')
    expect(snapshotFileName('x'.repeat(200), '2026-09-24T16:20:00Z').length).toBeLessThan(100)
  })
})
