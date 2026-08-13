# 番茄钟模块规格书（YearFlow SPEC 扩展）

> 本文档是 `docs/SPEC.md` 的扩展章节。与 `docs/SPEC.md` 冲突时，**在番茄钟范围内以本文档为准**；范围之外一切照旧。
>
> 前置事实依据在 `docs/pomodoro/`（勘察与研究报告，区分了【读码确认】与【推断】）：
> - `01-facts-data-layer.md` —— 加表的逐处改动清单、undo 链路、`minutes` roll-up 全路径、数据量估算
> - `02-facts-ui-seams.md` —— 每个接入点的 `path:line`、常驻位与 z-index、已占用快捷键、本机验证盲区
> - `03-facts-web-platform.md` —— 定时器节流、计时正确性、中断恢复、通知/声音/多标签
> - `04-facts-product-tradeoffs.md` —— 成熟产品取舍、P0/P1/P2 能力清单、坑清单
>
> 本文档给出的数值一律按值执行；没给的地方按「Linear 会怎么做」决策。

---

## 一、定位与设计目标

番茄钟是 YearFlow 的**第五个页面级能力**，但它不抢主战场：甘特图仍是首页，番茄钟是「日常工作时挂在顶栏的一根秒表」。

它解决两个问题：

1. **专注**：工作时开一段 25 分钟的计时，到点提醒，形成节律。
2. **真实投入统计**：现有 `CheckIn.minutes` 是手填估算（chips 10/15/30/60），只能表达「这天这个任务大概花了多久」。番茄钟提供**按任务的真实专注时长**，让年度总览的「投入时长」从估算升级为实测。

### 设计目标（按优先级，冲突时上位胜出）

1. **不污染既有体系**：打卡语义、streak、热度、点阵、进度、131 个既有单测，一处不动。
2. **数据正确性优先于便利**：宁可多一次点击，也不要出现「同一天两个互相打架的时长数字」或「跨设备静默丢数」。
3. **计时必须准**：后台、休眠、崩溃、多标签都不能让时长记错。时长的唯一权威是墙钟差值，不是 tick 累加。
4. **安静**：顶栏一枚胶囊 + 到点两声轻提示音。不做大动效、不做成就系统、不抢注意力。
5. **可中断可恢复**：任何时刻关页面、崩溃、合盖，重开后要么无缝续跑，要么给出一次明确的「刚才那段算不算」选择。

### v1 范围

**纯桌面**（Chrome/Edge 为主战场）。移动端 `<768px` **隐藏番茄钟全部入口**——iOS 进后台/锁屏会直接挂起 JS（不是变慢而是停），无法承诺后台准点，与其给一个会记错时间的计时器，不如不给。

---

## 二、非目标（明确不做，及原因）

| 不做 | 原因 |
|---|---|
| 自动把专注时长累加进 `CheckIn.minutes` | 整行 LWW 下累加语义不安全（两设备各 +25 会变成 25 而非 50，静默丢数）；手填与自动挤在一个标量字段里不可审计 |
| 番茄完成自动把当天标记 `done` | streak 会从「我承认我做了」退化为「我开过计时器」；随手开一个番茄试音效就能伪造 streak，且几乎无法察觉 |
| 自动闲置扣时 / `IdleDetector` API | 只观测、不猜测。把判断权交给用户的一次点击（结算对话），成本低且不会误判 |
| Service Worker 后台续命 / Web Push 预约通知 | Notification Triggers 从未正式发布；真正的后台准点需要服务端 + VAPID，对单人工具是过度设计 |
| 改动 PWA / Service Worker 配置 | v1 纯桌面，`new Notification()` 足够（MDN：该构造器在几乎所有**移动**浏览器抛 `TypeError`，桌面可用）。改 SW 会引入「已 code-split 的懒加载 chunk 在部署后 404」风险区（详见 `03-facts` §9） |
| 保活音频（播静音流换取不被节流） | Chrome 的豁免条件是「近期发出过**可听**声音」，零振幅通常判不到；副作用是标签页扬声器图标常亮、抢占系统媒体会话、蓝牙耳机被占用——「安静」气质全毁 |
| Web Worker 跑 tick | 最多把「1/min」改善回「~1s」，买不到「页面被冻结」和「iOS 后台」。隐藏时没人看数字，不值这个复杂度 |
| 严格模式（禁暂停）/ 网站拦截 / 多套节律 profile / 每任务独立时长 | 单人工具的配置膨胀 |
| 白噪音、音效包、成就徽章、连胜动画 | 与「安静克制」气质冲突 |
| 番茄**个数**进复盘统计 | 权威口径只有一个：专注分钟。个数只在面板里作节奏展示（第几段） |
| 休息落库成记录 | 休息不是投入，存了只会污染统计与同步流量 |
| 一个会话跨多个任务的时间分摊 | 分摊比例无法可信获得。进行中切任务 = 切分成两条会话 |
| 自定义「日切换点」 | 项目铁律是一天边界 = 本地 00:00，全项目一种算法 |
| 动态 favicon 倒计时 | 会破坏 `index.html:5` 已有的 SVG 年度进度环图标（品牌一致性），且 Safari 对动态 favicon 支持历来不稳 |
| 移动端任何入口（v1） | 见 §一「v1 范围」 |

**留到 P1（本文档 §十三 升级路径）**：全屏专注模式、会话列表页与编辑界面、`自动开始休息`/`自动开始下一段`、日目标、`needsReview` 徽标确认流、复盘「专注段数/平均段长/被打断率」三指标、Screen Wake Lock。

---

## 三、领域模型

追加到 `src/types/domain.ts`（紧邻 `CheckIn`，`domain.ts:71-82` 之后）。必须满足 `SyncableEntity`（`domain.ts:134-138`），否则 `BaseRepo<T extends SyncableEntity>`（`db/repos/baseRepo.ts:10`）泛型约束不过。

```typescript
/** 一次暂停（ISO 时刻对）。until 缺省 = 该暂停尚未结束（仅出现在运行中状态，落库时必闭合） */
export interface FocusPause {
  at: string;    // ISO
  until?: string; // ISO
}

/**
 * 会话结局：
 * completed = 跑到计划终点（含"到点自动结算"与"恢复时按计划终点结算"）
 * stopped   = 用户提前停止，按实际净时长记账
 * discarded = 用户主动丢弃 / 恢复时选择"不算"，**不计入任何统计**（留痕仅供审计）
 */
export type FocusOutcome = 'completed' | 'stopped' | 'discarded';

/**
 * 专注会话 = 一次专注（不是"一个番茄"）。是「真实投入时间」的唯一事实来源。
 * 只有**已结束**的会话入库；运行中状态在 localStorage（见 §五），不入库、不同步、不进 undo。
 * 行语义近似不可变：**不含任何需要累加的字段** —— 这正是 append-only 行在整行 LWW 下天然安全的原因。
 */
export interface FocusSession {
  id: string;              // nanoid。运行开始时预生成并存进 localStorage，结算时作为落库 id ⇒ 天然幂等（多标签/重复结算不会写两条）
  goalId?: string;         // 缺省 = 未归类（面板常驻"N 段未归类"清理入口）
  taskId?: string;         // 缺省 = 只挂到目标，或完全未归类
  date: string;            // YYYY-MM-DD。从 startAt 派生一次后**冻结在字段里**，绝不每次显示时重算（跨时区旅行会让整片历史漂移）
  startAt: string;         // ISO，专注开始时刻
  endAt: string;           // ISO，结算时刻
  focusMs: number;         // 净专注毫秒：已扣暂停、已 clamp。**结算后的权威值，不由 pauses 反算**（避免重放歧义）
  plannedMs: number;       // 计划专注毫秒（结算截断上限）。手动补录时 = focusMs
  pauses?: FocusPause[];   // 审计与展示用；空数组不写（保持行紧凑）
  outcome: FocusOutcome;
  source: 'timer' | 'manual'; // manual = 手动补录或事后编辑过时长。手动路径故意比计时路径不方便一点，但标记中性、不惩罚
  needsReview?: boolean;   // 结算异常待人确认（时钟跳变 / 超长 / 长时间失联后补算），UI 给徽标
  note?: string;           // 一句话备注
  createdAt: string;
  updatedAt: string;       // 见 §四「同步的一个坑」：补录/编辑一律用**当前时间**，不用会话发生时间
  deletedAt?: string;      // 软删除
}
```

### 逐字段口径

- **`focusMs` 为什么存而不派生**：结算时要做 clamp 与截断（§五），这些决策只做一次。存下来使统计成为纯求和、跨设备不会因重放规则变化而漂移；`pauses` 只作审计。
- **`plannedMs` 为什么要存**：结算上限。计时会话 `focusMs ≤ plannedMs` 恒成立（到点即自动结算），因此「休眠 3 小时」结构上不可能记成 3 小时。
- **`date` 冻结**：跨天会话（23:50 开始）**按开始日整段归属**，与「一天边界 = 本地 00:00」铁律一致。所有统计**只认 `date` 字段**，禁止任何地方改用 `startAt` 算月份——否则跨月的会话会在两张图里各算一次或都不算。
- **`outcome=discarded`**：不计入 `effectiveMinutes`、不计入复盘任何数字。为什么还留行：误触与「刚才那段不算」是高频操作，留痕才能事后查证，且删除有 undo 成本。
- **`< 60s` 不落库**：误触噪音防线。结算函数返回 `null`，不产生命令、不进 undo。
- **`source`**：`manual` 出现在两种情况——手动补录一段、事后编辑过时长。展示为中性徽标「手动」，不做任何降权。

### 设置（`AppSettings`，`domain.ts:123-131`）

```typescript
/** 番茄钟偏好。属设备本地偏好（settings 不同步，见 §四），故换设备需各配一次 */
pomodoro: {
  focusMin: number;       // 默认 25
  shortBreakMin: number;  // 默认 5
  longBreakMin: number;   // 默认 15
  longBreakEvery: number; // 默认 4（每 4 段专注后进长休息）
  sound: boolean;         // 默认 true
  notify: boolean;        // 默认 false（需浏览器授权，开启时才请求权限）
};
```

只此 6 项。**必须同步补进 `src/lib/backup.ts:112-117` 的 `settingsSchema`**，用 `.default(...)`（既有写法见 `backup.ts:97,101,102`）——zod 默认 strip 未声明键，漏了就是「导入备份后番茄设置被静默丢弃」，`AppSettings.colorNormalized` 已经是现成受害者（`01-facts` §0）。

---

## 四、存储 / 同步 / 备份改动清单

表名：本地 `focusSessions`，远端 `focus_sessions`。逐处清单见 `01-facts` §1.1（12 文件 / 约 20 点）。以下是**必须逐项打勾**的清单，其中标 ⚠️ 的三处**漏改不会编译报错**。

### 4.1 本地

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `src/types/domain.ts` | 新增 `FocusPause / FocusOutcome / FocusSession` + `AppSettings.pomodoro`（§三） |
| 2 | `src/db/schema.ts:19-25` | 加类字段 `focusSessions!: Table<FocusSession, string>;` |
| 3 | `src/db/schema.ts:29-37` | **新增 `this.version(2).stores({ focusSessions: 'id, goalId, taskId, date, updatedAt, [goalId+date]' })`**。只需声明新表，version(1) 的 7 张表自动继承（`Version.prototype.stores` 对 `_versions` 累积，dexie.js:4096-4110）；既有数据不会丢（`getSchemaDiff` 只对 `diff.add` 建表，dexie.js:3811-3900）。**不升版号也能跑但走官方 workaround 补丁路径 + 控制台警告，不接受** |
| 4 | `src/db/repos/index.ts:43-49` | `export const focusRepo = new BaseRepo<FocusSession>(db.focusSessions);` |
| 5 | `src/db/repos/index.ts:52-61` | `clearAllData` 加一行（该函数目前是死代码，仅为一致性） |
| 6 | `src/store/types.ts:11-18` | `EntityOf` 加键（加了它，第 8/9/10 项会自动编译报错，是主要护栏） |
| 7 ⚠️ | `src/store/types.ts:22-29` | **`TABLE_NAMES` 加 `'focusSessions'`**。这一个数组驱动同步三循环（`engine.ts:119/156/182`）、`replaceAllData`、`exportBundle`、`applyRemote`、设置页计数。**漏加不报错 ⇒ 新表永不同步、不导出、不进墓碑清库。这是全清单最危险的一处** |
| 8 | `src/store/types.ts:48-55` | `EntityMaps` 加键 |
| 9 | `src/store/types.ts:58-65` | `DataBundle` 加键 |
| 10 | `src/store/useStore.ts:32-34` | `emptyMaps()` 加键（硬编码 6 键） |
| 11 ⚠️ | `src/store/useStore.ts:84-104` | `hydrate`：import repo + `Promise.all` 数组项 + **`set({...})` 的键**。`set()` 缺键**不报错**（Partial 语义）⇒ 表存在但内存永远为空 |
| 12 | `src/store/persist.ts:16-23` | `repoByTable` 加条目（`Record<TableName,...>` 强护栏 ✅） |
| 13 | `src/lib/backup.ts` | 新增 `focusSessionSchema`；`backupSchema.data`（:119-132）加键，用 **`.default([])`**（否则老备份导入直接失败）；`settingsSchema`（:112-117）加 `pomodoro` 带默认值 |
| 14 | `src/lib/backup.test.ts:11` | `toEqual(bundle)` 会因 `.default([])` 多出空数组而失败 → 同步改 seed（第 16 项）或补断言 |
| 15 | `src/db/sync/engine.ts:24-31` | `REMOTE_TABLE` 加 `focusSessions: 'focus_sessions'`（强护栏 ✅） |
| 16 | `src/seed/seedData.ts:114` | bundle 字面量加键（哪怕 `[]`），否则 `replaceAllData` 在 `bundle[t].map` 上抛 TypeError |
| 17 | `src/pages/SettingsPage.tsx:67` | 「清空全部数据」的字面量 7 键加一 |
| 18 ⚠️ | `src/pages/SettingsPage.tsx:11-18` | `TABLE_LABEL` 加 `focusSessions: '专注会话'`。类型是 `Record<string,string>` ⇒ **漏加不报错**，界面渲染出 `undefined` |
| 19 | `src/store/actions.ts` | 新增番茄命令（§4.3）；`deleteTask`/`deleteGoal` 级联软删该范围内的会话，并把数量计入 confirm 文案 |
| 20 | `docs/SPEC.md` §三 / §十 | 按 CLAUDE.md「唯一事实来源」铁律补 `FocusSession` 与「第 7 张表」；`docs/PROGRESS.md` 追加决策记录 |

**索引一次到位**（第 3 项）：`id, goalId, taskId, date, updatedAt, [goalId+date]`
- `updatedAt` 是**同步推送的硬依赖**（`engine.ts:159` `where('updatedAt').above(...)`），不建会抛 `SchemaError`。
- `date` 是将来「窗口化载入」（§十容量红线）的必需索引；现在建好，将来切换无需再升 `version(3)`。
- `[goalId+date]` 对齐既有 `checkIns` 的复合索引形状，为按目标按日范围查预留（模板：`repos/index.ts:16-22` `getByGoalAndRange`）。

### 4.2 Supabase：`supabase/migrations/0002_focus_sessions.sql`

`0001_init.sql` 整体幂等，但**不要改 0001**——写 0002，其中 `upsert_rows` 用 `create or replace`（签名不变）整段覆盖即可。表名静态，故不需要 0001 那样的 DO 块。

```sql
-- YearFlow 0002：番茄钟专注会话表
-- 在 Supabase Dashboard → SQL Editor 整段执行一次。可重复执行（幂等）。

create table if not exists public.focus_sessions (
  id text not null,
  user_id uuid not null default auth.uid(),
  data jsonb not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

-- 增量拉取索引：where user_id = ? and server_updated_at > ?
create index if not exists focus_sessions_pull_idx
  on public.focus_sessions (user_id, server_updated_at);

alter table public.focus_sessions enable row level security;

-- RLS：只允许操作自己的行。漏了这段则表对所有登录用户可读
drop policy if exists focus_sessions_own_rows on public.focus_sessions;
create policy focus_sessions_own_rows on public.focus_sessions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- server_updated_at 触发器：漏了则 update 不刷新该列，
-- 该表的增量拉取游标永久停滞，其它设备再也拉不到更新（engine.ts:120-134 完全依赖它）
drop trigger if exists focus_sessions_touch on public.focus_sessions;
create trigger focus_sessions_touch
  before insert or update on public.focus_sessions
  for each row execute function public.touch_server_updated_at();

-- 扩展 upsert_rows 的表名白名单（0001_init.sql:76 是硬编码的）。
-- 签名不变，create or replace 覆盖即可，无需改 0001。
create or replace function public.upsert_rows(p_table text, p_rows jsonb)
returns void
language plpgsql
as $$
begin
  if p_table not in ('goals', 'tasks', 'milestones', 'check_ins', 'exemptions', 'reviews', 'focus_sessions') then
    raise exception 'upsert_rows: 非法表名 %', p_table;
  end if;
  execute format($sql$
    insert into public.%1$I (id, data, updated_at, deleted_at)
    select r->>'id',
           r->'data',
           (r->>'updated_at')::timestamptz,
           (r->>'deleted_at')::timestamptz
    from jsonb_array_elements($1) as r
    on conflict (user_id, id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      where excluded.updated_at > %1$I.updated_at
  $sql$, p_table) using p_rows;
end;
$$;
```

**用户需要做的唯一一件事**：登录 Supabase Dashboard → SQL Editor → 整段粘贴上面的 0002 → Run 一次。
不做这一步的后果：本地功能完全正常，但**该表永不同步**，且每轮同步会在控制台报 `推送 focus_sessions 失败：...`（`engine.ts:172`）。README 需补这一步。

### 4.3 写入路径与 undo 语义

铁律：**运行中状态一律不进 `useStore`**，只有「一次已结束的会话」走一次 `execute`。

理由（`01-facts` §3）：一次 `execute` = 恰好一格 undo，栈上限 100（`useStore.ts:30`）；一天几十次写入会把甘特图的编辑（拖 bar、改名、批量平移）全部挤出栈，`Ctrl+Z` 变成「撤销番茄心跳」；且 `execute` 无条件 `redoStack: []`（`useStore.ts:111`），番茄后台写入会持续清空重做栈，让 `Ctrl+Shift+Z` 在番茄运行期间形同失效。这是功能性破坏，不只是性能问题。

与之同构的既有先例：拖拽「高频阶段只直写 DOM、落手才提交一次 `execute`」（`PROGRESS.md:121`）。

新增 action（全部在 `src/store/actions.ts`，遵守文件头铁律「只构造受影响实体的新对象，未动实体保持引用」）：

| action | label（undo toast 文案） | 说明 |
|---|---|---|
| `commitFocusSession(session)` | `记录专注 25 分钟「MM 模块」` | 结算落库，一条命令。`< 60s` 时调用方已早退，不到这里 |
| `addManualFocusSession(args)` | `补录专注 40 分钟「MM 模块」` | `source: 'manual'`，`plannedMs = focusMs` |
| `updateFocusSession(id, patch)` | `修改专注记录` | 改时长即置 `source: 'manual'`；改归属不改 source |
| `deleteFocusSession(id)` | `删除专注记录` | 软删 |
| `reassignFocusSession(id, {goalId, taskId})` | `改归属为「英语 · 听力」` | 未归类清理入口用 |

**心跳绝不走 `persist`**：`persist.ts:53` 在落库后 `emitLocalWrite()` → 同步引擎 3 秒防抖（`engine.ts:224-231`）。若心跳每 5 秒写一次并触发它，`clearTimeout` 会**不断重置**那个防抖 ⇒ 番茄运行期间云同步被无限推迟，直到停止写入 3 秒后才推。运行中状态因此只写 localStorage（同步 API，无防抖，崩溃也只丢最后一次心跳间隔）。

### 4.4 同步行为与一个坑

- **append-only 行在整行 LWW 下天然安全**：每条会话独立 `id`（nanoid），两台设备产生的是不同行，`on conflict (user_id, id)` 永不命中 ⇒ 只是两批 insert，不丢数据。这与「累加进单行」形成鲜明对比（后者在 LWW 下必然丢数）。
- **不设「全局唯一 running」不变量**：运行中状态不同步，两台设备各跑一个番茄各自结算成独立行，都计入统计——这是正确行为，不是冲突。
- **墓碑清理不会误删历史会话**：过滤条件第一项就是 `e.deletedAt` 存在（`engine.ts:184`）；云端 `delete().lt('deleted_at', cutoff)` 对 `NULL` 求值非 true。代价在性能（每浏览器会话一次全表 `toArray()`），见 §十。
- ⚠️ **首次同步的坑（必须靠约定绕开）**：拉取游标是 per-table 且缺省 `EPOCH` ⇒ 新表自动全量拉，没问题。但**推送游标是全局单值** `cursors.push`（`engine.ts:49,158,175`）：老用户 localStorage 里已有游标，`where('updatedAt').above(cursors.push)` ⇒ **新表中 `updatedAt` 早于该游标的行永远不会被推送**。正常新建会话的 `updatedAt` 都在游标之后，所以不出问题；但「补录历史会话时把 `updatedAt` 写成会话发生时间」会**静默漏推**。
  **约定**：`updatedAt` 永远是「这行最后一次被写的真实时刻」，业务时间只放 `startAt`/`date`。补录 1 月的会话，`updatedAt` 也是今天。

---

## 五、计时内核

### 5.1 铁律

1. **绝不 tick 累加**（`elapsed += 1000`）。后台节流会把计时器变成慢表：Chrome 的 intensive throttling 档下 25 分钟能「走」出几分钟。
2. **时长的唯一权威是 `Date.now()` 差值**。`performance.now()` 只做两件事：探测 `Date.now()` 跳变、驱动动画。规范要求 `performance.now()` 在系统睡眠期间继续走，但 Chrome/Firefox/Safari 在若干平台上都不合规 ⇒ 合盖后两者之差可能达几小时，这个差正是最好的跳变探测器。
3. **剩余时间 = f(持久化记录, `Date.now()`)**，每次需要时现算。因此多标签的显示一致性是免费的（同一台机器同一个时钟，各算各的结果必然相同）。
4. **绝不用 rAF 驱动倒计时**：本机浏览器面板 `document.hidden === true`，rAF 一帧都不会来；真实后台标签页里 rAF 也停摆。

### 5.2 运行中状态（localStorage，不入库、不同步、不进 undo）

key：`yearflow:pomodoro:running`（值为 JSON；清空 = 删 key）

```typescript
interface RunningState {
  sessionId: string;       // 预生成的 nanoid，结算时作为落库 id ⇒ 重复结算幂等
  phase: 'focus' | 'shortBreak' | 'longBreak';
  goalId?: string;
  taskId?: string;
  startAt: number;         // Date.now()，本段开始
  plannedMs: number;
  pauses: { at: number; until?: number }[]; // 末条 until 缺省 = 正在暂停中
  cycleIndex: number;      // 本轮已完成的专注段数，驱动长休息节律
  lastHeartbeatAt: number; // 心跳（见 5.4）
  clockAnchor: { wall: number; mono: number }; // Date.now() / performance.now() 配对
}
```

- 为什么用 localStorage 而不是 Dexie：同步写入无防抖（Dexie 走 500ms 防抖，硬刷新会丢最后 ≤500ms）；不触发 `emitLocalWrite`（否则无限推迟云同步，§4.3）；天生设备本地不同步；`storage` 事件让其它标签页免费收到变更通知。
- 休息段（`shortBreak`/`longBreak`）**只存在于这里，永不落库**。

### 5.3 状态机

| 当前 | 事件 | 迁移到 | 副作用 |
|---|---|---|---|
| `idle` | 点「开始专注」/ 按 `P` | `focus` | 生成 `sessionId`；`startAt = Date.now()`；`plannedMs = focusMin × 60000`；解锁 AudioContext（必须在手势回调里 `resume()`）；下单根 `setTimeout(plannedMs)` |
| `focus` | 按 `P` / 点「暂停」 | `focus(paused)` | `pauses.push({at: now})`；清除 timeout |
| `focus(paused)` | 按 `P` / 点「继续」 | `focus` | 末条 `pauses.until = now`；按剩余时间重下单根 timeout |
| `focus` | timeout 触发 或 回到前台发现 `now ≥ 计划终点` | `idle` 或 `shortBreak/longBreak` | **按计划终点结算并落库**（一条 `execute`）；响铃 + 通知；`cycleIndex++`；若配置了自动休息则进休息，否则回 `idle` 并在面板显示结果卡 |
| `focus` / `focus(paused)` | 点「停止」 | `idle` | 按实际净时长结算落库（`outcome: 'stopped'`） |
| `focus` / `focus(paused)` | 点「丢弃」 | `idle` | `outcome: 'discarded'` 落库（`focusMs` 照实记但不计统计），或 `< 60s` 时直接不落库 |
| `shortBreak/longBreak` | timeout / 点「跳过休息」 | `idle` | 响铃；不落库 |
| 任意 | 页面重开且读到 `RunningState` | 见 §5.5 | —— |

**「到点自动结算」是本设计消灭「忘记停」的主手段**：正常情况下用户根本没有「忘记停」的机会，因为到点即结算。只有页面在到点那一刻恰好被冻结/关闭时才走 §5.5 的恢复判定。

**闹钟为什么用单根长 `setTimeout`**：Chrome intensive throttling（1 次/分钟）的四个条件是 **AND**，其中一条是「定时器链长 ≥ 5」。单根长 timeout 链长为 1 ⇒ **结构上免疫 intensive 档**（最坏仍受 1s 级节流，对分钟级闹钟无影响）。绝不用「每秒 setInterval 自己数」。

**UI 刷新与闹钟分离**：显示用 1s `setInterval` 只做「读 `Date.now()` 重算并直写 DOM」，它不准也没关系（隐藏时没人看）；到点判定只认那根长 timeout + `visibilitychange` 时的补算。

### 5.4 心跳

运行中每 **5 秒**写一次 `lastHeartbeatAt`，另外在 `visibilitychange(hidden)` 与 `pagehide` 时各强制写一次。

- **不用 `beforeunload` / `unload`**：极不可靠，且注册 `unload` 监听会破坏 bfcache。`hidden` 是最后一个可靠可观测的状态。
- 崩溃 / 杀进程 / discarded 没有任何回调 ⇒ 心跳是唯一手段，最多丢 5 秒。

### 5.5 中断恢复判定（阈值按值执行）

页面加载时若读到 `RunningState`，令 `now = Date.now()`、`gap = now - lastHeartbeatAt`、`plannedEnd = startAt + plannedMs + 暂停总时长`：

| 条件 | 处理 | 是否打扰用户 |
|---|---|---|
| `gap ≤ 90s` 且 `now < plannedEnd` | **无缝续跑**（正常刷新/切页） | 不打扰 |
| `now ≥ plannedEnd`（不论 gap） | **按计划终点结算**（`outcome: 'completed'`，`focusMs` 取到 `plannedEnd` 为止的净值）。若 `gap > 90s` 则同时 `needsReview: true` | 面板显示结果卡（带「刚才不在，已按计划结算」说明），不弹阻塞对话 |
| `gap > 90s` 且 `now < plannedEnd` | 暂停在 `lastHeartbeatAt` 处，弹**结算对话**：`[算到刚才 X 分钟]` / `[继续跑]` / `[丢弃]` | 一次明确选择 |
| `now - startAt > 4h`（硬截断） | 强制结算，`focusMs = min(净时长, plannedMs)`，`needsReview: true` | 结果卡带待确认徽标 |
| 时钟跳变：`\|(now - clockAnchor.wall) - (performance.now() - clockAnchor.mono)\| > 2000ms` | 照常结算但 `needsReview: true`，`focusMs` 走 clamp | 结果卡带待确认徽标 |

**结算 clamp（无条件执行）**：`focusMs = clamp(净时长, 0, plannedMs)`。越界（负数或超上限）一律 `needsReview: true`。
→ 「系统时钟被 NTP 校正」「用户改时区」造成的负时长或 8 小时假会话，结构上不可能落库。

### 5.6 多标签一致性

- **显示**免费一致（§5.1.3）。需要协调的只有**副作用**：响铃、弹通知、写结算记录。否则 3 个标签会响 3 声、弹 3 条、写 3 次。
- **选主用 Web Locks**：`navigator.locks.request('yearflow-pomodoro', {mode:'exclusive'}, () => new Promise(() => {}))` —— 请求一把**永不释放**的锁，拿到锁的标签即 leader。标签关闭/崩溃 → 锁自动释放 → 下一个标签自动接位。**崩溃安全，不需要心跳超时**，这是它相对 BroadcastChannel 选主的决定性优势。
- 非 leader 标签：照常显示倒计时、照常可操作（操作会写 localStorage，leader 通过 `storage` 事件感知），但**不响铃、不弹通知、不执行结算落库**。
- 落库幂等兜底：结算用预生成的 `sessionId` 作为 id ⇒ 即使出现双写也只是同一行被覆盖两次，不会产生两条。
- 不引入 BroadcastChannel：`storage` 事件已经免费提供跨标签通知（运行状态本来就存在 localStorage）。

### 5.7 声音与通知

**声音**（默认开）：用 `OscillatorNode` 现场合成两声短促柔和音——880Hz → 1174Hz，各 90ms，指数衰减，峰值 gain 0.12~0.2，总时长 < 400ms。不引入音频文件（省一次请求、省 PWA 预缓存体积、天然离线、不占 bundle）。
- `AudioContext` **必须在「开始专注」的手势回调里创建并 `resume()`**（autoplay policy：手势之前创建会是 `suspended`），之后全程复用同一个实例。
- 桌面 Chrome 后台标签页可以播（音频恰是节流豁免项）。不承诺锁屏能响。

**通知**（默认关）：`new Notification(...)`，**只在用户主动打开「到点提醒」开关时请求权限**——绝不在页面加载时请求（Chrome 对滥用者有更安静的权限 UI 惩罚）。
- 只在**页面隐藏**时发通知；页面在前台时用页内结果卡 + 声音（用户就在看着页面，弹系统通知是最差选择）。
- 权限被拒 → 降级为 `document.title` 闪烁（交替两个字符串），**必须有停止条件**：用户回到页面 或 30 秒后自动停。
- v1 不碰 Service Worker（§二）。

**`document.title` 倒计时**：只在 `document.hidden` 时更新，频率 1/s，格式 `12:34 · YearFlow`。
- 可见时不更新（页面上已有大号倒计时），避免屏幕阅读器每秒朗读一次标题。
- 回到前台、会话结束、离开页面、`pagehide` 时都必须恢复原标题 `YearFlow — 年度计划`（`index.html:8`）。
- 隐藏标签本身被节流 ⇒ title「跳秒」是正常现象，不为此加 Worker。

### 5.8 DEV 观测句柄（必需，不是可选）

`if (import.meta.env.DEV) window.__pomodoro = usePomodoroStore;`

理由：本机浏览器面板既拿不到截图、又会读到 React 提交前的旧渲染（`02-facts` §8(b)(f)），**不暴露 store 就完全无法自动验证**。这是既有约定（`useStore.ts:207-210`、`uiStore.ts:127-129`、`window.__syncStore`、`window.__ganttDeriveComputes`）。

---

## 六、与打卡 / 统计体系的口径

这是整套设计最关键的一章。**`focusSessions` 是「真实投入时间」的唯一事实来源；`CheckIn` 保持「我今天做没做」的语义，一处不改。**

### 6.1 三条禁令

1. **绝不自动累加 `CheckIn.minutes`**。技术硬理由：整行 LWW 下累加语义不安全（A 设备 +25、B 设备 +25，最终是 25 不是 50，且无任何冲突提示，要做对需引入 CRDT 计数器）。附带理由：手填与自动挤在一个标量字段里不可分辨、不可审计；undo 会连带回滚用户手改的 status/note。
2. **绝不自动写 `CheckIn.status`**。streak 是自我契约，不该由传感器接管；一次误触（开个番茄试音效）就能伪造 streak 且几乎无法察觉；反向的 toggle-off 删记录会连带删掉番茄写入的分钟。
3. **streak / 热度 / 点阵 / 自动进度 / 缺卡判定全部不动**。事实依据：`streak.ts`、`heat.ts`、`scheduled.ts`（含 `calcAutoProgress`）、`dayPanel.ts`、`derive/gantt.ts`、`tracks.ts` **全部只看 `status`，不消费 `minutes`**（`01-facts` §5.2）。所以番茄钟对它们天然零影响，131 个既有测试零风险。

### 6.2 唯一的连接点：一键「记为完成」

会话结算后，面板结果卡上给一个 `[✓ 记为完成]` 按钮，走现有 `setCheckIn`，**独立成一条 undo 命令**（label 沿用「打卡「X」完成」）。
→ undo 语义清晰：撤销打卡不动会话，撤销会话不动打卡。用户按一次 `Ctrl+Z` 得到的结果永远是可预期的。

### 6.3 割裂感用可见性解决，不用自动写入

方案 B（各自独立）唯一的痛点是「我明明专注了 2 小时，甘特图上这天还是缺卡」。解法**不是**自动打卡，而是：

- **甘特图「有专注·未打卡」中间态**：该日有会话但无打卡记录时，点阵给一个可区分的中间态标记（S5 实现，视觉见 §8.6）。
- **打卡页补卡建议**：「这天你专注了 50 分钟 → 一键补卡」。

数据不自动写，但可见性与一键补卡到位 ⇒ 缺点被解掉，而一分钱信任都没花。

### 6.4 `effectiveMinutes`：统计层一处收口

**问题**：同一天同一任务可能同时有手填 `minutes` 和番茄会话。相加必然重复计（用户手填时往往是估算整天，已含番茄那部分）；只取自动会丢掉「没开计时器的那一小时」；只取手填会丢掉真实数据。

**口径**：`max(自动, 手填)`，**在 (goal, task, date) 粒度上取 max，再求和**。

```
effectiveMinutesByGoalDate(checkIns, sessions, goalId, date):
    manual[taskKey] = Σ CheckIn.minutes            // 同 (goal,task,date) 键，taskId 缺省归入 '' 桶
    auto[taskKey]   = Σ round(focusMs / 60000)     // outcome !== 'discarded'、!deletedAt
    return Σ over taskKey  max(manual[taskKey], auto[taskKey])
```

为什么按任务分桶而不是直接在目标级取 max：一个目标下任务 A 手填 60 分、任务 B 跑了 25 分钟番茄，目标级 max 会得到 60（丢掉 B 的 25）；分桶后是 60 + 25 = 85，正确。仍然只有一种算法。

一句话可向用户解释：**「取更完整的那个」**。

**配套 UI**（消除重复填写的动机）：当天该任务有会话时，分钟输入框 placeholder 显示自动值（如 `自动 50 分`），并在卡上让「自动」与「手填」两个数并列可见——两个数、一个结论。

### 6.5 消费端改造（穷举，共 3 处）

`minutes` 的全部消费者只有复盘页与年度总览（`01-facts` §5.2 已穷举）。改造点：

| 位置 | 现状 | 改成 |
|---|---|---|
| `src/lib/derive/review.ts:50-53` `monthlyGoalStats` | `minutes += c.minutes ?? 0` | 走 `effectiveMinutesByGoalDate` 逐日求和 |
| `src/lib/derive/review.ts:97-111` `minutesByGoalByMonth` | 直接累加 `c.minutes` | 同上 |
| `src/review/AnnualOverview.tsx:116-130` `totals`（投入总时长卡） | **不复用 review.ts，自己重新遍历 checkIns** | 同上（保留「不累加已四舍五入的月值」的既有正确性，`PROGRESS.md:193`） |

`src/pages/ReviewPage.tsx:88` 消费 `monthlyGoalStats` ⇒ **自动生效，零改动**。

**回归护栏（照抄 `buildRowLayout` 那次的手法）**：这两个 review 函数**新增 `sessions` 参数且缺省为空**，缺省时行为与改造前**完全一致** ⇒ `review.test.ts` 既有 5 条测试一行不改仍全绿，它们就是回归护栏。

**顺带记录、但本次不改的既有口径瑕疵**（`01-facts` §5.3，避免下次误以为是番茄钟引入的）：
- `monthlyGoalStats.minutes` 不排除 `status === 'skipped'` 的 `minutes`（现网看不出来只因种子数据 skipped 的 minutes 是 `undefined`）。
- 同一函数内两套去重规则：完成分用「同日取最强」，时长用直接累加。
- 免打卡区间不影响投入时长——这是**正确的**（出差期间的专注照常计入），明确保留。

---

## 七、派生与统计

新文件 `src/lib/derive/focus.ts`（纯函数 + vitest，不入库，遵守 CLAUDE.md）。

| 函数 | 签名要点 | 口径 |
|---|---|---|
| `settleSession(running, now, opts)` | `RunningState → FocusSession \| null` | 结算的**唯一**实现：算净时长、扣暂停、clamp 到 `plannedMs`、判 `needsReview`、`< 60s` 返回 `null`。UI 与恢复流程共用同一函数（预览与提交零口径漂移，照 `batchCheckIn` dryRun 的先例） |
| `netFocusMs(startAt, endAt, pauses)` | 纯算术 | 扣除全部暂停区间；末条未闭合暂停按 `endAt` 闭合 |
| `planRecovery(running, now)` | → `{kind:'resume'\|'settleAtPlannedEnd'\|'ask'\|'hardCut', focusMs?, needsReview?}` | §5.5 的判定表，纯函数，全部阈值可单测 |
| `focusMinutesByTaskDate(sessions, date)` | → `Map<taskKey, minutes>` | 排除 `discarded` 与软删；`round(focusMs/60000)` |
| `effectiveMinutesByGoalDate(checkIns, sessions, goalId, date)` | → `number` | §6.4 口径 |
| `effectiveMinutesByGoalMonth(checkIns, sessions, month)` | → `Map<goalId, number>` | 逐日调上一个再求和，供 review.ts 两处使用 |
| `todayFocusMs(sessions, date)` | → `number` | 面板「今日已专注」 |
| `unassignedSessions(sessions)` | → `FocusSession[]` | `goalId` 缺省者，供「N 段未归类」清理入口 |
| `daysWithFocusNoCheckIn(checkIns, sessions, goalId, range)` | → `Set<string>` | §6.3 甘特中间态与补卡建议。**必须是按 goal 分组、独立 memo 的轻量 Set** |

### 性能约定（硬性）

**绝不把 `focusSessions` 整表塞进 `useGanttDerive` 的输入。** 该 hook 的第 1 层是「6 个输入引用全等则直接返回上一轮结果」（`useGanttDerive.ts:60-69`）。多传一个每次变化的 map ⇒ 顶层短路每次失效 ⇒ 每次重跑 `Object.values(tasks/checkIns)` + 全量 `stableGroupBy` 比对。既有事故先例：筛选 map 没 `useMemo` 导致全量重算（`PROGRESS.md:127`）。

正确做法：甘特图需要的番茄信息经 `daysWithFocusNoCheckIn` 收敛成一个**按 goal 分组的轻量 `Set<date>`**，在 `GanttView` 里独立 `useMemo`，与 `useGanttDerive` 平行。

### 复盘呈现（S5）

- **月度**：既有「各目标完成率」卡的「投入 X」自动变成 `effectiveMinutes` 口径（零改动生效）。
- **年度**：既有堆叠面积图与「投入总时长」卡同样自动生效。
- **新增卡**（P1，视额度决定是否进 v1）：「专注段数 / 平均段长 / 被打断率」——只加 `CheckIn` 给不了的指标才值得占一张卡。
- ⚠️ **recharts 分包边界**：任何引入 recharts 的番茄图表**必须只被 `ReviewPage` 的模块图可达**。全仓唯一 recharts import 点是 `AnnualOverview.tsx:6-14`，唯一分包切点是 `App.tsx:19` 的 `lazy()`，`vite.config.ts` 没有 manualChunks。若被打卡页/甘特页/App 直接或间接 import，recharts 会回落主包（既有分界：主包 532KB / review 分包 366KB）。

---

## 八、UI 规格

### 8.0 全局约定

- 文案**简体中文、动词开头**；所有数字（倒计时、分钟、段数）必须带 `.tnum`（`index.css:39-41`）。
- 尺寸/颜色/间距只允许引用 `tokens.css` 令牌或 `src/pomodoro/constants.ts`。**禁止散落魔数。**
- **唯一确定的令牌缺口**：`tokens.css` 字号阶封顶 `--font-20`（全仓最大字号就是 20px）。面板的 hero 倒计时需要 32px ⇒ **新增 `--font-32`**（浅色深色同值，`tokens.css:91-96` 字号区）。只加这一个。
- **进度环几何落 `src/pomodoro/constants.ts`**：仓内已有两处手写进度环（`gantt/LeftGrid.tsx:40-59` 的 `MonthRing` r=5.5/sw=2.5/15×15；`checkin/DayStrip.tsx:22-23,54-79` 的 R=9/24×24），番茄是第三处。不塞进 `gantt/constants.ts`（那是甘特域私有，头注释就是甘特滚动铁律）。
- 浮层外壳统一用既定组合：`--bg-raised` + `--border-default` + `--radius-lg` + `--shadow-lg`（Toasts / CheckinPopover / ContextMenu / BulkBar 都是这一套）。
- 语义色：运行中 `--accent`、暂停中 `--warning`、已完成 `--success`。无需新增颜色令牌。
- 移动端：`useIsMobile()`（`lib/useIsMobile.ts:12-14`，matchMedia 767px）为真时**不渲染任何番茄入口**。

### 8.1 顶栏胶囊（主形态，常驻）

**位置**：`src/App.tsx:182` 的右侧簇，插在 `SyncIndicator` **之前**。

为什么是这里：全站唯一未被占用的常驻位。左下被 `Toasts`（`fixed bottom-4 left-4 z-50`）占；底部居中被 `BulkBar`（z-40，`bottom = MINIMAP_H + 12`）与 `MiniMap` 占；右侧 380px 被 `TaskDrawer`（z-40）占；`<768px` 底部被 `MobileTabBar` + safe-area 占满；顶栏中间槽已被 `GanttToolbar` 挤满（年份/四档/今天/筛选/Active Tasks/连线/基线/保存基线/导出）。

**形态**：

| 状态 | 显示 | 样式 |
|---|---|---|
| 空闲 | 🍅 图标按钮（32×24，`--font-13`） | 中性：`--text-secondary` + `--border-default`，与 `?`/主题按钮同款 |
| 专注中 | `🍅 12:34` + 任务名（最多 8 字，超出省略） | `--accent` 文字 + `--accent-soft` 底 |
| 暂停中 | `⏸ 12:34` | `--warning` |
| 休息中 | `☕ 4:12` | `--text-secondary` |

**倒计时刷新方式（硬性）**：单例 1s ticker **直写 DOM 的 `textContent`**，零 React 重渲——照 `gantt/lib/dragHint.ts` 的「直写 DOM 单例」样板（它连内联 style 都用 `var(--...)` 令牌）。
理由：番茄钟在任何页面都可能开着；若每秒 `setState`，甘特页每秒重渲一次会直接违反「拖拽 60fps / 缩放 <150ms」门槛。React 只在**状态迁移**时重渲（开始/暂停/结束/切阶段），一次番茄最多几次。

**挂载点**：`App.tsx:233-237` 那串浮层兄弟节点的末尾（`ShortcutHelp` 之后）放面板与结果卡的 portal 宿主；胶囊本身在顶栏内。两者都在 `BrowserRouter` 内，拿得到 router context（结果卡的「去甘特图定位」需要）。

### 8.2 面板（点胶囊展开）

宽 **320px**，照 `SyncIndicator.tsx:44,62-71` 的 `relative` 父 + `absolute` 子模式（不 portal，顶栏下拉的既有写法）。点外部 / 再点胶囊关闭；`Esc` **不参与**（见 8.5）。

自上而下：

1. **hero 倒计时** `25:00`，`--font-32` + `.tnum`，居中；左侧同行一枚进度环（直径 48，线宽 3，`--accent` 描边，`rotate(-90)` 起点在 12 点方向，几何常量进 `src/pomodoro/constants.ts`）。
2. **阶段与节律**：`专注 · 第 2/4 段` 或 `短休息`，`--font-12` `--text-tertiary`。
3. **任务选择器**：一行，显示 `🧩 SAP系统 · MM 模块`，点击展开下拉。
   - 默认预选**上次使用的任务**（localStorage `yearflow:pomodoro:lastTask`）。
   - 列表默认列**今日在办任务**（含 `adhoc`「随缘」任务 —— ⚠️ 若只列 `dayEntries`，随缘任务永远统计不到时间，因为 `isScheduledDow` 对 adhoc 恒为 false），可搜索全部未归档任务。
   - 允许**「暂不归类」**（先开始后归类）。
   - 选中日期范围外或已 `done` 的任务：**提示但不阻止**（真实情况就是任务延期了），顺手给一个「延长任务到今天」的快捷动作。
4. **主操作**：`[开始专注]` / 运行中 `[暂停] [停止]` / 暂停中 `[继续] [停止]`；次级 `[丢弃]`（`--danger` 文字按钮，不做主按钮）。
5. **今日已专注**：`今日 1 小时 25 分 · 4 段`，`--font-12`。
6. **未归类提示**（有则显示）：`3 段未归类 · 去归类` → 展开逐条列出，每条给目标/任务选择器（走 `reassignFocusSession`）。

### 8.3 结果卡（会话结算后）

出现在面板内（面板关闭时胶囊变 `--success` 一次脉冲提示，不强行弹窗）：

```
已记录专注 25 分钟
计入 8月13日 · 🧩 SAP系统 · MM 模块
[✓ 记为完成]  [改归属]  [删除]
```

- `[✓ 记为完成]` → `setCheckIn`，**独立一条 undo 命令**（§6.2）。已打卡时该按钮显示为「已完成 ✓」并禁用。
- **必须明示「计入 X 月 X 日」**（跨天会话的逃生阀），点日期可一键改归相邻日。
- `needsReview` 为真时加一枚 `--warning` 徽标「待确认」+ 一行说明（如「期间页面未在前台，已按计划终点结算」），点击可改时长或丢弃。
- 到点结算时同时：响铃（若开）+ 通知（若开且页面隐藏）。

### 8.4 打卡页接入（`src/checkin/GoalCheckCard.tsx`）

**入口位置**：`TaskRow` 行内（`:213-224`，与 `StatusButtons compact` 并列）与单任务目标的卡头簇（`:300-305`）。
理由：这是 `(goalId, taskId, date)` 三元键**唯一齐备**的层。目标级卡头在多任务目标下拿不到 `taskId`，与「按任务统计真实投入」直接相悖。`AdhocSection.tsx:15` 已经演示了复用路径（手工整出同形 `DayTaskEntry` 再喂给共用件）。

**形态**：一枚 ▶ 小按钮（`--font-12`，hover 才显色），点击 = 以该任务启动番茄。仅 `date === todayStr()` 时渲染（补卡历史日期不该启动计时器）。

**分钟输入框**：当天该任务有会话时，`TaskEditor` 的自定义分钟 input（`GoalCheckCard.tsx:148-172`）placeholder 显示 `自动 50 分`，并在 `N分` 展示位（`:217-221`）把自动值与手填值并列（`50 分（自动）` / `60 分`）。**不预填、不覆盖**——手填永远是用户的显式动作。

⚠️ **FLIP 约束**：`useFlip` 会对 `listRef` 子树里所有 `[data-flip-id]` 元素做 WAAPI translate（260ms）。启动按钮是静态元素没问题；**运行中的计时器主体绝不能放进打卡卡片内**（会随卡片被平移动画拖着漂）——这也是主形态选顶栏胶囊的又一个理由。

### 8.5 快捷键

**`P` = 开始 / 暂停**（唯一新增全局键）。已核实空闲：`ShortcutHelp` 已占 `T/+−/←→/B/N/M/D/Del/Esc//`/`Ctrl+K/?/Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y`；`GanttView.tsx:457-525` 的 switch 另占 `=`；空格被 `useSpacePan` 占。

- **不抢空格**（=甘特抓手平移）、**不用 `Esc`**（全仓 9 个消费者互相竞争 capture 顺序：CheckinPopover/ContextMenu/TaskDrawer/FilterMenu/GoalIconPicker/dragCore/InlineInput/CommandPalette/BackfillDialog）。面板关闭用点外部或再点胶囊。
- 实现必须复刻 `App.tsx:129,135` 的 typing 守卫（`INPUT`/`TEXTAREA`/`isContentEditable`，且 `ctrl/meta/alt` 时早退）。
- **必须同时补进 `src/components/ShortcutHelp.tsx:2-36` 的 GROUPS「其他」组**（既有约定：速查表是快捷键的唯一文档）。

### 8.6 甘特图与复盘（S5）

- **甘特点阵中间态**：`CheckinDots.tsx:49-97`。点几何被死锁（`DOT_D=7`、`DOT_ROW_H=10`，点心必须对齐日列中心），今日环已占外描边一圈 ⇒ 可用维度只剩**点内小竖线**。语义：该日有专注、无打卡。数据来自 §七 的轻量 `Set`。
- **bar tooltip 加一行**：`BarTooltip.tsx:38-47` 的 `rows` 数组追加「专注 1 小时 25 分」。最便宜的纯 additive 改动。
- **不动 `HeatStrip`**：它被 `BarsLayer` / `GoalSummary` / `TrackSummary` 三处原样复用（`PROGRESS.md:261` 明确「一行未改」），改它等于同时改任务行/目标折叠行/轨道折叠行三种语义。
- **不动行高**：`ROW_H_TASK=48 = 6+22+4+10+6` 已无空余像素，改它会动 `rowLayout.ts`（行对齐唯一来源）及其单测、`rowAtY`/`visibleRowRange` 与所有 `r.top + ...` 计算。
- **打卡 popover 加一块**：`CheckinPopover.tsx:136-246` 键最全（`goalId, taskId, date` 现成），展示当日该任务的专注时长。
- **右键菜单**：`ContextMenu.tsx` 加项是零结构改动，但 ⚠️ 面板里合成 `contextmenu` 不触发 React 委托处理器 ⇒ 该入口**只能 Playwright 真实右键验证**。v1 不加右键入口（收益低、验证成本高）。
- **sticky 铁律**：任何 transform/will-change 动画不得落在甘特 scroller 内 sticky 元素的祖先上；番茄的脉冲/环形动画只允许在叶子元素或 portal 到 body。

### 8.7 设置页

`src/pages/SettingsPage.tsx` 新增 `<Section title="番茄钟">`，插在「外观」之后（同属设备本地偏好），零结构改动。

6 项，行内即存，照 `ExemptionManager` 模式（数字 input `onBlur` 比对后才写、Enter → blur；开关即点即存）：
`专注时长 25 分` / `短休息 5 分` / `长休息 15 分` / `每 4 段后长休息` / `到点响铃 [开]` / `到点通知 [关]`

- 「到点通知」打开时才 `Notification.requestPermission()`；被拒则开关回弹并提示「浏览器已拒绝通知权限，可在地址栏左侧站点设置里恢复」。
- 区块底部一行灰字诚实说明：**「番茄钟仅在电脑端可用。计时依赖页面存活，合盖休眠或关闭标签页后重新打开时会让你确认这段时间是否计入。」**
- 「数据」区各表计数（`:135-145`）会自动多出「专注会话 N」（第 18 项 `TABLE_LABEL`），这同时是 §十容量红线的可见性来源。

---

## 九、边界与故障处理表

| 场景 | 处理 | 依据 |
|---|---|---|
| 后台标签页倒计时变慢 | 剩余时间由 `Date.now()` 反算；闹钟走单根长 timeout（链长 1，免疫 intensive 档）；`visibilitychange → visible` 立即重算并补结算 | §5.1/5.3 |
| 合盖休眠 3 小时 | `focusMs` clamp 到 `plannedMs` ⇒ 结构上不可能记出 3 小时；`gap > 90s` 走结算对话；跳变探测置 `needsReview` | §5.5 |
| 系统时钟被 NTP 校正 / 改时区 | clamp `0 ≤ focusMs ≤ plannedMs`，越界置 `needsReview`；`date` 从 `startAt` 派生一次后**冻结**，历史不随时区漂移 | §三、§5.5 |
| 刷新 / 关标签 / 崩溃 / 杀进程 | 心跳 5s + `hidden`/`pagehide` 强制写；重开按 §5.5 判定。最多丢 5 秒 | §5.4 |
| 多标签同时开着 | 显示天然一致；副作用由 Web Locks leader 独占；结算用预生成 id 幂等兜底 | §5.6 |
| 两台设备各开一个番茄 | 各自结算成独立行，都计入统计。不设「全局唯一 running」不变量 | §4.4 |
| 跨天会话（23:50 开始） | 按开始日整段归属；结果卡明示「计入 X 月 X 日」+ 一键改归 | §三 |
| 忘记停 | 到点自动结算（主手段）；页面被冻结时按计划终点结算；4h 硬截断 | §5.3/5.5 |
| 误触（开了 20 秒就关） | `< 60s` 不落库，不产生命令、不进 undo | §三 |
| 免打卡区间内专注 | **照常计入投入时长**。免打卡只影响「缺卡与应打卡判定」，与时长无关 | §6.5 |
| 「随缘」(adhoc) 任务 | 任务选择器必须包含（不能只列 `dayEntries`，adhoc 天然不在其中），否则永远统计不到 | §8.2 |
| 给日期范围外 / 已完成任务计时 | 提示但不阻止 + 给「延长任务到今天」快捷动作 | §8.2 |
| 删除任务 / 目标 | 级联软删其会话，并把「J 条专注会话」计入 confirm 文案（现有 `deleteGoal` confirm 已列出任务/里程碑/打卡数量） | §4.1 第 19 项 |
| 未归类会话堆积 | 面板常驻「N 段未归类 · 去归类」入口 | §8.2 |
| 通知权限被拒 | 降级为 `document.title` 闪烁，**必须有停止条件**（回到页面 或 30 秒） | §5.7 |
| 到点没声音 | AudioContext 在「开始」手势里 `resume()` 并全程复用；不承诺锁屏/移动端能响 | §5.7 |
| 手填与自动重复计时 | `effectiveMinutes` 取 max + 分钟框展示自动值 + 两个数并列可见 | §6.4 |
| 月总时长与日和不一致 | 存 ms，只在显示层取整；聚合永远从原始值算（既有先例：年度总时长卡不累加月度四舍五入值） | §6.4 |
| SW 更新打断计时 | 当前配置**不会**：全仓零 `virtual:pwa-register` 引用，不会自动 reload。若将来有人加 `registerSW({immediate:true})`，本结论失效——必须在那次改动里重新评估 | `03-facts` §9 |

---

## 十、性能预算与容量红线

### 10.1 性能门槛（沿用 CLAUDE.md 并追加）

| 指标 | 门槛 |
|---|---|
| 运行中 React 重渲次数 | **每秒 0 次**（倒计时直写 DOM）。整场番茄只在状态迁移时重渲 |
| 甘特页开着番茄钟 | 拖拽仍全程 60fps、缩放切换仍 < 150ms |
| 首屏 | 仍 < 1s（含 `focusSessions` 全量 hydrate，见 10.2） |
| 新增 npm 依赖 | **0 个**（Web Locks / AudioContext / Notification 全是平台 API） |
| 主包体积增量 | 番茄内核与 UI 进主包（顶栏常驻，无法懒加载），预算 **≤ 15KB gzip**；任何 recharts 图表只许进 review 分包 |

### 10.2 容量红线（本次设计必须显式承认的取舍）

现网基数：全库约 340 行 / 110KB JSON（约 7 个月使用量），`checkIns` 年增约 500 行。
番茄会话：8~16 段/天 ⇒ **2900~5800 行/年**，5 年累计 1.5~3 万行 / 3.6~10MB JSON。这是当前全库行数的 **8~17 倍/年**。

现有架构**没有任何分片机制**：`hydrate` 是全表进内存、`exportBundle` 是内存全量出 JSON、同步是全表按 `updatedAt` 增量。

**v1 决策：全量 hydrate，与既有 7 张表一致，零特例。**
依据：1~2 年内是 3000~6000 行，与现有 `checkIns` 同阶；既有实测基线是「2070 实体写入+派生+渲染 114ms」。为一个还没发生的问题引入特例，代价大于收益。

**红线与触发条件（写死在这里，S5 要在设置页让它可见）**：
> 当「数据」区显示的**专注会话行数 > 8000**（约 1.5~2 年）时，启用窗口化载入：
> 1. `hydrate` 该表只载入 `date >= 今天-400天`（走 §4.1 已建好的 `date` 索引，无需再升 Dexie 版本）；
> 2. `exportBundle` 对该表改为**读 Dexie 全量**（否则备份会静默丢掉窗口外的历史，这是最危险的连带后果，必须同批改）；
> 3. 复盘切到往年时按需 async 补载该年区间。
>
> 400 天窗口的理由：覆盖「今日 / 本月 / 本年度总览」全部同步渲染场景，上界 400×16 ≈ 6400 行，有界。

其余环节的已知代价（红线内可接受，记录以免将来当成 bug）：
- 墓碑清理每浏览器会话对每张表做一次全表 `toArray()` + JS 过滤（`engine.ts:183`），番茄表最贵。
- 首次登录全量上推：3 万行 ≈ 60 次串行 `upsert_rows` RPC（每次 ~150KB）。
- JSON 备份用 `JSON.stringify(backup, null, 2)`，缩进使体积膨胀 1.5~2 倍。

---

## 十一、测试与验收清单

### 11.1 vitest（`src/lib/derive/focus.test.ts`，全绿方可提交）

- [ ] `netFocusMs`：无暂停 / 单次暂停 / 多次暂停 / 末条未闭合暂停按 `endAt` 闭合
- [ ] `settleSession`：clamp 到 `plannedMs`；净时长为负 → 0 且 `needsReview`；`< 60s` 返回 `null`
- [ ] `settleSession`：`outcome` 取值正确（到点 `completed` / 提前停 `stopped` / 丢弃 `discarded`）
- [ ] 跨天：`startAt` 为 23:50 → `date` 是开始日；`date` 一旦生成不随后续时区变化
- [ ] `planRecovery`：`gap ≤ 90s` 且未到点 → `resume`
- [ ] `planRecovery`：已过计划终点 → `settleAtPlannedEnd`（`gap > 90s` 时附 `needsReview`）
- [ ] `planRecovery`：`gap > 90s` 且未到点 → `ask`，且给出截到 `lastHeartbeatAt` 的 `focusMs`
- [ ] `planRecovery`：`now - startAt > 4h` → `hardCut`，`focusMs = min(净时长, plannedMs)`，`needsReview`
- [ ] 时钟跳变探测：wall 与 mono 差值 > 2000ms → `needsReview`
- [ ] `focusMinutesByTaskDate`：排除 `discarded` 与软删
- [ ] `effectiveMinutesByGoalDate`：仅手填 / 仅自动 / 两者取 max
- [ ] `effectiveMinutesByGoalDate`：多任务分桶后求和（A 手填 60 + B 自动 25 = 85，而非 60）
- [ ] `effectiveMinutesByGoalDate`：`taskId` 缺省的记录归入 `''` 桶且不与具体任务串味
- [ ] 长休息节律：`cycleIndex % longBreakEvery === 0` 时进长休息
- [ ] **回归护栏**：`monthlyGoalStats` / `minutesByGoalByMonth` 传空 `sessions` 时结果与改造前完全一致（`review.test.ts` 既有 5 条一行不改仍全绿）
- [ ] `backup.ts` 往返：新表数据导出再导入无损；**老备份（无 `focusSessions` 键）导入成功**；`settings.pomodoro` 往返不丢

### 11.2 Playwright（`scripts/capture-pomodoro.mjs`，真实 Chrome）

用 `chromium.launch({ channel: 'chrome' })`（系统 Chrome，不下载 playwright 浏览器）；`page.on('dialog', d => d.accept())`；`page.on('pageerror')` 直接 throw。⚠️ 写 store/settings 后须 `waitForTimeout(700~800)` 再跳转（500ms 落库防抖）。

- [ ] 视觉门槛：胶囊（空闲/专注中/暂停中）× 面板（含任务选择器展开、结果卡）× **深浅两主题**
- [ ] 挂钟对照：启动 → `waitForTimeout(65_000)` → 读 `window.__pomodoro` 剩余时间，与真实经过时间误差 < 2s
- [ ] 结算落库：`plannedMs` 改小（如 3s）跑完 → 读 IndexedDB 确认一条 `focusSessions` 行，字段与口径正确
- [ ] undo：结算后 `Ctrl+Z` 完整移除该行；栈只吃掉**一格**（对照 `window.__store.getState().undoStack.length`）
- [ ] 恢复：运行中 `page.reload()` → 无缝续跑（gap 小）；手动改 localStorage 的 `lastHeartbeatAt` 制造 `gap > 90s` → 出现结算对话
- [ ] 打卡页 ▶ 入口启动 → 归属正确带 `taskId`
- [ ] 移动端 viewport（375×812）→ **番茄入口全部不渲染**
- [ ] 性能：甘特页开着番茄钟拖 bar，`window.__ganttDeriveComputes` 增量与不开时一致（证明没触发额外派生）

### 11.3 只能人工验（无自动路径，仓内零先例）

全仓 `Notification` / `AudioContext` / `wakeLock` / `Worker` **零使用**，无可复用封装。以下必须人工过一遍并在 PROGRESS 记录结果：

- [ ] 到点提示音真的响，且音量/音色符合「像系统音，不像微信」
- [ ] 系统通知真的弹出、点击能回焦到页面
- [ ] 后台标签页跑满 25 分钟，到点准时响（对照手机秒表）
- [ ] 合盖休眠 30 分钟后打开，结算对话出现且时长判定合理
- [ ] 双标签同时开着，只响一声、只写一条记录
- [ ] 连续跑 4 段确认长休息节律

---

## 十二、分阶段实施

### S3 — 数据层 + 计时内核（含单测，UI 最小化）

- [ ] §四 全部 20 项逐项打勾，**特别核对 ⚠️ 三处无编译护栏的**（`TABLE_NAMES` / `hydrate` 的 `set()` / `TABLE_LABEL`）
- [ ] `0002_focus_sessions.sql` 落地；提醒用户在 SQL Editor 执行一次
- [ ] `src/lib/derive/focus.ts` + `focus.test.ts`（§11.1 用例）
- [ ] `src/pomodoro/`：`constants.ts`、运行状态 store（瞬态 zustand + localStorage 读写）、`settleSession`/`planRecovery` 接线、单根 timeout 闹钟、Web Locks 选主、心跳、DEV `window.__pomodoro`
- [ ] `store/actions.ts` 五个 action + 级联软删
- [ ] `review.ts` 两处 + `AnnualOverview.tsx` 一处收口到 `effectiveMinutes`（新增参数缺省 ⇒ 既有测试不改）
- [ ] `docs/SPEC.md` §三/§十 补第 7 张表；`docs/PROGRESS.md` 记录
- [ ] 验证：`tsc -b` + oxlint + vitest 全绿 → commit

### S4 — 桌面 UI 完全体

- [ ] `--font-32` 令牌；顶栏胶囊（直写 DOM 单例 ticker）；320px 面板（hero 倒计时 + 进度环 + 任务选择器 + 操作 + 今日已专注 + 未归类入口）
- [ ] 结果卡（含 `[✓ 记为完成]` 独立命令、「计入 X 月 X 日」、`needsReview` 徽标）
- [ ] 声音（OscillatorNode 合成）、通知（`new Notification`，开关时才请求权限）、`document.title`（仅隐藏时 1/s，多路径恢复原标题）
- [ ] `P` 快捷键 + 补 `ShortcutHelp` GROUPS
- [ ] 设置页「番茄钟」区 6 项 + 诚实说明文案
- [ ] 打卡页 ▶ 入口 + 分钟框自动值 placeholder
- [ ] 移动端隐藏全部入口
- [ ] 验证：`tsc -b` + oxlint + vitest 全绿 + §11.2 主要项 → commit

### S5 — 统计可视化 + 打磨验收

- [ ] 甘特点阵「有专注·未打卡」中间态 + bar tooltip 加行（走轻量 `Set`，不进 `useGanttDerive`）
- [ ] 打卡页「这天你专注了 N 分钟 → 一键补卡」建议
- [ ] 打卡 popover 显示当日该任务专注时长
- [ ] 会话历史 / 编辑 / 手动补录界面
- [ ] 复盘页专注指标（若额度允许：专注段数 / 平均段长 / 被打断率，只进 review 分包）
- [ ] 性能实测（§10.1 全部指标）+ `scripts/capture-pomodoro.mjs` 截图门槛
- [ ] §11.3 人工清单逐项过 + `docs/PROGRESS.md` 定稿 → commit

---

## 十三、已知局限与升级路径

**局限（都是本次取舍的直接后果，不是缺陷）**

1. **不承诺后台准点**：页面被浏览器冻结（Chrome 隐藏 10 秒后即可能进 intensive 档、更极端会 frozen/discarded）时，闹钟会迟到；靠回前台补算保证**时长正确**，但**提醒可能晚到**。真正的后台准点需要服务端 + Web Push。
2. **无移动端**：v1 明确不做（§一）。
3. **番茄设置不跨设备**：存 `AppSettings`，而 settings 不同步（换设备需重新配一次 6 项）。代价换来的是零 SQL、零同步改动。
4. **手填与自动仍是两个数**：`effectiveMinutes` 取 max 是「不重复计且不丢失」的稳妥近似，不是精确合并。极端情况（用户手填 30、实际专注 100 分但只跑了番茄 25）会低估。
5. **一个会话只能归一个任务**：进行中切任务 = 切分成两条。
6. **`discarded` 会话仍占行**：不计统计但占存储与同步流量。
7. **容量红线在 8000 行**：越过后必须做窗口化改造（§10.2），这是已知的未来工作，不是可以无限拖延的。

**升级路径（都不需要推翻本设计）**

- **全屏专注模式**：新增一个 `/focus` 路由或全屏 overlay，复用同一个运行状态 store，零数据层改动。
- **会话列表页**：按日分组 + 编辑 + 手动徽标，纯 UI，`focusRepo` 已具备按 `date` 范围查的索引。
- **自动开始休息 / 下一段**：两个布尔配置项，状态机已有 `shortBreak/longBreak` 阶段。**`自动开始下一段` 必须默认关**（自动续开 × 忘记停 = 整夜假记录），且续开段同样受 4h 硬截断与结算对话约束。
- **Screen Wake Lock**：做移动端时再加（`visibilitychange → visible` 必须重新申请；只防自动熄屏，不防手动锁屏与合盖）。
- **窗口化载入**：§10.2 已给出三步方案与触发条件，`date` 索引已在 v1 建好，**无需再升 Dexie 版本**。
- **精确合并口径**：若将来给 `CheckIn` 加 `minutesSource` 字段（给现有实体加字段对 Supabase 透明、零 SQL、零 Dexie 升版，见 `PROGRESS.md:270`），可把 max 近似升级为「手填仅覆盖无会话的部分」。

---

## 十四、附录：被否决的方案与理由

| 方案 | 否决理由（结构性，非偏好） |
|---|---|
| 把番茄数据塞进 `CheckIn.minutes` / `note` | ① upsert 键是「目标+任务+日期」，一天一行 ⇒ 单次会话的起止时刻与暂停无处存；② `minutes` 是覆盖语义，累加需 read-modify-write，与「点同一 chip 清除」的 toggle 语义冲突；③ **整行 LWW + 累加字段 = 静默丢数**；④ undo 会连带回滚用户手改的 status/note；⑤ 与手填不可区分来源（`CheckIn` 无 source 字段），口径打架不可逆 |
| 把番茄数据塞进 `AppSettings` | **永不同步**（`TABLE_NAMES` 不含 settings，`queuePersistSettings` 不 `emitLocalWrite`）⇒ 手机与电脑各存一份。同一理由已在轨道功能那次否决过存 settings 的方案（`PROGRESS.md:269`「归属是用户数据，必须跟着 tasks 走」）。另有写入放大（每次重写含 `ganttView` 的整个 blob）与备份丢字段风险 |
| `CheckIn` 内嵌 `sessions[]` 数组 | 一天一行内嵌数组 + 整行 LWW ⇒ 两设备并发各加一段就丢一段。独立行永不冲突，这比「省一张表」更硬 |
| 番茄完成自动累加 minutes / 自动置 done | §6.1 三条禁令 |
| 运行中会话作为实体行入库并同步 | ① 心跳每 5 秒刷 `updatedAt` ⇒ 不断重置同步的 3 秒防抖，运行期间云同步被无限推迟；② 行级 LWW + 客户端时钟裁决 ⇒ 「手机把电脑的番茄停了」；③ 淹没 undo 栈 |
| 每秒 `setInterval` 自减计数 | 后台节流下变慢表，最小化一小时回来会少走一小时 |
| Web Worker 跑 tick | 最多把 1/min 改善回 ~1s，买不到 frozen 与 iOS 后台；隐藏时没人看数字 |
| 播静音音频保活 | 豁免条件要求「可听」，零振幅大概率拿不到；副作用（扬声器图标常亮、抢占系统媒体会话、占用蓝牙耳机）确定发生 |
| BroadcastChannel 选主 | 需要心跳超时判活，标签崩溃后有真空期。Web Locks 的锁在页面消失时自动释放，崩溃安全 |
| 动态 favicon 进度环 | 会破坏 `index.html:5` 精心做的 SVG 年度进度环图标；Safari 支持不稳 |
| 用 `Esc` 关面板 / 空格开始暂停 | 两个键都已有既定语义（9 个 Esc 消费者、空格=抓手平移） |
| 改 Service Worker 发通知 | v1 纯桌面用不上；`generateSW` 下改 SW 会引入懒加载 chunk 部署后 404 的风险 |
| 番茄个数进复盘统计 | 权威口径只能有一个（专注分钟）。两套「投入」数字是可信度杀手 |


