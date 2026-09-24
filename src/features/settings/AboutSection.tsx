import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/components/common/Button'
import Card from '@/components/common/Card'
import { formatBytes, formatNumber } from '@/features/weather/format'

type VersionState = { kind: 'loading' } | { kind: 'web' } | { kind: 'ok'; version: string } | { kind: 'error' }
type StorageState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ok'; usage: number; quota: number }
  | { kind: 'error'; message: string }

async function readStorage(): Promise<StorageState> {
  // storage.estimate есть только в защищённом контексте: в веб-версии по http из сети его нет
  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return { kind: 'unavailable' }
  try {
    const e = await navigator.storage.estimate()
    if (e.usage === undefined) return { kind: 'unavailable' }
    return { kind: 'ok', usage: e.usage, quota: e.quota ?? 0 }
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

export default function AboutSection() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  // В браузере моста Electron нет: это веб-версия, а не ошибка
  const [version, setVersion] = useState<VersionState>(() => (window.electronAPI ? { kind: 'loading' } : { kind: 'web' }))
  const [storage, setStorage] = useState<StorageState>({ kind: 'loading' })

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    let cancelled = false
    api
      .getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion({ kind: 'ok', version: v })
      })
      .catch(() => {
        if (!cancelled) setVersion({ kind: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void readStorage().then((s) => {
      if (!cancelled) setStorage(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshStorage = () => {
    setStorage({ kind: 'loading' })
    void readStorage().then(setStorage)
  }

  let versionText: string
  if (version.kind === 'loading') versionText = t('common.loading')
  else if (version.kind === 'web') versionText = t('settings.about.webVersion')
  else if (version.kind === 'ok') versionText = version.version
  else versionText = t('settings.about.versionFailed')

  const bytes = (n: number) => {
    const b = formatBytes(n, lang)
    return `${b.value} ${t(`settings.about.units.${b.unit}`)}`
  }
  let storageText: string
  if (storage.kind === 'loading') storageText = t('common.loading')
  else if (storage.kind === 'unavailable') storageText = t('settings.about.storageUnavailable')
  else if (storage.kind === 'error') storageText = t('settings.about.storageFailed', { message: storage.message })
  else if (storage.quota > 0) {
    const pct = (storage.usage / storage.quota) * 100
    // Доли меньше десятой процента округлились бы до «0%», будто база пуста
    storageText = t(pct < 0.1 ? 'settings.about.storageUsageTiny' : 'settings.about.storageUsage', {
      usage: bytes(storage.usage),
      quota: bytes(storage.quota),
      pct: formatNumber(pct, lang, 1),
      min: formatNumber(0.1, lang, 1),
    })
  } else storageText = bytes(storage.usage)

  return (
    <Card title={t('settings.about.title')}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-gray-500">{t('settings.about.app')}</dt>
        <dd className="text-gray-900">{t('app.title')}</dd>
        <dt className="text-gray-500">{t('settings.about.version')}</dt>
        <dd className="text-gray-900 tabular-nums">{versionText}</dd>
        <dt className="self-center text-gray-500">{t('settings.about.storage')}</dt>
        <dd className="flex flex-wrap items-center gap-3 text-gray-900">
          <span>{storageText}</span>
          <Button size="sm" variant="ghost" onClick={refreshStorage} disabled={storage.kind === 'loading'}>
            {t('settings.about.refresh')}
          </Button>
        </dd>
        <dt className="text-gray-500">{t('settings.about.dataTitle')}</dt>
        <dd className="text-gray-700">{t('settings.about.dataText')}</dd>
        <dt className="text-gray-500">{t('settings.about.weatherSource')}</dt>
        <dd className="text-gray-700">
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
            Open-Meteo
          </a>{' '}
          {t('settings.about.weatherLicense')}
        </dd>
        {/* Лицензии карты, модели дрона и весов детекции требуют указывать источник */}
        <dt className="text-gray-500">{t('settings.about.mapSource')}</dt>
        <dd className="text-gray-700">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
            © OpenStreetMap
          </a>{' '}
          {t('settings.about.mapLicense')}
        </dd>
        <dt className="text-gray-500">{t('settings.about.droneModel')}</dt>
        <dd className="text-gray-700">
          <a
            href="https://sketchfab.com/3d-models/drone-19d310dec81c446fba1a797903e083eb"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:text-blue-700"
          >
            {t('settings.about.droneModelText')}
          </a>
        </dd>
        <dt className="text-gray-500">{t('settings.about.defectModel')}</dt>
        <dd className="text-gray-700">
          {t('settings.about.defectModelText')}
          <span className="mt-0.5 block text-xs text-gray-500">{t('settings.about.moreCredits')}</span>
        </dd>
      </dl>
    </Card>
  )
}
