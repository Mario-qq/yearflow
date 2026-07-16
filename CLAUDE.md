# CLAUDE.md — YearFlow 项目规则

> 唯一需求事实来源：`docs/SPEC.md`（规格书 v2 全文）。实现任何功能前先读对应章节。
> 当前进度与各 Phase 验收记录：`docs/PROGRESS.md`（每完成一个 Phase 必须更新）。

## 项目定位
单人使用的年度计划管理网站，**甘特图是首页和主战场**：年度规划（甘特图）+ 每日打卡（结果叠加在甘特图上）+ 月度复盘。质量标准：长期日用的个人工具，甘特图观感与手感对标 MS Project / Linear Timeline，不是 demo。

## 技术栈铁律（SPEC 第二节，不得替换）
- React 18 + TypeScript + Vite；Tailwind CSS v4 + `src/styles/tokens.css` 设计令牌
- **甘特图不用任何现成库**（frappe-gantt / dhtmlx 等都禁止）：SVG + React 自绘；bar 拖拽用原生 pointer events 自实现（不用 dnd 库）
- Zustand + 自实现 undo/redo；dayjs（isoWeek/customParseFormat，本地时区，一天边界=本地 00:00）
- Dexie.js (IndexedDB) 本地持久化，防抖 500ms 自动保存；统计图 recharts；PWA 用 vite-plugin-pwa
- Phase 5 云同步：Supabase 免费档，本地优先（UI 只读写 IndexedDB）

## 架构约定
- 领域模型唯一定义在 `src/types/domain.ts`（照 SPEC 第三节）
- UI 不直接碰 Dexie/Supabase，一律走 `src/db/repos/*`；所有写入刷新 `updatedAt`，删除用 `deletedAt` 软删除（同步预留）
- 所有 mutation 走 store 的 `execute(command)` 进 undo 栈（≥50 步）
- 派生数据（应打卡日/缺卡/streak/周热度/基线偏移）是 `src/lib/derive/` 纯函数 + vitest 单测，不入库
- 尺寸/颜色/间距只允许引用 tokens.css 令牌或 `src/gantt/constants.ts` 常量，禁止散落魔数

## 视觉与文案
- 气质对标 Linear：高密度、克制、安静；深色主题一等公民；数字一律 `tabular-nums`
- 动效只保留功能性的，缓动统一 `cubic-bezier(0.25, 1, 0.5, 1)`，respect `prefers-reduced-motion`
- **界面语言：简体中文**，文案动词开头

## 质量门槛（SPEC 第九节）
全年×10目标×各8任务×365天数据下：首屏 <1s、缩放切换 <150ms、拖拽 60fps（拖拽中只改 transform）。时间轴行列虚拟化；派生数据 memo 缓存。每个 Phase 完成后浏览器截图自查（甘特图相关 Phase：四档缩放 × 深浅主题 8 张）再进下一阶段，并 git commit + 更新 PROGRESS.md。

## 实施顺序
严格按 SPEC 第十二节 Phase 1→5，验收对照第十三节清单。Phase 5 需要用户提供 Supabase 凭据（填 `.env.local`，绝不硬编码、绝不提交）。
