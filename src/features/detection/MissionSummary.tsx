import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import { APP_DEFECT_CLASSES, DEFECT_COLORS } from '@/domain/detection'
import { SEVERITIES, isHighSeverity, type DefectSummary } from './detectionView'
import { formatConfidence } from './format'

interface MissionSummaryProps {
  summary: DefectSummary
  threshold: number
}

export default function MissionSummary({ summary, threshold }: MissionSummaryProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const classes = APP_DEFECT_CLASSES.filter((c) => summary.byClass[c] > 0)
  const maxSeverityCount = Math.max(1, ...SEVERITIES.map((s) => summary.bySeverity[s]))

  return (
    <Card title={t('defects.summary.title')} subtitle={t('defects.summary.threshold', { value: formatConfidence(threshold, lang) })}>
      <div className="space-y-5">
        <dl className="divide-y divide-gray-100 text-sm">
          <Stat label={t('defects.summary.total')} value={String(summary.total)} strong />
          <Stat label={t('defects.summary.high')} value={String(summary.high)} tone={summary.high > 0 ? 'danger' : undefined} />
          <Stat label={t('defects.summary.reviewed')} value={t('defects.summary.of', { value: summary.reviewed, total: summary.total })} />
          <Stat
            label={t('defects.summary.photos')}
            value={t('defects.summary.of', { value: summary.photos.analyzed, total: summary.photos.total })}
          />
          <Stat label={t('defects.summary.photosWithFindings')} value={String(summary.photos.withFindings)} />
          {summary.photos.failed > 0 && <Stat label={t('defects.summary.photosFailed')} value={String(summary.photos.failed)} tone="danger" />}
        </dl>

        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('defects.summary.byClass')}</h4>
          {classes.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">{t('defects.summary.empty')}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {classes.map((c) => (
                <li key={c} className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: DEFECT_COLORS[c] }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-gray-700">{t(`defects.classes.${c}`)}</span>
                  <span className="tabular-nums font-medium text-gray-900">{summary.byClass[c]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('defects.summary.bySeverity')}</h4>
          <ul className="mt-2 space-y-1.5">
            {[...SEVERITIES].reverse().map((s) => {
              const count = summary.bySeverity[s]
              const high = isHighSeverity(s)
              return (
                <li key={s} className="grid grid-cols-[minmax(0,1fr)_3rem_1.75rem] items-center gap-2 text-sm">
                  <span className={`truncate ${high ? 'font-medium text-red-700' : 'text-gray-700'}`} title={t(`defects.severity.${s}`)}>
                    {t(`defects.severity.${s}`)}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    <span
                      className={`block h-full rounded-full ${high ? 'bg-red-500' : 'bg-gray-400'}`}
                      style={{ width: `${(count / maxSeverityCount) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums font-medium text-gray-900">{count}</span>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </Card>
  )
}

function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: 'danger'; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={tone === 'danger' ? 'text-red-700' : 'text-gray-600'}>{label}</dt>
      <dd
        className={`whitespace-nowrap tabular-nums ${strong ? 'text-lg' : ''} font-semibold ${tone === 'danger' ? 'text-red-700' : 'text-gray-900'}`}
      >
        {value}
      </dd>
    </div>
  )
}
