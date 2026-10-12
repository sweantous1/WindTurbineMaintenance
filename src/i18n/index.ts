import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './en.json'
import ru from './ru.json'

type Dict = { [key: string]: string | Dict }

// Переводы функций лежат в features/<функция>.<язык>.json и сливаются с общими словарями,
// чтобы экраны не правили один файл
const featureFiles = import.meta.glob<{ default: Dict }>('./features/*.json', { eager: true })

function deepMerge(target: Dict, source: Dict): Dict {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key]
    if (typeof value === 'object' && typeof existing === 'object') deepMerge(existing, value)
    else target[key] = value
  }
  return target
}

function withFeatures(base: Dict, lang: 'ru' | 'en'): Dict {
  const merged = structuredClone(base)
  for (const [path, mod] of Object.entries(featureFiles)) {
    if (path.endsWith(`.${lang}.json`)) deepMerge(merged, mod.default)
  }
  return merged
}

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
})

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: withFeatures(en as Dict, 'en') },
      ru: { translation: withFeatures(ru as Dict, 'ru') },
    },
    // 'ru-RU' -> 'ru', иначе переключатель языка срабатывает не с первого раза
    supportedLngs: ['ru', 'en'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: 'ru',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
