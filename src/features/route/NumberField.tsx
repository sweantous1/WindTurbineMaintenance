import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatInputNumber, formatNumber } from './format'
import { parseNumberInput, type NumberRange } from './optimizerParams'

interface NumberFieldProps {
  label: string
  value: number
  range: NumberRange
  onCommit: (value: number) => void
  disabled?: boolean
  hint?: string
  // единица справа от поля: м, °
  unit?: string
}

// Числовое поле с черновиком: наверх уходит только валидное значение в границах (по Enter или blur),
// неверный ввод откатывается к прежнему
export default function NumberField({ label, value, range, onCommit, disabled, hint, unit }: NumberFieldProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const id = useId()
  const noteId = `${id}-note`
  const show = (v: number) => formatInputNumber(v, lang)
  const [draft, setDraft] = useState(() => show(value))
  const [shown, setShown] = useState(value)
  const invalid = parseNumberInput(draft, range) === null

  // значение поменяли снаружи (сброс, другой экран) - обновляем черновик
  if (!Object.is(shown, value)) {
    setShown(value)
    setDraft(show(value))
  }

  const commit = () => {
    const parsed = parseNumberInput(draft, range)
    if (parsed === null) {
      setDraft(show(value))
      return
    }
    setDraft(show(parsed))
    if (parsed !== value) onCommit(parsed)
  }

  const note = invalid
    ? t(range.integer ? 'routePlan.form.invalidInteger' : 'routePlan.form.invalidNumber', {
        min: formatNumber(range.min, lang, 6),
        max: formatNumber(range.max, lang, 6),
      })
    : hint

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {/* единица для скринридера, визуально она справа от поля */}
        {unit && <span className="sr-only"> ({unit})</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={note ? noteId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft(show(value))
          }}
          className={`w-full min-w-0 px-2.5 py-1.5 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 disabled:bg-gray-50 disabled:text-gray-400 ${
            invalid ? 'border-red-400 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-200'
          }`}
        />
        {unit && (
          <span className="text-xs text-gray-500 shrink-0" aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {note && (
        <p id={noteId} className={`text-xs mt-1 ${invalid ? 'text-red-600' : 'text-gray-500'}`}>
          {note}
        </p>
      )}
    </div>
  )
}
