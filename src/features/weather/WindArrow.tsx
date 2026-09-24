import { useTranslation } from 'react-i18next'
import { compassPoint } from './format'

interface WindArrowProps {
  // Откуда дует ветер, градусы (метеорологическое направление)
  deg: number | null
  className?: string
}

// Стрелка показывает, куда дует ветер: при северном ветре (0°) она смотрит вниз, на юг
export default function WindArrow({ deg, className = 'h-4 w-4' }: WindArrowProps) {
  const { t } = useTranslation()
  const point = compassPoint(deg)
  if (deg == null || point === null) return null
  const label = t('weatherScreen.windFrom', { dir: t(`weatherScreen.compass.${point}`), deg: Math.round(deg) })
  return (
    <svg viewBox="0 0 24 24" className={`inline-block shrink-0 ${className}`} role="img" aria-label={label}>
      <title>{label}</title>
      <g transform={`rotate(${deg + 180} 12 12)`}>
        <path d="M12 3 L18 13 L13.5 13 L13.5 21 L10.5 21 L10.5 13 L6 13 Z" fill="currentColor" />
      </g>
    </svg>
  )
}
