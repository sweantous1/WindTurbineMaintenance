import { useTranslation } from 'react-i18next'

// Шаги — в порядке работы с миссией, как на главной и в меню. Описание — только того,
// что приложение действительно делает
const STEPS = ['mission', 'farm', 'route', 'weather', 'forecast', 'simulation', 'complete', 'detection', 'history'] as const

export default function Docs() {
  const { t } = useTranslation()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('docs.title')}</h1>
        <p className="mt-1 text-gray-500">{t('docs.intro')}</p>
      </div>

      <section aria-labelledby="docs-flow" className="space-y-3">
        <h2 id="docs-flow" className="text-lg font-semibold text-gray-900">
          {t('docs.flowTitle')}
        </h2>
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {STEPS.map((key, i) => (
            <li key={key} className="flex gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900">{t(`docs.steps.${key}.title`)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">{t(`docs.steps.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
