import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import { getMockWeather, type WeatherData } from '@/services/weather'

type WeatherCard = {
  key: keyof WeatherData
  unit?: string
}

const cards: WeatherCard[] = [
  { key: 'temperature', unit: '°C' },
  { key: 'windSpeed', unit: 'm/s' },
  { key: 'humidity', unit: '%' },
  { key: 'visibility', unit: 'km' },
  { key: 'conditions' },
]

export default function Weather() {
  const { t } = useTranslation()
  const [weather, setWeather] = useState<WeatherData | null>(null)

  useEffect(() => {
    setWeather(getMockWeather())
  }, [])

  const displayUnit = (unit?: string) => `— ${unit || ''}`.trim()

  const formatValue = (card: WeatherCard) => {
    const val = weather?.[card.key]
    if (val === null || val === undefined) return card.unit ? displayUnit(card.unit) : '—'
    return card.unit ? `${val} ${card.unit}` : val
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('weather.title')}</h1>
        <p className="text-gray-500 mt-1">{t('weather.desc')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <Card key={card.key}>
            <div className="text-center py-4">
              <p className="text-2xl font-bold text-gray-900">{weather ? formatValue(card) : '...'}</p>
              <p className="text-sm text-gray-500 mt-1">{t(`weather.${card.key}`)}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
