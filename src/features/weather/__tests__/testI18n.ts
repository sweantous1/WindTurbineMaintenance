import i18next, { type TFunction } from 'i18next'
import weatherRu from '@/i18n/features/weatherScreen.ru.json'
import weatherEn from '@/i18n/features/weatherScreen.en.json'
import settingsRu from '@/i18n/features/settings.ru.json'
import settingsEn from '@/i18n/features/settings.en.json'
import wmoRu from '@/i18n/features/wmo.ru.json'
import wmoEn from '@/i18n/features/wmo.en.json'

export type Dict = { [key: string]: string | Dict }

export const dictionaries: Record<'ru' | 'en', Dict[]> = {
  ru: [weatherRu, settingsRu, wmoRu],
  en: [weatherEn, settingsEn, wmoEn],
}

const merge = (parts: Dict[]): Dict => Object.assign({}, ...parts)

// Отдельный экземпляр i18next с настоящими словарями экрана: как в src/i18n/index.ts,
// но без детектора языка и без общих словарей приложения
export async function makeT(lng: 'ru' | 'en'): Promise<TFunction> {
  const inst = i18next.createInstance()
  await inst.init({
    lng,
    fallbackLng: false,
    resources: { ru: { translation: merge(dictionaries.ru) }, en: { translation: merge(dictionaries.en) } },
    interpolation: { escapeValue: false },
  })
  return inst.getFixedT(lng)
}

// Плоский список ключей: 'weatherScreen.units.ms'
export function flatKeys(d: Dict, prefix = ''): string[] {
  return Object.entries(d).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : flatKeys(v, `${prefix}${k}.`)))
}
