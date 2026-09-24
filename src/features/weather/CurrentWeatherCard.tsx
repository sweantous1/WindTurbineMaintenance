import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import type { Farm, WeatherSnapshot } from '@/domain/types'
import { wmoKey } from '@/lib/wmo'
import WindArrow from './WindArrow'
import {
  compassPoint,
  farmLocalNow,
  formatClock,
  formatDayTime,
  formatNumber,
  formatTimeZone,
  formatUtcOffset,
  snapshotAge,
} from './format'
import { formatCoords } from './location'
import { formatAge } from './reasons'

interface CurrentWeatherCardProps {
  snapshot: WeatherSnapshot
  farm?: Farm
  // Часы экрана (useNow): возраст снимка здесь и в баннере «устарел» считается от одного момента
  now: Date
}

export default function CurrentWeatherCard({ snapshot, farm, now }: CurrentWeatherCardProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const c = snapshot.current
  const loc = snapshot.location

  let place: string
  if (snapshot.source === 'farm') {
    const name = loc.name ?? farm?.name
    place = name ? t('weatherScreen.location.farmCenterNamed', { name }) : t('weatherScreen.location.farmCenter')
  } else {
    place = loc.name ?? t('weatherScreen.location.manualPoint')
  }

  const age = snapshotAge(snapshot.fetchedAt, now)
  const ageText = formatAge(age, t)
  const dir = compassPoint(c.windDirDeg10)
  const farmNow = farmLocalNow(snapshot, now)

  return (
    <Card
      title={t('weatherScreen.current.title')}
      subtitle={t('weatherScreen.current.observedAt', { time: formatDayTime(c.time, lang) })}
      actions={ageText && <span className="text-xs text-gray-500">{t('weatherScreen.current.fetched', { age: ageText })}</span>}
    >
      <div className="@container space-y-4">
        <div className="space-y-1 text-sm">
          <p className="font-medium text-gray-900 first-letter:uppercase">{place}</p>
          <p className="text-gray-600">
            {t('weatherScreen.current.gridNode')} <span className="font-mono">{formatCoords(loc)}</span>
            {snapshot.distanceToFarmM !== undefined && (
              <>
                {' · '}
                {t('weatherScreen.location.distanceToFarm', {
                  km: formatNumber(snapshot.distanceToFarmM / 1000, lang, 1),
                })}
              </>
            )}
          </p>
          <p className="text-gray-600">
            {t('weatherScreen.current.timezone', {
              zone: formatTimeZone(snapshot.timezone, lang),
              offset: formatUtcOffset(snapshot.utcOffsetSeconds),
            })}
            {' · '}
            {t('weatherScreen.current.localNow', { time: formatClock(farmNow) })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-5">
          <Stat label={t('weatherScreen.current.temperature')}>
            {formatNumber(c.temperatureC, lang, 1)}
            <Unit>{t('weatherScreen.units.c')}</Unit>
          </Stat>
          <Stat label={t('weatherScreen.current.wind10')}>
            <span className="inline-flex items-center gap-1.5">
              {formatNumber(c.windMs10, lang, 1)}
              <Unit>{t('weatherScreen.units.ms')}</Unit>
              <WindArrow deg={c.windDirDeg10} className="h-5 w-5 text-gray-700" />
            </span>
            {dir && (
              <span className="block whitespace-normal text-xs font-normal text-gray-500">
                {t('weatherScreen.windFrom', { dir: t(`weatherScreen.compass.${dir}`), deg: Math.round(c.windDirDeg10 ?? 0) })}
              </span>
            )}
          </Stat>
          <Stat label={t('weatherScreen.current.gust10')}>
            {formatNumber(c.gustMs10, lang, 1)}
            <Unit>{t('weatherScreen.units.ms')}</Unit>
          </Stat>
          <Stat label={t('weatherScreen.current.precip')}>
            {formatNumber(c.precipitationMm, lang, 1)}
            <Unit>{t('weatherScreen.units.mm')}</Unit>
          </Stat>
          <Stat label={t('weatherScreen.current.conditions')}>
            <span className="block whitespace-normal text-sm font-medium leading-snug">{t(wmoKey(c.weatherCode))}</span>
          </Stat>
        </div>
      </div>
    </Card>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-1 rounded-lg bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="whitespace-nowrap text-xl font-semibold text-gray-900">{children}</div>
    </div>
  )
}

function Unit({ children }: { children: ReactNode }) {
  return <span className="ml-1 text-sm font-normal text-gray-500">{children}</span>
}
