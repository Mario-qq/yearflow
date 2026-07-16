# PROGRESS — YearFlow 实施进度

> 每个 Phase 完成后更新本文件：勾选验收项、记录关键实现决策。新会话接手先读 CLAUDE.md → 本文件 → SPEC.md 对应章节。

## 会话安排建议
- 在 `D:\Agent\yearflow` 目录打开 Claude Code，每个 Phase 一个会话
- Phase 2 工作量最大，可拆两个会话：①时间轴/表头/网格/今日线 ②bar/点阵/热度条/里程碑/mini-map/虚拟化
- 每 Phase 结束：vitest 全绿 → 浏览器截图自查 → git commit → 更新本文件
- Phase 5 前用户注册 Supabase，自行把 URL + anon key 填入 `.env.local`

## Phase 1 — 骨架与数据层 【已完成 2026-07-16】
- [x] Vite + React 18 + TS 脚手架，依赖装齐（zustand/dexie/dayjs/nanoid/react-router-dom/zod/tailwind v4/vitest）
- [x] tokens.css 设计令牌（深浅主题，`html[data-theme]` 切换，index.html 首帧脚本防闪屏）
- [x] 领域模型 types/domain.ts
- [x] Dexie schema + 6 个 repo（软删除 + updatedAt，checkIns 建 [goalId+date] 复合索引）
- [x] Zustand store + undo/redo（execute(command)，栈上限 100 步）
- [x] 派生纯函数 + vitest 单测（应打卡日/缺卡/streak/周热度/基线偏移/自动进度，29 测试全绿）
- [x] 种子数据（2026 五目标 + 最近 45 天打卡 + 2 个 baseline 偏移，确定性 PRNG）
- [x] JSON 导出/导入（zod 校验 + schemaVersion=1 + 迁移钩子，单测覆盖往返无损）
- [x] 路由四页壳 + 主题切换 + 移动端默认落打卡页
- [x] 验收：单测全绿 / 浏览器实测（今日应打卡项按 recurrence 精确命中、streak 正确、刷新数据与设置均不丢、深浅主题令牌生效、控制台无错误）

### 关键决策（后续 Phase 需知）
- React 钉 18（模板默认 19，按 SPEC 改回）；Tailwind v4 走 `@tailwindcss/vite` 插件，无 tailwind.config；tsconfig 开了 `erasableSyntaxOnly`（禁构造函数参数属性写法）
- Goal.color 存色板键（`goal-1`..`goal-5`），UI 经 `src/lib/colors.ts` 解析为 `var(--goal-N)`；透明度档用 `--goal-N-40/-15`
- undo/redo：Change 自带 before/after 完整实体，`invertChange` 反转即 undo；持久化不回读 store（persist.ts 直接消费 Change 载荷），防抖 500ms
- CheckIn 与任务的归属匹配口径（derive/scheduled.ts `checkedDatesFor`）：goalId 相同且（无 taskId 或 taskId 一致）
- streak 口径：done/partial 计数延续，skipped 与免打卡日不打断不计数，missed 打断，今天未打不打断（单测锁定）
- 完成率/自动进度计权统一：done=1、partial=0.5
- 打卡页/甘特页当前是占位壳，仅展示派生数据；交互分别在 Phase 4 / Phase 2-3 实现
- 浏览器面板 screenshot 接口在本机会超时，自查用 get_page_text/read_page/javascript_tool 替代；Phase 2 的 8 张截图自查建议用 Playwright

## Phase 2 — 甘特图静态渲染 【未开始】
## Phase 3 — 交互与编辑 【未开始】
## Phase 4 — 打卡与复盘 【未开始】
## Phase 5 — 云同步与部署 【未开始，等 Supabase 凭据】
