import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './en.json'
import ru from './ru.json'

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
})

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    // Системный 'ru-RU' сводится к 'ru', иначе переключатель языка срабатывает не с первого раза
    supportedLngs: ['ru', 'en'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: 'ru',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
