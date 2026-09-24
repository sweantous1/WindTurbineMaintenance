import type { TFunction } from 'i18next'
import { OpenMeteoError } from '@/services/openMeteo'

// Отмена запроса (ушли с экрана, запросили заново) — не ошибка, показывать её не нужно
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

// Текст ошибки на текущем языке. У OpenMeteoError переводим по ключу заново, а не берём
// message: он зафиксирован на языке, который был при создании ошибки.
// MissionLockedError узнаём по имени, чтобы не тянуть сюда базу данных
export function weatherErrorMessage(e: unknown, t: TFunction): string {
  if (e instanceof OpenMeteoError) return t(e.i18nKey, e.params)
  if (e instanceof Error && e.name === 'MissionLockedError') return t('weatherScreen.errors.locked')
  const message = e instanceof Error ? e.message : String(e)
  return t('weatherScreen.errors.unknown', { message })
}
