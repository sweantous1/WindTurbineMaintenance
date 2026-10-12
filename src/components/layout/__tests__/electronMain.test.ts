import { beforeEach, describe, expect, it, vi } from 'vitest'

// main.ts с замоканным electron. Путь в переменной, чтобы tsc приложения не разбирал main.ts
// (у него свой tsconfig с типами node)
const MAIN = '../../../../electron/main.ts'

const state = vi.hoisted(() => ({
  lock: true,
  calls: [] as string[],
  handlers: {} as Record<string, () => void>,
}))

vi.mock('electron', () => {
  const win = {
    isMinimized: () => true,
    restore: () => state.calls.push('restore'),
    focus: () => state.calls.push('focus'),
    on: () => {},
    loadURL: () => {},
    webContents: { setWindowOpenHandler: () => {}, on: () => {}, getURL: () => '', openDevTools: () => {} },
  }
  return {
    app: {
      requestSingleInstanceLock: () => state.lock,
      quit: () => state.calls.push('quit'),
      whenReady: () => {
        state.calls.push('whenReady')
        return Promise.resolve()
      },
      on: (name: string, fn: () => void) => {
        state.handlers[name] = fn
      },
      getVersion: () => '0.0.0',
    },
    BrowserWindow: vi.fn(function () {
      state.calls.push('window')
      return win
    }),
    ipcMain: { handle: () => {} },
    net: { fetch: () => {} },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
    session: { defaultSession: { webRequest: { onBeforeSendHeaders: () => {} } } },
    shell: { openExternal: () => {} },
  }
})

async function startMain() {
  await import(/* @vite-ignore */ MAIN)
  // whenReady().then(...) отрабатывает микрозадачей
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.resetModules()
  state.calls = []
  state.handlers = {}
})

describe('главный процесс Electron: один экземпляр', () => {
  it('второй запуск с тем же профилем сразу выходит и не создаёт окно', async () => {
    // Иначе второе окно не откроет IndexedDB и зависнет на загрузке
    state.lock = false
    await startMain()
    expect(state.calls).toEqual(['quit'])
    expect(state.handlers['second-instance']).toBeUndefined()
  })

  it('первый экземпляр создаёт окно, а на повторный запуск разворачивает его', async () => {
    state.lock = true
    await startMain()
    expect(state.calls).toEqual(['whenReady', 'window'])
    state.handlers['second-instance']()
    expect(state.calls.slice(2)).toEqual(['restore', 'focus'])
  })
})
