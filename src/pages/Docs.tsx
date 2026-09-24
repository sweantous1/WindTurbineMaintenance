import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'

const sections = [
  { titleKey: 'docs.router', bodyKey: 'docs.routerBody' },
  { titleKey: 'docs.detection', bodyKey: 'docs.detectionBody' },
  { titleKey: 'docs.weather', bodyKey: 'docs.weatherBody' },
  { titleKey: 'docs.history', bodyKey: 'docs.historyBody' },
]

export default function Docs() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('docs.title')}</h1>
        <p className="text-gray-500 mt-1">{t('docs.intro')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((section) => (
          <Card key={section.titleKey} title={t(section.titleKey)}>
            <p className="text-sm text-gray-600 leading-relaxed">{t(section.bodyKey)}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}
