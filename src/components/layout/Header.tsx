import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import MissionSwitcher from '@/features/mission/MissionSwitcher'

// Порядок — по сценарию работы с миссией: маршрут, погода, облёт в 3D, затем дефекты по фото
const navItems = [
  { path: '/', labelKey: 'nav.home' },
  { path: '/router', labelKey: 'nav.router' },
  { path: '/weather', labelKey: 'nav.weather' },
  { path: '/simulation', labelKey: 'nav.simulation' },
  { path: '/detection', labelKey: 'nav.detection' },
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
      {/* При узком окне (у Electron минимум 1024 px) ужимаются отступы меню, а если его всё равно не хватает —
          меню прокручивается. Правый блок не сжимается: иначе выбор миссии наползал на кнопку языка */}
      <div className="flex min-w-0 flex-1 items-center gap-4 xl:gap-8">
        <div className="flex shrink-0 items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
          <span className="font-semibold text-gray-800 text-sm hidden xl:block">
            WTM
          </span>
        </div>
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `px-2 xl:px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
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
      <div className="ml-3 flex shrink-0 items-center gap-3">
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
