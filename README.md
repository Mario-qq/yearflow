# YearFlow

单人使用的年度计划管理工具：年度甘特图（首页与主战场）+ 每日打卡（结果叠加在甘特图上）+ 月度复盘。本地优先（IndexedDB），可选 Supabase 云同步实现电脑与手机数据互通。

- 技术栈：React 18 + TypeScript + Vite / Tailwind CSS v4 / Zustand（自实现 undo/redo）/ Dexie.js / SVG 自绘甘特图 / recharts / PWA
- 需求规格：`docs/SPEC.md`；实施进度：`docs/PROGRESS.md`

## 本地开发

```bash
npm install
npm run dev      # 开发服务器
npm run build    # tsc -b + vite build
npx vitest run   # 单元测试
```

不配置任何环境变量即为**纯本地模式**：数据存浏览器 IndexedDB，云同步 UI 不显示，其余功能完整可用。

## 云同步（Supabase，可选）

架构：本地优先。UI 永远只读写 IndexedDB；后台同步引擎做本地 ↔ Supabase 双向增量同步（整行 last-write-wins，软删除墓碑传播，30 天后真删）。触发时机：登录/启动、窗口重获焦点、本地写入后 3 秒、每 5 分钟、顶栏手动同步。断网一切照常，联网自动补同步。

### 1. 创建 Supabase 项目

1. 到 [supabase.com](https://supabase.com) 注册并新建项目（Free 档即可）
2. 记下项目的 **Project URL** 和 **anon / publishable key**（Dashboard → Settings → API Keys）

### 2. 执行建表 SQL

1. 打开 Dashboard → **SQL Editor** → New query
2. 把 `supabase/migrations/0001_init.sql` 全文粘贴进去，点 **Run**
3. 再新建一个 query，把 `supabase/migrations/0002_focus_sessions.sql` 全文粘贴进去，点 **Run**
4. 成功后 Table Editor 中应出现 7 张表：`goals / tasks / milestones / check_ins / exemptions / reviews / focus_sessions`（均已开启 RLS，只能读写自己的行）

> ⚠️ 两条顺序约定：
> · **0001 执行过 0002 之后不得再单独重跑** —— 0001 里的 `upsert_rows` 表名白名单是硬编码 6 表，重跑会把 `focus_sessions` 移出白名单，之后专注会话推送会报「非法表名」。要重建请按 0001 → 0002 顺序执行。
> · **新增表时先执行 migration，再部署前端** —— 远端表不存在时整轮同步会 fail-fast（顶栏同步点常亮红并指名该表），执行完 SQL 后自动恢复，不会丢数据。

### 3. 配置环境变量

复制 `.env.example` 为 `.env.local`，填入你的凭据：

```
VITE_SUPABASE_URL=https://你的项目ref.supabase.co
VITE_SUPABASE_ANON_KEY=你的anon或publishable key
```

重启 dev server，顶栏出现同步状态点。

### 4. 注册登录

设置页 → 云同步 → 输入邮箱密码注册（Supabase 默认要求邮箱确认，收信点击链接后回来登录；也可在 Dashboard → Authentication → Sign In / Up 中关闭 Confirm email）。登录后本地数据自动全量上传合并，之后增量双向同步。

同步状态点含义：✓ 已同步 / ⟳ 同步中 / ○ 离线或未登录 / ⚠ 出错（点击查看详情与手动同步）。

## 部署到 Vercel

1. 代码推到 GitHub 仓库
2. [vercel.com](https://vercel.com) → Add New → Project → 导入该仓库，框架预设选 **Vite**（构建命令 `npm run build`、输出目录 `dist`，默认即可）
3. 在项目 Settings → Environment Variables 添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`（不配置则部署为纯本地模式）
4. Deploy。因为是 SPA + React Router，需要 rewrite 兜底：项目根目录已提供 `vercel.json`（所有路径回落到 `index.html`）

## 手机安装（PWA）

用手机浏览器打开部署后的地址：

- **iOS Safari**：分享按钮 → 「添加到主屏幕」
- **Android Chrome**：菜单 → 「安装应用」（或地址栏安装提示）

安装后全屏运行，离线可用；手机端默认进入打卡页，甘特图为只读月视图（可横滑、点打卡点补卡）。

## 数据备份

设置页支持导出/导入 JSON 全量备份（含所有目标、任务、打卡、复盘与设置），作为云同步之外的兜底。
