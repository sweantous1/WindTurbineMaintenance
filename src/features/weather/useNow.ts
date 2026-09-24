import { useEffect, useState } from 'react'

// Текущее время, обновляемое по таймеру: возраст прогноза, «сейчас на ферме» и прошедшие часы
// не должны застывать, пока экран открыт. Одни часы на экран — чтобы подписи не расходились
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
