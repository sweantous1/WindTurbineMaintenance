import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // По умолчанию node; тесты, которым нужен DOM (разбор KML), объявляют
    // `// @vitest-environment happy-dom` в первой строке файла
    environment: 'node',
  },
})
