import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// main собирается в ES-модуль ("type": "module" в package.json), а в ESM нет __dirname
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(currentDir, '../dist')

// Собранное приложение открывается со своей схемы app://bundle, а не с file://.
// У file:// нет нормального origin: хуже работают IndexedDB, фоновые потоки (Web Worker)
// и загрузка файлов модели через fetch.
const APP_SCHEME = 'app'
const APP_ORIGIN = `${APP_SCHEME}://bundle`

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
    const filePath = path.normalize(path.join(distDir, relative))
    // Не выпускаем запросы за пределы папки dist
    // Нет файла — честный 404, а не сетевая ошибка: так, например, движок детекции
    // отличает «модель не установлена» от сбоя загрузки
    if (!filePath.startsWith(distDir + path.sep) || !existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

let mainWindow: BrowserWindow | null = null

function isHttpUrl(url: string) {
  return url.startsWith('https://') || url.startsWith('http://')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'WTM - Wind Turbine Maintenance',
    webPreferences: {
      preload: path.join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Ссылки target=_blank и window.open открываем в системном браузере, а не в окне приложения
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Не даём окну уйти со страницы приложения: например, на фото, брошенное мимо зоны загрузки.
  // Сравниваем с текущим адресом, который уже нормализовал Chromium, — так проходит перезагрузка страницы
  const wc = mainWindow.webContents
  const isSamePage = (url: string) => {
    try {
      const next = new URL(url)
      const current = new URL(wc.getURL())
      return next.protocol === current.protocol && next.host === current.host && next.pathname === current.pathname
    } catch {
      return false
    }
  }
  wc.on('will-navigate', (event, url) => {
    if (isSamePage(url)) return
    event.preventDefault()
    if (isHttpUrl(url)) shell.openExternal(url)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Политика тайлов OpenStreetMap требует опознаваемый User-Agent и Referer, а со схемы app://
// Chromium Referer не отправляет — без этого сервер тайлов может отказать приложению
const TILE_URLS = ['https://tile.openstreetmap.org/*', 'https://*.tile.openstreetmap.org/*']
const APP_REFERER = 'https://github.com/sweantous1/WindTurbineMaintenance'

function identifyTileRequests() {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: TILE_URLS }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    headers['User-Agent'] = `WTM-WindTurbineMaintenance/${app.getVersion()} (+${APP_REFERER})`
    headers['Referer'] = APP_REFERER
    callback({ requestHeaders: headers })
  })
}

// Второй экземпляр с тем же профилем не открыл бы IndexedDB (её держит первый процесс)
// и навсегда остался бы в «Загрузка…». Вместо него поднимаем уже открытое окно.
// Окно создаётся только в экземпляре с блокировкой, иначе второй успевал бы мелькнуть окном
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    registerAppProtocol()
    identifyTileRequests()
    createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})
