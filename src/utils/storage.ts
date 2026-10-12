// localStorage бывает недоступен (приватный режим) или переполнен, экран из-за этого падать не должен
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
