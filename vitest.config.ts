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
    // По умолчанию node, тесты с DOM (разбор KML) ставят @vitest-environment happy-dom в первой строке
    environment: 'node',
  },
})
