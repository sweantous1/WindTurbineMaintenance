import { useTranslation } from 'react-i18next'
import AboutSection from '@/features/settings/AboutSection'
import DroneProfilesSection from '@/features/settings/DroneProfilesSection'

export default function Settings() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('settings.title')}</h1>
        <p className="mt-1 text-gray-500">{t('settings.desc')}</p>
      </div>
      <DroneProfilesSection />
      <AboutSection />
    </div>
  )
}
