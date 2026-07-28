import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const navItems = [
  { path: '/', labelKey: 'nav.home' },
  { path: '/detection', labelKey: 'nav.detection' },
  { path: '/router', labelKey: 'nav.router' },
  { path: '/weather', labelKey: 'nav.weather' },
  { path: '/history', labelKey: 'nav.history' },
]

export default function Header() {
  const { t, i18n } = useTranslation()

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language === 'ru' ? 'en' : 'ru')
  }

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
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
      <div className="flex items-center gap-3">
        <button
          onClick={toggleLang}
          className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
        >
          {i18n.language === 'ru' ? 'EN' : 'RU'}
        </button>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center text-xs font-medium">
            A
          </div>
          <span className="hidden sm:block">Admin</span>
        </div>
      </div>
    </header>
  )
}
