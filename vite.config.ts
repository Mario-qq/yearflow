/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA（SPEC 第二节）：离线可用、可安装到手机主屏
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'YearFlow — 年度计划',
        short_name: 'YearFlow',
        description: '年度计划甘特图 + 每日打卡 + 月度复盘',
        lang: 'zh-CN',
        theme_color: '#17171c',
        background_color: '#101014',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // 预览代理会通过 PORT 环境变量指定端口（vite 默认不读它）
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
