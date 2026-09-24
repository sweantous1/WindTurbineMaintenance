// localStorage может быть недоступен (приватный режим, запрет сайта) или переполнен —
// для мелких настроек интерфейса такая ошибка не должна ронять экран
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    console.warn(`Не удалось сохранить ${key}:`, error)
  }
}
