import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// main собирается как ESM, __dirname там нет
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(currentDir, '../dist')

// Своя схема app://bundle вместо file:// - у file:// нет нормального origin,
// из-за этого хуже работают IndexedDB, воркеры и fetch файлов модели
const APP_SCHEME = 'app'
const APP_ORIGIN = `${APP_SCHEME}://bundle`

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

// CSP: из сети только прогноз, поиск города и тайлы. wasm-unsafe-eval для onnxruntime-web,
// blob: для воркера маршрута и текстур в GLB. В dev страницу отдаёт Vite, там CSP нет
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: https://api.open-meteo.com https://geocoding-api.open-meteo.com https://tile.openstreetmap.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
    const filePath = path.normalize(path.join(distDir, relative))
    // Только внутри dist. Нет файла - 404, а не сетевая ошибка: по нему детекция
    // отличает "модель не установлена" от сбоя загрузки
    if (!filePath.startsWith(distDir + path.sep) || !existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    const file = await net.fetch(pathToFileURL(filePath).toString())
    // CSP и для скриптов воркеров, у воркера из отдельного файла своя политика
    const headers = new Headers(file.headers)
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    return new Response(file.body, { status: file.status, statusText: file.statusText, headers })
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

  // target=_blank и window.open открываем в системном браузере
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Не даём уйти со страницы (например, на фото, брошенное мимо зоны загрузки).
  // Сравниваем с текущим URL, уже нормализованным Chromium, чтобы работала перезагрузка
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

// OSM требует опознаваемые User-Agent и Referer, а с app:// Chromium Referer не шлёт
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

// Второй экземпляр не откроет IndexedDB (её держит первый) и зависнет на загрузке,
// поэтому поднимаем уже открытое окно. Окно создаём только под блокировкой
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
