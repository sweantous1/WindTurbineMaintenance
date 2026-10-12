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
          // Пресет собирает preload в CommonJS, но при "type": "module" называет его .mjs,
          // и Electron грузит его как ESM. С .cjs такого нет
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
    base: isElectron ? './' : '/',
    plugins,
    // onnxruntime-web ищет свой .wasm через new URL(..., import.meta.url), пребандл в dev ломает этот путь
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
    worker: {
      format: 'es',
    },
    build: {
      // three.js с R3F около 1 МБ в ленивом чанке 3D, стартовый бандл намного меньше
      chunkSizeWarningLimit: 1200,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
