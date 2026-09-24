import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// main собирается в ES-модуль ("type": "module" в package.json), а в ESM нет __dirname
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const indexHtml = path.join(currentDir, '../dist/index.html')

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
    mainWindow.loadFile(indexHtml)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

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
