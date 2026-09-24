import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import path from 'path'

export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron'

  const plugins: PluginOption[] = [react(), tailwindcss()]

  if (isElectron) {
    plugins.push(
      electron({
        main: {
          entry: 'electron/main.ts',
        },
        preload: {
          input: 'electron/preload.ts',
          // Пресет собирает preload в CommonJS, но при "type": "module" даёт ему расширение .mjs,
          // и Electron грузит файл как ES-модуль. Расширение .cjs однозначно означает CommonJS.
          vite: {
            build: {
              rolldownOptions: {
                output: {
                  entryFileNames: '[name].cjs',
                },
              },
            },
          },
        },
      }),
    )
  }

  return {
    // Собранное приложение открывается через file://, поэтому пути к ассетам относительные
    base: isElectron ? './' : '/',
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
