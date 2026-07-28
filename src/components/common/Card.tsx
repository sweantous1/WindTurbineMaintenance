import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  subtitle?: string
  children: ReactNode
  className?: string
  actions?: ReactNode
  onClick?: () => void
}

export default function Card({ title, subtitle, children, className = '', actions, onClick }: CardProps) {
  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            {title && <h3 className="text-base font-semibold text-gray-900">{title}</h3>}
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}
