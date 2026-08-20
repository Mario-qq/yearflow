/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 部署在 /yearflow/ 子路径（GH_PAGES=1 时）；Vercel / 本地 dev 仍走根路径 '/'
const base = process.env.GH_PAGES ? '/yearflow/' : '/'

// Electron 桌面构建（ELECTRON=1）。base 保持 '/' —— 主进程用 app:// 自定义协议托管 dist，
// 有真实 origin，所以绝对路径和 BrowserRouter 都不用改（见 electron/main.cts 注释）。
const isElectron = !!process.env.ELECTRON

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    // PWA（SPEC 第二节）：离线可用、可安装到手机主屏
    VitePWA({
      // 桌面壳里 service worker 只会添乱（离线本来就成立，且注册脚本是注入进 built HTML 的）
      disable: isElectron,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'icon-maskable.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'YearFlow — 年度计划',
        short_name: 'YearFlow',
        description: '年度计划甘特图 + 每日打卡 + 月度复盘',
        lang: 'zh-CN',
        theme_color: '#17171c',
        background_color: '#101014',
        display: 'standalone',
        start_url: base, // 子路径部署时需指向 /yearflow/，否则装 PWA 打开会 404
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          // 独立的全出血不透明底图，供 Android adaptive icon 裁切安全区用（不能复用带圆角透明边的 pwa-512）
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // 桌面版多一个 pip.html 入口：小窗是独立窗口、独立 React root，不能再靠 createPortal
  build: isElectron
    ? { rollupOptions: { input: { index: 'index.html', pip: 'pip.html' } } }
    : undefined,
  // 预览代理会通过 PORT 环境变量指定端口（vite 默认不读它）
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
