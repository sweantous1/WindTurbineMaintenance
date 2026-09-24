import { useTranslation } from 'react-i18next'
import Card from '@/components/common/Card'
import type { FarmDefaults } from '@/domain/types'
import NumberField from './NumberField'
import { FARM_DEFAULT_RANGES } from './optimizerParams'

interface FarmDefaultsFormProps {
  defaults: FarmDefaults
  disabled: boolean
  // Только изменённое поле: остальные берутся из сохранённой фермы, а не из замыкания
  onChange: (patch: Partial<FarmDefaults>) => void
}

// Параметры турбин, для которых в файле нет своих значений; от них зависят высота
// и радиус облёта, поэтому после правки план пересчитывается
export default function FarmDefaultsForm({ defaults, disabled, onChange }: FarmDefaultsFormProps) {
  const { t } = useTranslation()
  const m = t('routePlan.units.m')

  return (
    <Card title={t('routePlan.farmDefaults.title')} subtitle={t('routePlan.farmDefaults.hint')}>
      <div className="space-y-3">
        <NumberField
          label={t('routePlan.farmDefaults.hub')}
          unit={m}
          value={defaults.hubHeightM}
          range={FARM_DEFAULT_RANGES.hubHeightM}
          disabled={disabled}
          onCommit={(v) => onChange({ hubHeightM: v })}
        />
        <NumberField
          label={t('routePlan.farmDefaults.rotor')}
          unit={m}
          value={defaults.rotorDiameterM}
          range={FARM_DEFAULT_RANGES.rotorDiameterM}
          disabled={disabled}
          onCommit={(v) => onChange({ rotorDiameterM: v })}
        />
        <NumberField
          label={t('routePlan.farmDefaults.safe')}
          unit={m}
          value={defaults.safeDistanceM}
          range={FARM_DEFAULT_RANGES.safeDistanceM}
          disabled={disabled}
          hint={t('routePlan.farmDefaults.safeHint')}
          onCommit={(v) => onChange({ safeDistanceM: v })}
        />
      </div>
    </Card>
  )
}
