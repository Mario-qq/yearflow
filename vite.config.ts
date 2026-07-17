/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 预览代理会通过 PORT 环境变量指定端口（vite 默认不读它）
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
