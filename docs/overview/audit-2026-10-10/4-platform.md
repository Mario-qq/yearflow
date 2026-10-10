## 模块体检

- `src/db/sync/*` · 474 行 · 同步引擎/LWW/门面 · **keep** · 职责单一、merge 有单测
- `SyncIndicator`+`SyncSection` · 299 行 · 同步 UI · **polish** · 内联样式重复、魔数
- `supabase/migrations/*` · 397 行 · 建表/RPC/卡片 API · **polish** · upsert_rows 白名单硬编码，怕重跑
- `electron/main.cts` · 605 行 · 壳+小窗状态机 · **rework** · 七成是小窗几何，常量手工镜像
- `preload.cts`+`desktop.ts` · 107 行 · 原生桥 · **keep** · 接口窄
- `vite.config`+workflow+vercel · 111 行 · 构建/PWA/部署 · **polish** · dist 网页桌面共用、Vercel 冗余
- `harmony/YearFlowCard` · 988 行 · 鸿蒙卡片 · **polish** · 缺工程骨架、未装机

## 跨系统隐患

1. `dist/` 网页构建与桌面构建共用，跑错命令桌面版就坏
2. 排期规则 TS 与 SQL 两份，对照靠手动
3. 三个来源（github.io / vercel / app://）各一份 IndexedDB，易误以为丢数据
4. 卡片用服务器时钟、网页用设备时钟写 updatedAt，混合参与 LWW
5. 小窗尺寸常量在 main.cts 与 pomodoro/constants.ts 各一份
