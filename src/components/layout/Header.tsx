import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import MissionSwitcher from '@/features/mission/MissionSwitcher'

const navItems = [
  { path: '/', labelKey: 'nav.home' },
  { path: '/detection', labelKey: 'nav.detection' },
  { path: '/router', labelKey: 'nav.router' },
  { path: '/weather', labelKey: 'nav.weather' },
  { path: '/history', labelKey: 'nav.history' },
  { path: '/docs', labelKey: 'nav.docs' },
  { path: '/settings', labelKey: 'nav.settings' },
]

export default function Header() {
  const { t, i18n } = useTranslation()
  // resolvedLanguage — уже сведённый к 'ru' или 'en' язык; language может быть 'ru-RU'
  const isRu = i18n.resolvedLanguage === 'ru'

  const toggleLang = () => {
    i18n.changeLanguage(isRu ? 'en' : 'ru')
  }

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-[1500]">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            W
          </div>
          <span className="font-semibold text-gray-800 text-sm hidden sm:block">
            WTM
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>
      {/* min-w-0: при узком окне сжимается выбор миссии, а не навигация */}
      <div className="flex min-w-0 shrink items-center gap-3">
        <MissionSwitcher />
        <button
          onClick={toggleLang}
          className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
        >
          {isRu ? 'EN' : 'RU'}
        </button>
      </div>
    </header>
  )
}
