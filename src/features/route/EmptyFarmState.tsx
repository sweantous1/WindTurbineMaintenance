import { useTranslation } from 'react-i18next'
import Button from '@/components/common/Button'
import FileDropArea from './FileDropArea'

const GOOGLE_EARTH_URL = 'https://earth.google.com/web/'

interface EmptyFarmStateProps {
  editable: boolean
  reading: boolean
  onPickFile: () => void
  onFiles: (files: FileList) => void
}

// Ферма ещё не задана: импорт файла или турбины кликом по карте
export default function EmptyFarmState({ editable, reading, onPickFile, onFiles }: EmptyFarmStateProps) {
  const { t } = useTranslation()

  if (!editable) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-8 text-center text-sm text-gray-500">
        {t('routePlan.empty.readOnly')}
      </div>
    )
  }

  return (
    <FileDropArea enabled={!reading} onFiles={onFiles} overlayText={t('routePlan.empty.dropHere')}>
      <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 px-6 py-8 text-center">
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900">{t('routePlan.empty.title')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('routePlan.empty.drop')}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={onPickFile} isLoading={reading}>
            {reading ? t('routePlan.empty.reading') : t('routePlan.actions.import')}
          </Button>
          {/* В Electron target=_blank откроется в системном браузере */}
          <a
            href={GOOGLE_EARTH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {t('routePlan.empty.googleEarth')}
          </a>
        </div>
        <p className="text-sm text-gray-500 mt-4">{t('routePlan.empty.clickHint')}</p>
      </div>
    </FileDropArea>
  )
}
