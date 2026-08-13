# YearFlow 数据层勘察报告（番茄钟模块前置）

标注约定：【读码确认】= 已读到具体代码/行号；【推断】= 基于已确认机制的演绎，未实测。
全部路径为绝对路径根 `D:\Agent\yearflow`，行号为勘察时（HEAD=1f5341d）状态。

---

## 0. 已核对的既有事实修正

- 【读码确认】`src/db/repos/index.ts:52` 的 `clearAllData()` **全仓无调用点**（`grep -rn clearAllData` 只命中定义）。设置页「清空全部数据」走的是 `replaceAllData({6 个空数组})`（`src/pages/SettingsPage.tsx:67` → `src/store/useStore.ts:154-179` 墓碑式清库）。`clearAllData` 是死代码。
- 【读码确认】`src/db/repos/index.ts:16` 的 `CheckInRepo.getByGoalAndRange`（唯一用到 `[goalId+date]` 复合索引的查询）**也无调用点**。即当前 `[goalId+date]` 索引（`src/db/schema.ts:33`）实际未被任何运行路径使用。
- 【读码确认】`MINUTE_CHIPS = [10, 15, 30, 60]` 在两处重复定义：`src/checkin/GoalCheckCard.tsx:12` 与 `src/gantt/CheckinPopover.tsx:14`（未抽公共常量）。
- 【读码确认】`AppSettings.colorNormalized`（`src/types/domain.ts:130`）**不在** `backup.ts` 的 `settingsSchema`（`src/lib/backup.ts:112-117`）里。zod object 默认 strip 未知键 ⇒ 导入备份后该标记被静默丢弃，`src/App.tsx:86-89` 的一次性颜色迁移会重跑。这是「zod schema 漏字段 = 静默丢数据」的现成先例。

---

## 1. 新增一张实体表的完整改动清单

### 1.1 逐文件逐处

| # | 文件 | 位置 | 需要改什么 | 编译期是否会报错（改漏能否被发现） |
|---|---|---|---|---|
| 1 | `src/types/domain.ts` | 紧邻 `CheckIn`（:71-82）新增 interface | 必须含 `id: string; updatedAt: string; deletedAt?: string`，否则不满足 `SyncableEntity`（:134-138），`BaseRepo<T extends SyncableEntity>`（`src/db/repos/baseRepo.ts:10`）泛型约束不过 | 会报错 |
| 2 | `src/db/schema.ts` | :19-25 类字段；:29-37 版本块 | 加 `pomodoroSessions!: Table<PomodoroSession, string>;` + 新 `this.version(2).stores({...})`（详见 1.2） | 字段漏了会报错；version 漏了**不报错**，运行时 Dexie 走补丁模式（见 1.2） |
| 3 | `src/db/repos/index.ts` | :43-49 | `export const pomodoroRepo = new BaseRepo<PomodoroSession>(db.pomodoroSessions);` | 不加则第 7 项报错 |
| 4 | `src/db/repos/index.ts` | :52-61 `clearAllData` | 一致性起见加 `db.pomodoroSessions.clear()`；**功能上无影响（死代码，见 §0）** | 不报错 |
| 5 | `src/store/types.ts` | :11-18 `EntityOf` | 加键 | 加了之后第 6/8/12/13 项自动报错，是主要的编译期护栏 |
| 6 | `src/store/types.ts` | :22-29 `TABLE_NAMES` | 加表名。**这一个数组驱动**：`engine.ts:119/156/182` 三个同步循环、`useStore.ts:160` replaceAllData、`useStore.ts:184` exportBundle、`useStore.ts:194` applyRemote、`SettingsPage.tsx:53` 统计 | 漏加**不报错**（`TableName[]` 不要求穷举）→ 新表永不同步、不导出、不进墓碑清库。**这是最危险的一处漏改** |
| 7 | `src/store/types.ts` | :48-55 `EntityMaps` | 加键 | 会报错（`StoreState extends EntityMaps`，:53） |
| 8 | `src/store/types.ts` | :58-65 `DataBundle` | 加键 | 会报错（seed/backup 处） |
| 9 | `src/store/types.ts` | :35-39 `Change` / :68-81 `invertChange` | **零改动**（`Change` 是 over `TableName` 的映射类型，自动派生） | — |
| 10 | `src/store/useStore.ts` | :32-34 `emptyMaps()` | **硬编码 6 键**，加键 | 会报错 |
| 11 | `src/store/useStore.ts` | :84-104 `hydrate` | **硬编码**：import repo、`Promise.all` 数组项、`set({...})` 键 | `set()` 缺键不报错（`Partial` 语义）→ 表存在但内存永远为空 |
| 12 | `src/store/useStore.ts` | :154-179 `replaceAllData` | 循环是 TABLE_NAMES 驱动 ⇒ **自动生效**，但 `bundle[t].map`（:162）要求传入的 bundle **必须有该键**，否则 `TypeError: Cannot read properties of undefined` | 传字面量的调用点会 TS 报错（第 16/17 项） |
| 13 | `src/store/useStore.ts` | :181-188 `exportBundle` / :190-204 `applyRemote` / :43-51 `applyChanges` | **零改动**（全部 TABLE_NAMES / 泛型驱动） | — |
| 14 | `src/store/persist.ts` | :16-23 `repoByTable` | 加条目 | 会报错（`Record<TableName, ...>`）✅ 强护栏 |
| 15 | `src/lib/backup.ts` | 新增实体 zod schema；:119-132 `backupSchema.data` 加键 | **必须加**：zod 默认 strip，不加则新表数据导出后**导入时被静默丢弃、无任何报错**（先例见 §0 colorNormalized）。若声明为必填数组，则**老备份（无该键）导入直接失败**，报 `备份校验失败：data.pomodoroSessions ...`（:174-177）。既有解法先例：`.default([])`（:97, :101, :102 三处 expandedTrackIds/gridCollapsed/gridColWidths 就是这么处理的） | `data` 对象加键后 `DataBundle` 类型不匹配会报错 |
| 16 | `src/lib/backup.ts` | :9 `BACKUP_SCHEMA_VERSION` / :148-155 `migrate()` | 【推断】用 `.default([])` 就**不需要**升到 2：`migrate` 只在 `version > 当前` 时抛错，老备份（v1）照样过。升版号纯属可选记账 | — |
| 17 | `src/lib/backup.test.ts` | :11 `expect(parsed.data).toEqual(bundle)` | 【推断】若 seed bundle 不含新键而 zod 有 `.default([])`，parsed 会多出 `pomodoroSessions: []` → `toEqual` 失败。需同步改 seed（第 19 项）或补断言 | 测试失败 |
| 18 | `src/db/sync/engine.ts` | :24-31 `REMOTE_TABLE` | 加 `pomodoroSessions: 'pomodoro_sessions'`。`rawTable()`（:34-35）用 `db[t]`，靠第 2 项的类字段自动可用 | 会报错（`Record<TableName, string>`）✅ 强护栏 |
| 19 | `src/seed/seedData.ts` | :114 `return { …6 键 }` | 加键（哪怕 `[]`），否则 `replaceAllData` 在 :162 `bundle[t].map` 上炸 | 会报错（返回类型 `DataBundle`） |
| 20 | `src/pages/SettingsPage.tsx` | :67 清空用的字面量 6 键 | 加键，否则「清空全部数据」运行时抛 TypeError | 会报错 |
| 21 | `src/pages/SettingsPage.tsx` | :11-18 `TABLE_LABEL` | 加中文标签。类型是 `Record<string, string>` 而非 `Record<TableName, string>` ⇒ 漏加**不报错**，:142 渲染出 `undefined` | 不报错（静默 UI 缺口） |
| 22 | `supabase/migrations/0002_*.sql` | 新文件 | 见 1.3 | 无编译期检查，失败表现为运行时 `推送 pomodoro_sessions 失败：...`（engine.ts:172） |
| 23 | `docs/SPEC.md` §三（:40-110）、§十（:302-310） | 领域模型与「表与本地一一对应」 | 按 CLAUDE.md「唯一事实来源」铁律需同步；`docs/PROGRESS.md` 追加决策记录 | — |

**合计：12 个源文件 / 约 20 个改动点 + 1 个新 SQL migration + 1 次用户手动执行 SQL + 2 份文档。**
其中有编译期护栏的是 `repoByTable`、`REMOTE_TABLE`、`EntityMaps`、`emptyMaps`、`DataBundle` 消费点；**无护栏的高危三处是 `TABLE_NAMES`、`hydrate` 的 `set()`、`TABLE_LABEL`**。

### 1.2 Dexie 版本升级的正确写法（读 `node_modules/dexie@4.4.4/dist/dexie.js` 确认）

- 【读码确认】`Version.prototype.stores`（dexie.js:4096-4110）对 `db._versions` 逐个 `extend(storesSpec, version._cfg.storesSource)` 累积 ⇒ **`version(2).stores({ pomodoroSessions: '...' })` 只需声明新表**，version(1) 的 6 表 + settings 自动继承，无需重复列出。
- 【读码确认】`updateTablesAndIndexes`（dexie.js:3811-3900）按 `getSchemaDiff` 结果只对 `diff.add` 调 `createTable`；未变化的表既不 recreate 也不删索引 ⇒ **既有数据不会丢**。仅当主键 keyPath 变化才 `throw Upgrade('Not yet support for changing primary key')`（:3832）。
- 【读码确认】**不升版号也能跑，但走的是补丁路径**：`verifyInstalledSchema` 失败 → `console.warn("Dexie SchemaDiff: Schema was extended without increasing the number passed to db.version(). Dexie will add missing parts and increment native version number to workaround this.")` → 关库、`nativeVerToOpen = version+1`、`schemaPatchMode=true` 重开 → `patchCurrentVersion` → `createMissingTables`（dexie.js:4560-4572, 3767-3799）。代价：一次多余的开库周期 + 控制台警告 + 依赖官方"workaround"分支。**结论：应当写 `version(2)`。**
- 索引怎么设（现状与硬约束）：
  - 现有索引串：`src/db/schema.ts:30-36`。每张实体表都索引了 `updatedAt`。
  - 【读码确认】`updatedAt` 索引是**同步推送的硬依赖**：`engine.ts:159` `table.where('updatedAt').above(cursors.push).toArray()`。新表若不建 `updatedAt` 索引，Dexie 会抛 `SchemaError: KeyPath updatedAt on object store ... is not indexed`【推断，机制明确】。
  - `deletedAt` **任何表都没索引**：墓碑清理走 `toArray()` + JS filter（`engine.ts:183-185`）。
  - `getAllActive()`（`baseRepo.ts:18-21`）是 `table.toArray()` + JS filter，**不吃任何索引**。
  - `checkIns` 的 `[goalId+date]` 复合索引目前无消费者（§0）。

### 1.3 Supabase 侧（读 `supabase/migrations/0001_init.sql` 确认）

- 【读码确认】表结构由 DO 块批量建（:22-65），DDL 全部 `create table if not exists` / `create index if not exists` / `drop policy if exists` + `create policy` / `drop trigger if exists` + `create trigger` ⇒ **0001 整体幂等、可重复执行**。因此有两条路：把新表名加进 :26 的数组后重跑 0001，或写 0002 只处理新表。
- 【读码确认】**必须扩的白名单只有一处**：`0001_init.sql:76`
  ```sql
  if p_table not in ('goals', 'tasks', 'milestones', 'check_ins', 'exemptions', 'reviews') then
    raise exception 'upsert_rows: 非法表名 %', p_table;
  ```
  函数是 `create or replace function public.upsert_rows(p_table text, p_rows jsonb)`（:71），签名不变 ⇒ 0002 里整段 `create or replace` 覆盖即可，**无需改 0001**。
- 新 migration 需要包含（照 0001 的 DO 块逐项对齐，缺一项就出问题）：
  1. `create table if not exists public.pomodoro_sessions (id text, user_id uuid default auth.uid(), data jsonb, updated_at timestamptz not null, deleted_at timestamptz, server_updated_at timestamptz default clock_timestamp(), primary key (user_id, id))`
  2. 拉取索引 `(user_id, server_updated_at)`（对应 `engine.ts:123-128` 的查询形状）
  3. `enable row level security` + `for all using/with check (user_id = auth.uid())` —— **漏了 RLS 则表对所有登录用户可读**
  4. `touch_server_updated_at` 触发器 —— **漏了则 `server_updated_at` 只在 insert 时有默认值、update 不刷新** ⇒ 该表的增量拉取游标永久停滞，其它设备再也拉不到更新（`engine.ts:120-134` 完全依赖它）
  5. `create or replace function public.upsert_rows(...)` 带扩展后的白名单
- **用户在 SQL Editor 要做什么**：登录 Supabase Dashboard → SQL Editor → 整段粘贴 0002 → Run 一次。`0001_init.sql:2` 的注释就是这个流程；README 亦已记录（`docs/PROGRESS.md:236`）。
- 【读码确认】**新表首次同步的一个坑**：拉取游标是 per-table（`Cursors.pull` 是 `Partial<Record<TableName,string>>`，engine.ts:49），新表缺省 ⇒ `?? EPOCH`（:120）⇒ 自动全量拉。但**推送游标是全局单值** `cursors.push`（:49, :158, :175）：老用户 localStorage 里已有 cursor，`where('updatedAt').above(cursors.push)` ⇒ **新表中 `updatedAt` 早于该游标的本地行永远不会被推送**。正常新建的会话 `updatedAt` 都在游标之后所以不出问题；但「导入含番茄数据的老备份」「用旧时间戳回填历史会话」「跨设备时钟回拨」这三种情况会静默漏推。

---

## 2. 三种存储取向的真实成本对比

### (a) 新增独立实体表 `pomodoroSessions`

- **改动量**：§1，12 文件 / ~20 点 / 1 SQL migration / 1 次用户手动 SQL / 2 份文档。**其中 5 处有编译期护栏，3 处无（TABLE_NAMES / hydrate.set / TABLE_LABEL）。**
- **同步行为**：自动进入 `pullAll/pushAll/cleanupTombstones` 三循环（`engine.ts:119/156/182`）。整行 LWW（`merge.ts:9-15` + `0001_init.sql:90`）。会话是 append-only、每条独立 id ⇒ 跨设备天然无冲突（详见 §6）。
- **undo 行为**：只要走 `execute`（`useStore.ts:106-114`）就自动可撤销；也可以按 §3 选择性绕开（有 `applyRemote` / `replaceAllData` 两个现成绕开先例）。
- **统计能力**：完整——单次会话起止时刻、计划/实际时长、中断次数、被放弃的会话、时段分布、"平均单次专注时长"、与 `taskId` 的多对一关系全部可表达。
- **致命缺陷**：无结构性缺陷。风险集中在数据量（§7）与 `TABLE_NAMES` 漏改（静默不同步）。
- **既有先例（正好是反面的对照）**：`docs/PROGRESS.md:271` 记载轨道功能**故意没有**新开实体表，理由是「省掉 9 处改动（含 SQL 白名单与 Dexie 升版）」；:270 同时记载「加字段的成本被高估过」。即项目已明确认定「加字段≈零成本、加表≈9+ 处改动」。

### (b) 不加表，塞进 `CheckIn.minutes` / `note`

- **改动量**：schema/sync/backup **零改动**（这是唯一优点）。
- **主键语义直接冲突**：【读码确认】CheckIn 的 upsert 键是「目标+任务+日期」（`actions.ts:319-328` `findCheckIn`，:340-370 `setCheckIn`）⇒ 一天同一任务只能有**一行**。一天 4 个番茄只能"覆盖"或"累加成一个数字"，**单次会话的起止时刻、中断次数无处存**。
- **`minutes` 覆盖语义**：`actions.ts:350` `minutes: args.minutes ?? existing.minutes` 是覆盖不是累加；要累加必须在调用方自己读旧值再加 —— 这就变成 read-modify-write。
- **undo 行为（致命）**：`Change` 携带整行 `before/after`（`types.ts:35-39`）。番茄写入与用户手动打卡改的是**同一行** ⇒ 撤销一次番茄会把用户手动改的 status/note 一并回滚；反之亦然。且每次番茄结束都占一格 undo 栈（§3）。
- **同步行为（致命）**：整行 LWW + **累加型字段** = 静默丢数。手机番茄把 `minutes` 从 50 加到 75、电脑同时从 50 加到 80 ⇒ LWW 只留一个 ⇒ 结果是 80 而非 105，**且无任何冲突提示**。append-only 的行级模型不会有这个问题，累加进单行必然有。
- **`note` 塞 JSON**：`backup.ts:69` 是 `z.string().optional()` 无结构校验；`note` 会原样进 UI（打卡页「一句话备注」输入框、`GoalCheckCard.tsx:326` 等展示位），肉眼污染；未来任何 note 编辑都会破坏 JSON。
- **统计能力**：只能得到"每目标每任务每天一个总分钟数"，与现有手填 `minutes` **不可区分来源**（`CheckIn` 无 source 字段）——直接把 §5 的口径打架变成不可逆。

### (c) 塞进 `AppSettings`

- **改动量**：`domain.ts` + `backup.ts` 的 `settingsSchema`（:112-117），约 2 处。
- **同步行为（致命）**：【读码确认】`settings` 不在 `TABLE_NAMES`（`types.ts:22-29`），`settingsRepo` 是独立的单行表（`schema.ts:13-16`, `repos/index.ts:25-41`），`queuePersistSettings` 走独立 timer 且**不 `emitLocalWrite`**（`persist.ts:87-93`）⇒ **永不同步**。`docs/PROGRESS.md:244`：「settings 不同步（ganttView/主题是设备本地偏好，SPEC 六表之外）」。手机与电脑各存一份番茄记录，永不互通。
- **这个方案已经被否过一次**：`docs/PROGRESS.md:269` 记载轨道归属曾考虑存 `AppSettings`，被否的原文理由是「若把归属存进 `AppSettings` 则不同步（`TABLE_NAMES` 不含 settings），手机与电脑各存一份。归属是用户数据，必须跟着 tasks 走」。番茄会话同样是用户数据。
- **undo 行为**：`updateSettings`（`useStore.ts:143-147`）天然不进 undo 栈 —— 这一点是优点，但代价是**完全不可撤销**（误删一天会话无法恢复）。
- **写入放大**：单行主键固定 `'app'`（`repos/index.ts:26`），每次写 `db.settings.put({id:'app', value: 整个 AppSettings})`（:38-40）⇒ 一天几十个会话 = 几十次把含 `ganttView`（含 `gridColWidths` / `collapsedGoalIds` / `expandedTrackIds`）的整个 blob 重写。
- **合并陷阱**：`SettingsRepo.get()`（:28-37）只做「顶层扩展 + `ganttView` 深合并**一层**」⇒ 嵌套数组/对象在字段缺失时行为不直观。
- **备份丢失**：`settingsSchema`（`backup.ts:112-117`）未列的字段导入即丢，`colorNormalized` 是现成受害者（§0）。
- **统计能力**：结构上可以存数组，但派生层拿不到稳定的表级引用（`useGanttDerive` 只接 4 张表 map），且 settings 每次都是新对象 ⇒ 破坏 §4 的引用缓存。

---

## 3. 高频写入与 undo 栈的冲突

### 3.1 现有链路（全部【读码确认】）

```
UI → src/store/actions.ts（唯一入口，组装 Change[]）
   → useStore.execute(label, changes)            useStore.ts:106-114
        ├ set(applyChanges(...))  只拷贝受影响的表    useStore.ts:43-51
        ├ undoStack.push({label,changes}).slice(-100)   HISTORY_LIMIT=100, :30
        ├ redoStack = []                                （任何写入清空重做栈）
        └ queuePersist(changes)                    persist.ts:65-74
             └ pending Map（key=`table:id`，同实体只留最后一次）persist.ts:32,68
             └ schedule() 防抖 500ms                persist.ts:56-62
                  └ flush() → bulkPut / softDelete   persist.ts:35-53
                       └ emitLocalWrite()            persist.ts:53
                            └ engine.onLocalWrite → 防抖 3000ms → syncNow()  engine.ts:224-231
                                 └ syncNow 先 flushNow() 再拉再推            engine.ts:93-100
```

关键量化：**一次 `execute` 调用 = 恰好一格 undo（不论 changes 有多少条）**。100 步上限（`useStore.ts:30`）。

### 3.2 结论：哪些必须绕开

- 【读码确认+推断】番茄钟一天几十次 `execute` ⇒ 一天就能把 100 步栈冲满 ⇒ 用户在甘特图上的编辑（拖 bar、改名、批量平移）全部被挤出栈，`Ctrl+Z` 变成"撤销番茄心跳"。这是**功能性破坏，不只是性能问题**。
- 【读码确认】另一个连带效应：`execute` 无条件 `redoStack: []`（:111）⇒ 番茄钟的后台写入会**持续清空用户的重做栈**，`Ctrl+Shift+Z` 在番茄运行期间形同失效。
- 心跳/暂停/恢复这类中间态属于"运行时状态"，语义上不该可撤销；只有"一次已完成的会话"才是用户会想撤销的对象。

### 3.3 既有的四种绕开先例（都可直接引用）

| 先例 | 位置 | 绕开了什么 | 代价/前提 |
|---|---|---|---|
| `updateSettings` | `useStore.ts:143-147` + `persist.ts:85-93` | 不进 undo、独立 timer、**不 emitLocalWrite**（故不同步） | 只适合设备本地偏好 |
| `applyRemote` | `useStore.ts:190-204` | 不进 undo、**不 queuePersist** —— 因为同步引擎已自己写过 Dexie（`engine.ts:142` `rawTable(t).bulkPut`） | 必须自己保证库与内存一致 |
| `replaceAllData` | `useStore.ts:154-179` | 直接 `await repoByTable[t].bulkPut(...)`、清空两个栈（:176-177）、**手动 `emitLocalWrite()`**（:168） | 是"一次大操作"，不适合高频 |
| 同步引擎直读写 Dexie | `engine.ts:33-35` 注释：「同步引擎直接读写 Dexie 原始表（属数据层；**不得经 repo，repo 会重盖 updatedAt**）」 | 绕过 repo 的时间戳重盖 | 明确划定"数据层内部可以直连 Dexie" |
| 拖拽的高频→单次提交 | `docs/PROGRESS.md:121`：「拖拽中只直写被拖元素 style（move=transform、resize=left/width），React 仅在开始/结束渲染虚影」 | 高频阶段完全不碰 store，只在提交时一次 `execute` | **这是与番茄钟最同构的先例** |
| 瞬态 UI 状态 | `src/gantt/uiStore.ts`（独立 zustand，:1-5 注释「不持久化、不进 undo 栈」；细粒度 selector 订阅，:95-103 带 `if (get().x !== x)` 去抖）；`src/checkin/ExemptionManager` 的折叠状态用 `useState`（`PROGRESS.md:187`「不入库、不进 undo，刷新回到默认」） | 完全不落库 | 刷新即丢 |

### 3.4 如果绕开 `execute` 直接写 repo，具体会破坏什么

1. **内存 Map 不更新** ⇒ 所有 UI 与派生都读 store 的 `EntityMaps`（`useStore.ts:53`），不读 Dexie。写盘成功但界面不动，直到下一次 `hydrate()` —— 而 `hydrate` 只在 `App.tsx:83` 启动时跑一次。
2. **`BaseRepo.put/bulkPut` 会强行把 `updatedAt` 覆盖为 `nowISO()`**（`baseRepo.ts:30,34`）⇒ 你自己算好的时间戳被丢弃。这正是 `engine.ts:33` 注释里同步引擎必须绕过 repo 的原因。
3. **undo/redo 与库产生分歧（静默数据回滚）**：若同一实体先被绕开路径改过、之后又走 `execute`，undo 栈里更早那格的 `before` 快照已经过时；`invertChange`（`types.ts:68-81`）会把这个陈旧整行原样写回 —— 表现为"撤销一步，丢了好几步"。
4. **不触发 `emitLocalWrite()`** ⇒ 不启动 3 秒同步防抖（`engine.ts:224-231`）。数据只能等 `focus` / `visibilitychange` / `online` / 5 分钟周期（`engine.ts:216-232`）才上行。
5. **失去 `pending` Map 的同实体去重**（`persist.ts:32,68`「同一实体只保留最后一次操作」）⇒ 心跳会真的落 N 次盘，而不是被合并成 1 次。
6. **与同步的 `flushNow()` 顺序保证脱钩**：`syncNow` 开头必先 `flushNow()`（`engine.ts:93`，`PROGRESS.md:245`「同步开始必先 flushNow()，否则漏推」）。绕开 persist 的写入不在那个 pending Map 里，可能落在"同步已开始读 Dexie、你的写入还在自己的 timer 里"的窗口内 ⇒ 本轮漏推。
7. **导出/统计口径不一致**：`exportBundle()`（`useStore.ts:181-188`）读的是内存 map，不是 Dexie ⇒ 绕开路径写入的数据**不会进 JSON 备份**。

---

## 4. per-goal 派生缓存约定

### 4.1 机制（三层，全部【读码确认】）

**第 1 层 — 顶层引用短路**：`src/gantt/hooks/useGanttDerive.ts:60-69`
6 个输入（`goals/tasks/checkIns/exemptions/today/weekStartsOn`）引用全部 `===` 上一轮 ⇒ 直接 `return s.result`（连分组都不做，返回同一个 Map 引用，下游 memo 全不动）。

**第 2 层 — 稳定分组**：`src/lib/stableSlices.ts:6-27` `stableGroupBy`
按 `goalId` 分组后，逐组与上一轮比对「长度相同 且 `old.every((v,i)=>v===group[i])`」，命中就**沿用旧数组引用**（:19-25）。`useGanttDerive.ts:71-79` 只对引用变了的那张表重新分组。

**第 3 层 — per-goal 缓存条目**：`useGanttDerive.ts:86-97`
`CacheEntry{tasks, checkIns, exemptions, today, weekStartsOn, value}` 五项全 `===` ⇒ 复用上一轮 `GoalGantt`，跳过 `deriveGoalGantt`。`:115-118` 在 DEV 下把真实重算次数记到 `window.__ganttDeriveComputes`。

**上游的两条支撑约定**：
- 写入侧只替换受影响的表 map：`applyChanges`（`useStore.ts:43-51`，只对 `changes` 涉及的表做 `{...state[table]}`）、`applyRemote`（:194-201，`op.puts/deletes` 都空的表直接 `continue`）。
- 构造侧只为被改实体造新对象：`src/store/actions.ts:1-5` 文件头注释「铁律：只构造受影响实体的新对象，未动实体保持引用（per-goal 派生缓存依赖此约定）」；`docs/PROGRESS.md:69,120,243` 三处重复这条铁律。

### 4.2 番茄钟写入不遵守会怎样

- 【读码确认】`deriveGoalGantt`（`src/lib/derive/gantt.ts:118-175`）对每个目标要跑：每任务 `expandScheduledDays` + `statusByDateFor` + `getMissedDays` + `calcAutoProgress` + `weeklyHeat`，再加 `buildTracks` + `calcStreak` + 目标级 `weeklyHeat`。第 3 层缓存失效 = 整个目标这一坨全重算。
- 若番茄写入让 `checkIns` map 里**所有**实体换了对象身份（例如 `map[id] = {...e}` 全量重建），第 2 层的 `every(v===)` 对**每个目标**都失败 ⇒ 全部目标重算。基线对照：`PROGRESS.md:55`「打卡写入只重算相关目标（浏览器实测 delta=1 而非 5）」；`PROGRESS.md:63`「10 目标×8 任务×半年打卡（2070 实体）写入+派生+渲染 114ms」。
- 【读码确认】现成的同类事故记录：`PROGRESS.md:127`「**筛选 hideOthers 的过滤 map 必须 useMemo 保引用**，否则 useGanttDerive 顶层引用比较失效导致全量重算」。即第 1 层短路一旦破，即使第 2/3 层完好也要付出全量 `Object.values()` + 全量分组比对的代价。
- 【推断】若把番茄会话 map 作为第 7 个参数传进 `useGanttDerive`，而番茄钟每秒写心跳 ⇒ 每秒替换该 map ⇒ **第 1 层短路每秒失效一次**，每秒重跑 `Object.values(tasks/checkIns)` + 全量 `stableGroupBy` 比对（第 2/3 层仍能挡住 `deriveGoalGantt`，但顶层开销与 GC 压力是每秒一次）。同时 `useGanttDerive` 的 `CacheEntry` 若不含番茄字段，番茄数据的变化就无法让相关目标失效 —— 二者不可兼得。

---

## 5. `minutes` 口径与统计 roll-up 全路径

### 5.1 写入端（4 个源）

| 位置 | 行为 |
|---|---|
| `src/store/actions.ts:330-370` `setCheckIn` | :350 `minutes: args.minutes ?? existing.minutes` —— **覆盖语义，不累加** |
| `src/store/actions.ts:373-379` `patchCheckIn` | 直接整字段替换 |
| `src/checkin/GoalCheckCard.tsx:102-111` `saveMinutes` | chips `[10,15,30,60]`（:12）+ 自定义输入；:105-106 **点同一值 = 清除（`minutes: undefined`）**；无记录时自动造一条 `status:'done'` 的记录（:111） |
| `src/gantt/CheckinPopover.tsx:97-106` | 同上逻辑的第二份实现（chips 常量重复定义于 :14） |
| `src/seed/seedData.ts:99` | 种子随机 `[15,30,60,90]`，`skipped` 时为 `undefined` |

### 5.2 消费端（穷举，全部【读码确认】）

| 文件:函数 | 口径细节 |
|---|---|
| `src/lib/derive/review.ts:50-53` `monthlyGoalStats` | `minutes += c.minutes ?? 0`，过滤条件仅 `!c.deletedAt && c.goalId===goalId && c.date.startsWith(month)`。**不看 taskId、不看 status（skipped 也计）、同日多条直接相加不去重** |
| `src/lib/derive/review.ts:97-111` `minutesByGoalByMonth` | `if (c.deletedAt \|\| !c.minutes \|\| ...) continue`；按 `month(1-12) → goalId → minutes` 聚合 |
| `src/review/AnnualOverview.tsx:98-109` `hoursData` | 消费 `minutesByGoalByMonth`，`/60` 后 `round(…*10)/10` |
| `src/review/AnnualOverview.tsx:116-130` `totals`（投入总时长卡） | **不复用 review.ts，自己重新遍历 `checkIns` 累加**（:119-122）。`PROGRESS.md:193` 记明理由：「不累加已四舍五入的月值，避免误差累积」 |
| `src/pages/ReviewPage.tsx:88` | `totalMinutes = Σ stats[].stats.minutes`（来自 `monthlyGoalStats`） |
| `src/pages/ReviewPage.tsx:113-114, 214` | `fmtHours`：≥60 分显示小时（1 位小数），否则显示分钟；每目标一行 |
| `src/checkin/GoalCheckCard.tsx:217-219, 326` / `src/checkin/AdhocSection.tsx:28-30` | 单条记录展示「N分」 |

**不消费 `minutes` 的（重要事实）**：`streak.ts`、`heat.ts`、`scheduled.ts`（含 `calcAutoProgress`）、`dayPanel.ts`、`derive/gantt.ts`、`tracks.ts` —— 全部只看 `status`。⇒ **`minutes` 当前只影响复盘页与年度总览两处，对甘特图、进度、streak、热度零影响。**

### 5.3 引入「真实专注分钟」后会打架的每一处

1. **双计**：`review.ts:52` 只按 `goalId` 过滤。若新数据源也按目标 roll-up 相加，同一段时间会被"手填 60 分"和"番茄 4×25=100 分"重复计入。无字段可区分来源（`CheckIn` 没有 `source`）。
2. **去重口径不对称（已存在，会被放大）**：完成分用 `bestStatusByDate` 同日取最强（`review.ts:39` → `streak.ts:14-22`），时长用直接累加（`review.ts:50-53`）。同一函数内两套去重规则。
3. **`skipped` 也算时长**：`review.ts:52` 不排除 `status==='skipped'` 的 `minutes`。现网看不出来只因种子数据的 skipped 是 `undefined`（`seedData.ts:99`），但 UI 上「跳过」后仍能点分钟 chips（`GoalCheckCard.tsx:102-111` 不校验 status）。
4. **一天多段无法表达**：upsert 键是「目标+任务+日期」（`actions.ts:319-328`），`minutes` 是覆盖（:350）⇒ 一天 4 个番茄写进 CheckIn 只能覆盖或由调用方 read-modify-write 累加，二者都与「点同一 chip 清除」（:105-106）的 toggle 语义冲突。
5. **年度两条独立计算路径**：`AnnualOverview.tsx:99`（经 `review.ts`）与 `:116-130`（自己算）。新数据源必须两处同改，否则「堆叠面积图的 12 个月合计」与「投入总时长卡」互相打架。
6. **月/年两套代码**：`ReviewPage.tsx:88` 的月度合计 vs `AnnualOverview.tsx:127` 的年度合计，分属两个文件两套遍历。
7. **语义不同**：SPEC:276/277 的用词是「投入总时长」；番茄的「专注时长」不含中断与休息。混成同一个数字后，历史手填 60 分与番茄 4×25 分不可比、不可分离、不可回滚。
8. **chips 高亮回退**：`GoalCheckCard.tsx:129` / `CheckinPopover.tsx:177` 用 `record?.minutes === m` 判断高亮。番茄自动写入非 chip 值（如 87）⇒ chips 全不亮，输入框 placeholder 走 `${record.minutes}分` 分支（:163 / :206）—— 用户以为没保存。
9. **校验无约束**：`backup.ts:66` `minutes: z.number().optional()` 无上下界、无来源标记 ⇒ 导入的历史备份不可区分来源，且没有迁移抓手。

---

## 6. 云同步对新表的具体影响

### 6.1 LWW 整行覆盖对 append-only 数据是否合适

- 【读码确认】冲突裁决两处：客户端 `merge.ts:9-15` `remoteWins`（`remote.updatedAt > local.updatedAt`，ISO 字符串字典序）；服务端 `0001_init.sql:90` `where excluded.updated_at > %1$I.updated_at`。
- 【推断，机制明确】**对 append-only 会话表，整行 LWW 基本无害**：每条会话是独立 `id`（nanoid），两台设备产生的是不同行，`on conflict (user_id, id)` 永不命中 ⇒ 只是两批 insert，不丢数据。这与方案 (b) 的"累加进单行"形成鲜明对比（那种情况下 LWW 必然丢数）。
- 【推断】**唯一的真实风险是"同一条运行中的会话被两端写"**：例如 A 机启动会话后写 `status:'running'` + 心跳，B 机（同一账号、拉到该行）点了"结束"写 `status:'completed'`。行级 LWW ⇒ `updatedAt` 大的整行赢 ⇒ 后到的一次心跳可以把 `completed` 整行覆盖回 `running`。
- 【读码确认】更严重的是**时钟决定胜负**：`engine.ts:17-18` 注释明言「推送游标 = 本地 `updatedAt`（本地写入全用本机时钟，自洽）」，`baseRepo.ts:4` `nowISO() = new Date().toISOString()`。⇒ 手机比电脑快 5 分钟时，手机的写入**永远**赢过电脑此后 5 分钟内的任何修改。拉取游标用了服务端 `clock_timestamp()`（`0001_init.sql:11-19`）恰恰是为了避开客户端时钟，但**冲突裁决本身没有**。

### 6.2 两台设备同时开番茄钟会发生什么

【推断，基于已确认机制】
- 若两端各自建独立会话行（不同 id）：两条 running 会话共存，同步后**两端都能看到两条**。数据不丢，但 UI 若假定"最多一个 running 会话"就会出现两个正在跑的计时器。这是应用层不变量问题，不是同步层问题。
- 触发链密度：`engine.ts:224-231` 本地写入 → 3 秒防抖 → `syncNow`；`:232` 每 5 分钟；`:216-219` focus/visibilitychange。⇒ 如果心跳每秒写一次并走 `persist`（`emitLocalWrite` 在 `persist.ts:53`），3 秒防抖会被**不断重置**（`clearTimeout` 在 :226）⇒ **番茄运行期间同步被无限推迟**，直到停止写入 3 秒后才推。这是一条容易忽略的连带效应。
- `syncNow` 有单飞 + 补跑（`engine.ts:78-113` `syncing` / `rerunAfter`），不会并发；但每一轮都要遍历**全部 7 张表**做拉取查询（`:119-149`，每表至少一次 HTTP）。

### 6.3 墓碑清理会不会误删历史会话

**不会。**【读码确认】
- 本地：`engine.ts:183-185` 过滤条件是 `e.deletedAt && e.deletedAt < cutoff && cursors.push && e.updatedAt <= cursors.push` —— 三个条件的第一个就要求 `deletedAt` 存在。历史会话没有 `deletedAt` ⇒ 永不被删。`TOMBSTONE_TTL_MS = 30 天`（`:41`）。
- 云端：`engine.ts:187` `sb.from(...).delete().lt('deleted_at', cutoff)`。Postgres 里 `NULL < timestamp` 求值为 NULL（非 true）⇒ `deleted_at IS NULL` 的行不匹配 ⇒ 不删。
- 【读码确认】真正的代价在**性能**而非误删：`engine.ts:183` 是 `(await rawTable(t).toArray()).filter(...)` —— **对每张表做全表 `toArray()` 到内存再 JS 过滤**，每个浏览器会话跑一次（`cleanedThisSession`，`:75, :98-100`）。番茄表几万行时，这是每次开页一次全表反序列化。且云端 delete 依赖 `deleted_at` 列（未建索引，`0001_init.sql:41-44` 只建了 `(user_id, server_updated_at)`）。

---

## 7. 数据量估算

### 7.1 现网真实基数（读 `data_bak/*.json` 实测）

| 备份 | goals | tasks | milestones | checkIns | exemptions | reviews | 单条 checkIn 平均 JSON 字节 |
|---|---|---|---|---|---|---|---|
| 2026-07-21 | 6 | 15 | 3 | 169 | 1 | 0 | 223 |
| 2026-07-29 | 8 | 29 | 2 | 300 | 1 | 2 | 217 |

⇒ **全库当前约 340 行、110 KB JSON**（约 7 个月使用量）。checkIns 年增速约 500 行/年。

### 7.2 番茄会话的量级

【推断，算术】
- 8-16 会话/天 ⇒ 2 920 - 5 840 行/年 ⇒ **单年就是现有 checkIns 年增量的 6-11 倍，是当前全库行数的 8-17 倍**。
- 单行字段估计（id 21 + goalId + taskId + date + startedAt/endedAt ISO + plannedMinutes + actualSeconds + status + interruptions + updatedAt）≈ 250-350 字节 JSON。
- 5 年累计：**14 600 - 29 200 行 / 约 3.6 - 10 MB JSON**。

### 7.3 各环节的具体影响

| 环节 | 位置 | 影响 |
|---|---|---|
| IndexedDB 容量 | — | 【推断】10 MB 级别对 IndexedDB 配额（通常百 MB 以上）无压力。**容量不是瓶颈。** |
| hydrate 全量载入 | `useStore.ts:84-104` → `baseRepo.ts:18-21` `table.toArray()` + JS filter | 【读码确认机制】每次冷启动把**整表**反序列化进内存，不吃索引、不分页。行数从 ~340 涨到 ~30 000 = 约 85 倍。【推断】3 万个小对象的 structured-clone 反序列化在数十至上百毫秒量级 —— 直接压在 CLAUDE.md「首屏 <1s」的门槛上，且 `App.tsx:148-150` 在 `hydrated` 前只显示"载入中…" |
| 内存 Map | `useStore.ts:36-40` `toMap` | 3 万键的 `Record`，常驻内存 |
| `Object.values()` | 各页 `useMemo`（如 `ReviewPage.tsx:67-70`、`CheckInPage.tsx:48-51`、`useGanttDerive.ts:72,75`） | 【推断】任一相关 map 引用变化就重新分配一个 3 万元素数组；若番茄数据进了任何每帧/每秒变化的路径，就是每秒一次 3 万元素分配 |
| 同步首次全量推 | `engine.ts:158-174`，无 push 游标时 `table.toArray()`；`PUSH_CHUNK_SIZE = 500`（:38） | 【推断】3 万行 = **60 次 `upsert_rows` RPC**，每次一个 jsonb 数组（~150 KB）。串行 for 循环（:161），无并发 |
| 新设备首次全量拉 | `engine.ts:122-135`，`PULL_PAGE_SIZE = 1000`（:37） | 【推断】3 万行 = **30 次串行分页请求**，每页后 `saveCursors` 写 localStorage（:147-148） |
| 每轮同步的增量拉 | `engine.ts:119-149` | 每张表至少一次 HTTP，7 表 ⇒ 每轮 7+ 次请求；触发频率见 §6.2 |
| 墓碑清理 | `engine.ts:180-190` | **每个浏览器会话一次全表 `toArray()`**（见 §6.3），番茄表最贵 |
| 增量推的脏行扫描 | `engine.ts:159` `where('updatedAt').above(cursor)` | 走索引，行数无关 ⇒ **这是唯一天然可扩展的环节，前提是新表建了 `updatedAt` 索引** |
| JSON 备份 | `useStore.ts:181-188` `exportBundle()` + `backup.ts:144` `JSON.stringify(backup, null, 2)` | 【推断】`null, 2` 缩进使体积膨胀约 1.5-2 倍 ⇒ 5 年后单个备份文件 10-20 MB，且是同步阻塞的字符串构建 + zod 全量校验（导入侧 `backup.ts:173`） |
| zod 导入校验 | `backup.ts:173` `backupSchema.safeParse` | 【推断】3 万条逐条校验，主线程同步 |

### 7.4 需要什么分片/裁剪/归档（只列事实与现成抓手，不设计方案）

- 【读码确认】**现有架构里没有任何分片/裁剪机制**：`hydrate` 是"全表进内存"，`exportBundle` 是"内存全量出 JSON"，同步是"全表按 updatedAt 增量"。CLAUDE.md 的性能门槛只针对「全年×10 目标×各 8 任务×365 天」，即约 3 000 条 checkIn 量级 —— **番茄数据的单年量就与这个上限同阶或更高**。
- 现成的可用抓手（都已存在，无需新建机制）：
  - **按日期范围查询的索引先例**：`schema.ts:33` 的 `[goalId+date]` 复合索引 + `repos/index.ts:16-22` `getByGoalAndRange`（`where('[goalId+date]').between(...)`）—— 这是全仓唯一一个"不全量载入、按范围查"的 repo 方法，虽然目前无调用点（§0），但**它就是"番茄表不进 hydrate、按需按范围查"的现成模板**。
  - **懒加载分包先例**：`ReviewPage` 走 `lazy()`（`App.tsx:19`），recharts 与 supabase-js 都切了异步分包（`PROGRESS.md:155, 237`）。
  - **派生结果缓存先例**：`useGanttDerive` 的 per-goal `CacheEntry`（§4）。
  - **聚合入库 vs 派生**：CLAUDE.md 铁律「派生数据不入库」。若要避免全量载入，"每日/每月聚合分钟数"要么现算（需要全量数据）要么入库（违反铁律）—— 这是一个**需要在方案阶段显式取舍的既有约束冲突**，不是可以两全的。
  - **归档的软删除语义已被占用**：`deletedAt` 语义是"已删除，30 天后真删"（`engine.ts:180-190`）。不能借用它做"已归档"，否则会被墓碑清理物理删掉。

---

## 8. 一页速查：改动点索引

```
src/types/domain.ts:71-82,134-138        实体定义 / SyncableEntity 约束
src/db/schema.ts:19-25,29-37             Table 字段 / version(2)
src/db/repos/baseRepo.ts:10,18-21,30,34  泛型约束 / 全量载入 / updatedAt 重盖
src/db/repos/index.ts:16-22,43-49,52-61  范围查询模板 / repo 实例 / clearAllData(死代码)
src/store/types.ts:11-18,22-29,48-55,58-65   EntityOf/TABLE_NAMES/EntityMaps/DataBundle
src/store/useStore.ts:30,32-34,43-51,84-104,106-114,143-147,154-179,181-188,190-204
                                          栈上限/emptyMaps/applyChanges/hydrate/execute/settings/replaceAll/export/applyRemote
src/store/persist.ts:16-23,25,32,53,65-83  repoByTable/500ms/去重Map/emitLocalWrite/flushNow
src/store/actions.ts:1-5,319-328,340-370,373-379   写入铁律注释 / findCheckIn / setCheckIn / patchCheckIn
src/lib/backup.ts:9,60-71,97-102,112-117,119-132,148-155   版本/checkInSchema/.default先例/settingsSchema/data/migrate
src/db/sync/engine.ts:17-18,24-31,33-35,37-41,49,93,119-151,154-177,180-190,216-232
                                          时钟说明/REMOTE_TABLE/rawTable/常量/游标/flushNow/pull/push/tombstone/触发链
src/db/sync/merge.ts:9-15,31-51            LWW 裁决 / planPullApply
src/lib/stableSlices.ts:6-27               stableGroupBy
src/gantt/hooks/useGanttDerive.ts:60-69,71-79,86-97   三层缓存
src/lib/derive/review.ts:50-53,97-111      minutes 两处口径
src/review/AnnualOverview.tsx:98-109,116-130   年度两条独立路径
src/pages/ReviewPage.tsx:88,113-114,214    月度合计 / fmtHours
src/pages/SettingsPage.tsx:11-18,53,67     TABLE_LABEL(无护栏)/counts/清空字面量
src/seed/seedData.ts:99,114                种子 minutes / bundle 字面量
src/gantt/uiStore.ts:1-5,95-103            瞬态 store 先例
supabase/migrations/0001_init.sql:11-19,22-65,26,41-44,71-93,76,90
                                          触发器/DO块幂等/表名数组/索引/RPC/白名单/服务端LWW
node_modules/dexie/dist/dexie.js:3811-3900,4096-4110,4560-4572   升版语义/stores累积/无升版补丁模式
docs/PROGRESS.md:55,63,69,120-121,127,187,193,209,241-250,269-271   历次决策与实测基线
```