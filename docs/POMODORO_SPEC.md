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

**留到 P1（本文档 §十三 升级路径）**：全屏专注模式、日目标、`自动开始下一段`、Screen Wake Lock。
（会话列表页与编辑界面、`needsReview` 徽标确认流、复盘三指标已在 S5 落地；`自动开始休息`与悬浮小窗已在 P1-A/B 落地，见 §十六。）

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
  date: string;            // YYYY-MM-DD。从 startAt 派生一次后**冻结在字段里**，绝不每次显示时重算（跨时区旅行会让整片历史漂移）。
                           // ⚠️ 用户可经结果卡「一键改归相邻日」显式覆盖它 ⇒ date 与 startAt 允许永久不一致，
                           // 任何迁移脚本/修复脚本**禁止**从 startAt 重算 date（会把用户的显式修正静默改回去）
  startAt: string;         // ISO，专注开始时刻
  endAt: string;           // ISO，结算时刻
  focusMs: number;         // 净专注毫秒：已扣暂停、已 clamp。**结算后的权威值，不由 pauses 反算**（避免重放歧义）
  plannedMs: number;       // 计划专注毫秒（结算截断上限）。手动补录时 = focusMs
  pauses?: FocusPause[];   // 审计与展示用；空数组不写（保持行紧凑）。**上限 20 段**：超出时合并最早的相邻两段
                           // （focusMs 是权威值、不由 pauses 反算 ⇒ 合并不影响记账）。防狂点暂停把同步行撑大
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
  focusMin: number;       // 默认 25，取值 [1, 180]
  shortBreakMin: number;  // 默认 5， 取值 [1, 60]
  longBreakMin: number;   // 默认 15，取值 [1, 120]
  longBreakEvery: number; // 默认 4， 取值 [1, 12]（每 4 段专注后进长休息）
  sound: boolean;         // 默认 true
  notify: boolean;        // 默认 false（需浏览器授权，开启时才请求权限）
  autoBreak: boolean;     // 默认 true（P1 新增，见 §十六）
  pipAuto: boolean;       // 默认 false（P1 新增：开始专注时自动弹出悬浮小窗）
};
```

**取值范围必须在两处强制**（`SettingsRepo.get()` 只做顶层浅合并，不校验内层）：
① 设置页数字 input 的 `onBlur` 做 **clamp**（不是「非法就不写」，而是夹到边界后写回并回显）；
② `backup.ts` 的 zod schema 用 `.int().min(x).max(y)`，否则导入一份畸形备份即中毒。
漏了会怎样：`focusMin = 0` ⇒ `plannedMs = 0` ⇒ 每段都 clamp 成 0 且 `< 60s` 返回 `null`，计时器变成「永远记不上账」；`longBreakEvery = 0` ⇒ `completed % 0 = NaN`，长休息永不触发。两者都不报错。

（v1 是前 6 项，P1 追加后两项。）**必须同步补进 `src/lib/backup.ts:112-117` 的 `settingsSchema`**，用 `.default(...)`（既有写法见 `backup.ts:97,101,102`）——zod 默认 strip 未声明键，漏了就是「导入备份后番茄设置被静默丢弃」，`AppSettings.colorNormalized` 已经是现成受害者（`01-facts` §0）。

---

## 四、存储 / 同步 / 备份改动清单

表名：本地 `focusSessions`，远端 `focus_sessions`。逐处清单见 `01-facts` §1.1。以下是**必须逐项打勾**的清单，其中标 ⚠️ 的**四处漏改不会编译报错**（S2 评审穷举了 `TABLE_NAMES` / `EntityOf` / `DataBundle` / `EntityMaps` / `repoByTable` / `REMOTE_TABLE` / `TableName` 的全部消费点，确认无护栏的恰好这四处，没有第五处）。

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
| 13 | `src/lib/backup.ts` | 新增 `focusSessionSchema`；`backupSchema.data`（:119-132）加键，用 **`.default([])`**（否则老备份导入直接失败）；`settingsSchema`（:112-117）加 `pomodoro` 带默认值 + 取值范围（§三） |
| 14 | `src/lib/backup.test.ts:12` | ⚠️ 会挂的**不是** `:11` 的 `toEqual(bundle)`（第 16 项是编译期强制的，做完后两边都是 `[]`，断言自动通过），而是 `:12` `expect(parsed.settings).toEqual(DEFAULT_SETTINGS)`：`settingsSchema` 里 `pomodoro` 的 `.default(X)` 必须与 `src/store/defaults.ts` 的 `DEFAULT_SETTINGS.pomodoro` **逐字段深相等**，否则该断言失败。这是实际存在的耦合 |
| 15 | `src/db/sync/engine.ts:24-31` | `REMOTE_TABLE` 加 `focusSessions: 'focus_sessions'`（强护栏 ✅） |
| 16 | `src/seed/seedData.ts:114` | bundle 字面量加键（哪怕 `[]`），否则 `replaceAllData` 在 `bundle[t].map` 上抛 TypeError |
| 17 | `src/pages/SettingsPage.tsx:65,67` | 「清空全部数据」的字面量 7 键加一（`:67`）**且 `:65` 的 confirm 文案要提专注会话**（现文案只列「目标、任务、打卡记录与复盘」） |
| 18 ⚠️ | `src/pages/SettingsPage.tsx:11-18` | `TABLE_LABEL` 加 `focusSessions: '专注会话'`。类型是 `Record<string,string>` ⇒ **漏加不报错**，界面渲染出 `undefined` |
| 19 | `src/store/actions.ts:594,606,621` | 新增番茄命令（§4.3）；级联软删要覆盖**三个**入口，`deleteTasks` 是**独立实现的批量路径**（BulkBar 多选删除），与 `deleteTask` 无复用关系，漏改不报错：<br>· `deleteTask(id)` / `deleteTasks(ids)` → 按 `taskId` 级联<br>· `deleteGoal(id)` → 按 `goalId` 级联（覆盖 `taskId` 缺省的目标级会话）<br>并把「J 条专注会话」计入 `deleteGoal` 的 confirm 文案。**漏 `deleteTasks` 的后果**：多选删任务后会话成孤儿，仍被 `effectiveMinutes` 计进该 goal，而用户在 UI 上再也找不到它们（§8.2 的「未归类」入口只收 `goalId` 缺省者） |
| 20 | `docs/SPEC.md` §三 / §十 | 按 CLAUDE.md「唯一事实来源」铁律补 `FocusSession` 与「第 7 张表」；`docs/PROGRESS.md` 追加决策记录 |
| 21 ⚠️ | `src/store/useStore.ts:169-178` | **`replaceAllData` 的 `set({...})` 加 `focusSessions: toMap(bundle.focusSessions)`**。与 `hydrate` 同型的硬编码 6 键，Partial 语义 ⇒ **漏加不报错**。而同函数 `:159-167` 的写盘循环是 `TABLE_NAMES` 驱动、自动生效 ⇒ **Dexie 已被墓碑化/替换，内存 map 仍是旧数据，当场分叉**。三条真实后果：① 「清空全部数据」后界面上会话仍在、计数仍是旧值；② 导入备份后 `exportBundle`（读内存）会把幽灵会话再导出去；③ **数据复活**——墓碑行在 Dexie 里带 `deletedAt` 而内存副本没有，此后任何 `updateFocusSession`/`reassignFocusSession` 走 `bulkPut` 会把不带 `deletedAt` 的整行写回，已删数据静默复活并推上云端。**严重度高于第 18 项** |

**索引一次到位**（第 3 项）：`id, goalId, taskId, date, updatedAt, [goalId+date]`
- `updatedAt` 是**同步推送的硬依赖**（`engine.ts:159` `where('updatedAt').above(...)`），不建会抛 `SchemaError`。
- `date` 是将来「窗口化载入」（§十容量红线）的必需索引；现在建好，将来切换无需再升 `version(3)`。
- `[goalId+date]` 对齐既有 `checkIns` 的复合索引形状，为按目标按日范围查预留（模板：`repos/index.ts:16-22` `getByGoalAndRange`）。
- ⚠️ **IndexedDB 语义备注**：keyPath 为 `undefined` 的行**不进该索引**。未归类会话（`goalId` 缺省）因此无法经 `goalId` / `[goalId+date]` 索引查到——将来谁想用 `where('goalId').equals(...)` 找未归类，一定会得到空集。`date` 恒存在，故 §10.2 的窗口化载入不受影响。

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

**用户需要做的唯一一件事**：登录 Supabase Dashboard → SQL Editor → 整段粘贴上面的 0002 → Run 一次。README 需补这一步。

⚠️ **0001 执行后不得再单独重跑 0001**：`0001_init.sql:71-93` 的 `upsert_rows` 白名单是硬编码 6 表，重跑一次会把 0002 加的 `focus_sessions` 静默改回去，随后推送报 `upsert_rows: 非法表名 focus_sessions`。在 `0001_init.sql` 文件头加一行注释指向 0002。

#### ⚠️ 不执行 0002 的真实后果：**整个云同步全表停摆**（S2 评审纠正）

规格初稿写的「该表永不同步 + 控制台报错」是错的。真实链路（`src/db/sync/engine.ts`）：

- `syncNow` 里 `pullAll`（`:95`）在 `pushAll`（`:96`）**之前**；
- 远端表不存在时 PostgREST 返回 error → `:129` `throw new Error('拉取 focus_sessions 失败：...')`；
- 该异常被 `:102-107` 的 catch 接住 → `useSyncStore.status = 'error'`（`SyncIndicator` 常亮红，不是控制台日志）；
- ⇒ **`pushAll` 与 `cleanupTombstones` 整个不执行** ⇒ goals/tasks/milestones/checkIns/exemptions/reviews **六张老表也全部停止推送**，且每 5 分钟、每次 focus/visibilitychange 重复失败。

把「忘了执行一段 SQL」升级成「全量云同步静默中断」是不可接受的 —— 但注意这个后果的**触发条件只有一个**：远端表不存在（永久性失败）。

#### S3 裁决（2026-08-13）：**同步引擎一行不改**

初稿评审开的处方是「`pullAll` / `pushAll` 的每表循环体各包一层 try/catch，失败即 `continue`」。S3 落地前复核发现**照这个字面实现会引入比原问题更严重的静默丢数**：

- `pushAll` 的推送游标是**全局单值**，在整个表循环**之后**才 `cursors.push = t0`（`engine.ts:155,175`）。
- 若吞掉某张表的推送异常并继续，游标仍会推进 ⇒ 那张表的脏行从此**永久低于游标、再也不会被推送**（除非该行日后又被改写）。
- 而现状的 fail-fast 恰恰是安全的：整轮失败 = 游标不动 = 下一轮（3 秒防抖 / 5 分钟 / 每次 focus）自动重试。

要在推送侧做到真正的单表隔离，必须把 `cursors.push` 改成 per-table 并迁移已存在的老游标（旧值是 `string`）—— 那是动所有 7 张表共用的游标结构，风险与收益不成比例。拉取侧虽可安全隔离（游标本就 per-table），但**用户已执行 0002**，永久性失败条件消失，剩下的只有网络/RLS 之类的瞬时失败，而瞬时失败每轮自愈。

⇒ **保持 fail-fast**。失败不是静默的：`useSyncStore.status = 'error'` + `error` 文案会在 `SyncIndicator`（顶栏常亮红）与设置页云同步区同时显示，文案本身已含表名（`拉取 focus_sessions 失败：…`）。

若将来再加表，把「先在 Supabase 执行对应 migration，再部署前端」作为顺序约定；这条已写进 §十二 S3 与 README。

### 4.3 写入路径与 undo 语义

铁律：**运行中状态一律不进 `useStore`**，只有「一次已结束的会话」走一次 `execute`。

理由（`01-facts` §3）：一次 `execute` = 恰好一格 undo，栈上限 100（`useStore.ts:30`）；一天几十次写入会把甘特图的编辑（拖 bar、改名、批量平移）全部挤出栈，`Ctrl+Z` 变成「撤销番茄心跳」；且 `execute` 无条件 `redoStack: []`（`useStore.ts:111`），番茄后台写入会持续清空重做栈，让 `Ctrl+Shift+Z` 在番茄运行期间形同失效。这是功能性破坏，不只是性能问题。

与之同构的既有先例：拖拽「高频阶段只直写 DOM、落手才提交一次 `execute`」（`PROGRESS.md:121`）。

新增 action（全部在 `src/store/actions.ts`，遵守文件头铁律「只构造受影响实体的新对象，未动实体保持引用」）：

| action | label（undo toast 文案） | 说明 |
|---|---|---|
| `commitFocusSession(session)` | `记录专注 25 分钟「MM 模块」` | 结算落库，一条命令。`< 60s` 时调用方已早退，不到这里 |
| `addManualFocusSession(args)` | `补录专注 40 分钟「MM 模块」` | `source: 'manual'`，`plannedMs = focusMs` |
| `updateFocusSession(id, patch)` | `修改专注记录` | 改时长即置 `source: 'manual'` **且必须同时 `plannedMs = focusMs`**（否则「把 25 分钟会话改成 90 分钟」会打破 §三 声称的 `focusMs ≤ plannedMs` 恒等式）；改归属不改 source |
| `deleteFocusSession(id)` | `删除专注记录` | 软删 |
| `reassignFocusSession(id, {goalId, taskId})` | `改归属为「英语 · 听力」` | 未归类清理入口用 |

**undo 边界（必须实现的两条）**：
- **所有会话列表 / 未归类清理入口一律过滤 `deletedAt`**，禁止对软删行执行任何 action。否则「删目标（级联软删 N 条会话）→ 对其中一条改归属 → `Ctrl+Z` 撤销删目标」会用陈旧整行覆盖（`01-facts` §3.4 的机制）。
- **undo 一条已结算的会话，不恢复 `RunningState`、不重开计时器**。撤销的是「这条记录」，不是「那段时间」。

**心跳绝不走 `persist`**：`persist.ts:53` 在落库后 `emitLocalWrite()` → 同步引擎 3 秒防抖（`engine.ts:224-231`）。若心跳每 5 秒写一次并触发它，`clearTimeout` 会**不断重置**那个防抖 ⇒ 番茄运行期间云同步被无限推迟，直到停止写入 3 秒后才推。运行中状态因此只写 localStorage（同步 API，无防抖，崩溃也只丢最后一次心跳间隔）。

### 4.4 同步行为与一个坑

- **append-only 行在整行 LWW 下天然安全**：每条会话独立 `id`（nanoid），两台设备产生的是不同行，`on conflict (user_id, id)` 永不命中 ⇒ 只是两批 insert，不丢数据。这与「累加进单行」形成鲜明对比（后者在 LWW 下必然丢数）。
- **不设「全局唯一 running」不变量**：运行中状态不同步，两台设备各跑一个番茄各自结算成独立行，都计入统计——这是正确行为，不是冲突。
- **墓碑清理不会误删历史会话**：过滤条件第一项就是 `e.deletedAt` 存在（`engine.ts:184`）；云端 `delete().lt('deleted_at', cutoff)` 对 `NULL` 求值非 true。代价在性能（每浏览器会话一次全表 `toArray()`），见 §十。
- **首次同步的推送游标**（S2 评审复核：初稿把它列为风险，实际已被 repo 层结构性堵死，降级为文档性约定）：拉取游标是 per-table 且缺省 `EPOCH`（`engine.ts:120`）⇒ 新表自动全量拉。推送游标虽是全局单值 `cursors.push`（`engine.ts:48,158,175`），但 `BaseRepo` 的 `put/bulkPut/softDelete/bulkSoftDelete/restore`（`baseRepo.ts:30,34,42,46-53,61`）**无条件把 `updatedAt` 重盖为 `nowISO()`**，而 `persist.ts:50-51` 是唯一的应用层落库通道 ⇒ 补录、编辑、软删、级联软删、undo 恢复、导入备份**全部**拿到当前时间戳，必定晚于游标。唯一不重盖的是同步引擎自己的 `rawTable(t).bulkPut`（`engine.ts:142`），写的是远端拉来的行，本就不需要回推。另 `pushAll` 的 `t0` 在循环**之前**捕获（`:155`），推送期间的新写入留给下一轮，无窗口丢失。
  **仍保留为约定**（防将来有人绕开 repo 直写）：`updatedAt` 永远是「这行最后一次被写的真实时刻」，业务时间只放 `startAt`/`date`。补录 1 月的会话，`updatedAt` 也是今天。

---

## 五、计时内核

### 5.1 铁律

1. **绝不 tick 累加**（`elapsed += 1000`）。后台节流会把计时器变成慢表：Chrome 的 intensive throttling 档下 25 分钟能「走」出几分钟。
2. **时长的唯一权威是 `Date.now()` 差值**。`performance.now()` 只做两件事：探测 `Date.now()` 跳变、驱动动画。规范要求 `performance.now()` 在系统睡眠期间继续走，但 Chrome/Firefox/Safari 在若干平台上都不合规 ⇒ 合盖后两者之差可能达几小时，这个差正是最好的跳变探测器。
3. **剩余时间 = f(持久化记录, `Date.now()`)**，每次需要时现算。因此多标签的显示一致性是免费的（同一台机器同一个时钟，各算各的结果必然相同）。
4. **绝不用 rAF 驱动倒计时**：本机浏览器面板 `document.hidden === true`，rAF 一帧都不会来；真实后台标签页里 rAF 也停摆。
5. **内核是模块单例，不进组件**（S2 评审新增）。闹钟 timeout、心跳、Web Locks 选主、结算、`RunningState` 读写**全部**是模块级状态，与任何 React 组件的挂载/卸载无关；`useIsMobile()`、面板开合、路由切换只控制**渲染**，绝不控制计时。
   反例后果：① 桌面窗口被拖窄到 `<768px`（`useIsMobile` 订阅 `change` 事件，会**实时**翻转）时胶囊卸载，若闹钟挂在组件里就随之消失、心跳也停 ⇒ 拉宽回来必然 `gap > 90s`，弹一次莫名其妙的结算对话；② React 18 StrictMode 的 dev 双调用会把 Web Locks 请求发两次（见 §5.6）。
6. **任何 `execute` 都必须在 `useStore.getState().hydrated === true` 之后**（S2 评审新增）。`hydrate` 是异步的（`App.tsx:82-91`，`:148-150` 在 hydrated 前整棵树不渲染），且它的 `set({...})` 会**整体替换** `focusSessions` map。若恢复结算写在模块体/`main.tsx` 里抢跑，`execute` 基于 `emptyMaps()` 造 map，随后被 `hydrate` 整个盖掉 ⇒ **行进了 Dexie 与 undoStack，内存里却没有**，「今日已专注」缺一段直到下次刷新。
   ⇒ 内核模块体只允许做「读 localStorage、装监听、拿锁」，**恢复判定与结算挂在 hydrated 之后触发**。

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
  lastHeartbeatAt: number; // 心跳（见 5.4）
}
```

⚠️ **`clockAnchor` 不得持久化**（S2 评审删除的字段）：`performance.now()` 的原点是**当前文档的 `timeOrigin`**，刷新即归零。把 `{wall, mono}` 存进 localStorage 后，重开时 `performance.now()` ≈ 几十 ms 而 `anchor.mono` 是上个文档里的任意值（可能是 300000）⇒ 差值恒为巨大值 ⇒ **只要跑满 2 秒再刷新一次，每条会话都被打上 `needsReview`**，「待确认」徽标沦为常态噪音，设计目标 4「安静」直接破功。
正确分工：
- **同文档内**跳变探测：anchor 只存**内存**（模块单例，随文档生死），公式照 §5.5 最后一行；
- **跨文档**跳变探测：不碰 `performance.now()`，只看时钟自洽性 —— `now < lastHeartbeatAt`（时钟回拨）或 `now - startAt < 净时长`（自相矛盾）才置 `needsReview`。

### 5.2b 节律计数（独立 key，不在 `RunningState` 里）

key：`yearflow:pomodoro:cycle`，值 `{ date: 'YYYY-MM-DD', completed: number, lastAt: number }`

S2 评审否掉了初稿的 `RunningState.cycleIndex`：`RunningState` 在每次回 `idle` 时被删（§5.2「清空 = 删 key」），而「自动开始休息」是 P1 不在 v1 ⇒ v1 里每段专注到点后 100% 走「回 `idle`」分支 ⇒ **`cycleIndex` 结构上永远是 0**，面板永远显示「第 1/4 段」，长休息永不触发，§11.3 的「连续跑 4 段确认长休息节律」无法通过。

三条规则（缺一不可）：
1. 只有 `outcome === 'completed'` 才 `completed++`；`stopped` / `discarded` 不算。
2. 走完一次长休息后 `completed = 0`。
3. 跨自然日 **或** `now - lastAt > 2h` 自动清零（否则昨晚那 3 段会污染今早的节律）。

判据是 **`completed > 0 && completed % longBreakEvery === 0`** —— 少了前半句，`completed === 0`（第一段还没跑）时也为真。单测必须覆盖这个负例。

- 为什么用 localStorage 而不是 Dexie：同步写入无防抖（Dexie 走 500ms 防抖，硬刷新会丢最后 ≤500ms）；不触发 `emitLocalWrite`（否则无限推迟云同步，§4.3）；天生设备本地不同步；`storage` 事件让其它标签页免费收到变更通知。
- 休息段（`shortBreak`/`longBreak`）**只存在于这里，永不落库**。

### 5.3 状态机

| 当前 | 事件 | 迁移到 | 副作用 |
|---|---|---|---|
| `idle` | 点「开始专注」/ 按 `P` | `focus` | 生成 `sessionId`；`startAt = Date.now()`；`plannedMs = focusMin × 60000`；解锁 AudioContext（必须在手势回调里 `resume()`）；下单根 `setTimeout(plannedMs)` |
| `focus` | 按 `P` / 点「暂停」 | `focus(paused)` | `pauses.push({at: now})`；清除 timeout |
| `focus(paused)` | 按 `P` / 点「继续」 | `focus` | 末条 `pauses.until = now`；按剩余时间重下单根 timeout |
| `focus` | timeout 触发 或 回到前台发现 `now ≥ 计划终点` | `shortBreak`/`longBreak`（P1，`autoBreak` 开且「刚刚到点」）否则 `idle` | 走 §5.3b 终止序列：**按计划终点结算并落库**（一条 `execute`）；`completed++`（§5.2b）；响铃 + 通知；面板显示结果卡。**最后**按 §十六 三道闸决定是否 `startBreak` |
| `focus` / `focus(paused)` | 点「停止」 | `idle` | 按实际净时长结算落库（`outcome: 'stopped'`） |
| `focus` / `focus(paused)` | 点「丢弃」 | `idle` | `outcome: 'discarded'` 落库（`focusMs` 照实记但不计统计），或 `< 60s` 时直接不落库 |
| `shortBreak/longBreak` | timeout / 点「跳过休息」 | `idle` | 响铃；不落库 |
| 任意 | 页面重开且读到 `RunningState` | 见 §5.5 | —— |

### 5.3b 终止序列（硬性顺序，防「一次会话两格 undo」）

S2 评审指出：§5.6 的「预生成 `sessionId` 幂等」只保证 **Dexie 行数**为 1，**保不住 undo 栈格数**——`execute` 是无条件入栈的（`useStore.ts:106-114`，`:111` 还无条件清空 redoStack）。用户在计划终点前几毫秒点「停止」、timeout 随后触发再结算一次 ⇒ **两格 undo**，且第二格把 `outcome:'stopped'` 覆盖成 `'completed'`；用户按一次 `Ctrl+Z` 得到的是 stopped 版本那一行，按两次才真删掉——正是 §6.2 承诺「永远可预期」的反面。同一竞态也发生在「非 leader 标签点停止 ↔ leader 的 timeout 恰好到点」。

**任何终止路径（到点 / 停止 / 丢弃 / 恢复结算 / 切任务）必须同步依次执行**：

1. `clearTimeout(alarmHandle); alarmHandle = null`
2. 查模块级 `settledIds: Set<string>` —— 命中 `sessionId` 则**整段早退**
3. `settledIds.add(sessionId)`
4. `localStorage.removeItem('yearflow:pomodoro:running')`
5. 才调 `execute` 落库
6. **落库之后**才响铃 / 弹通知（音频异常绝不允许阻断数据写入）

`settledIds` 是模块级 Set（不是组件 state），跨标签由第 4 步的 `storage` 事件兜底。
**结算落库失败（Dexie 异常）**：localStorage key 已在第 4 步删除，不回滚、不重试——宁可丢一段记录，也不要留一个状态不明的运行态；给一条 toast 说明。

### 5.3c 状态机全矩阵（初稿缺的格子，S2 评审补）

| 未定义迁移 | v1 定论 |
|---|---|
| `focus(paused)` 期间 timeout 到点 | **不可能发生**：暂停时已 `clearTimeout`。「暂停 3 小时后点继续」时**剩余量不变**（= 暂停那一刻的剩余量），按剩余量重下单根 timeout |
| `shortBreak/longBreak` 中按 `P` | = **跳过休息**，回 `idle`（不落库、不响铃）。不做「暂停休息」 |
| `focus` 中在面板里换任务 | 走 §5.3b 终止序列结算旧段（`outcome: 'stopped'`，`< 60s` 则不落库），**换新 `sessionId`** 立刻以新任务起一段新会话，`plannedMs` 重新计满。不做时间分摊（§二） |
| 窗口宽度掉到 `<768px` | 计时**照常跑**（内核是模块单例，§5.1.5），只是入口不渲染。拉宽回来无缝接上 |
| 读到 `phase !== 'focus'` 的残留运行态 | 见 §5.5 的休息总闸 |
| 结算落库抛异常 | 见 §5.3b 第 6 条 |

**「到点自动结算」是本设计消灭「忘记停」的主手段**：正常情况下用户根本没有「忘记停」的机会，因为到点即结算。只有页面在到点那一刻恰好被冻结/关闭时才走 §5.5 的恢复判定。

**闹钟为什么用单根长 `setTimeout`**：Chrome intensive throttling（1 次/分钟）的四个条件是 **AND**，其中一条是「定时器链长 ≥ 5」。单根长 timeout 链长为 1 ⇒ **结构上免疫 intensive 档**。绝不用「每秒 setInterval 自己数」。

两条 S2 评审的修正：

- ⚠️ **免疫 intensive ≠ 免疫 frozen**。初稿写的「最坏仍受 1s 级节流，对分钟级闹钟无影响」是过度承诺：Chrome Page Lifecycle 的 `frozen` 态下**所有** timer 都不跑（与链长无关），长时间隐藏、省电模式都可能触发。⇒ **`visibilitychange → visible` 的补算是必需路径，不是兜底**（§九第一行本来就依赖它）。设置页的诚实说明（§8.7）必须写进「切到后台后，到点提醒可能延迟」。
- ⚠️ **闹钟绝不在 timer 回调里直接 `setTimeout`**。HTML 规范的 timer nesting level 在「`setTimeout` 从定时器回调内部被调用」时递增；一旦将来接上 P1 的「自动开始下一段」，专注→短休→专注→短休→专注跑满就到链长 5，此后每根闹钟都掉进 1/min 档——恰好毁掉本节的核心论证。**实现约束**：回调里先 `postMessage`/`MessageChannel` 跳出一个新宏任务再下单，把链长永远钉在 1。这条同时写进 §十三「自动开始下一段」的前置条件。

**UI 刷新与闹钟分离**：显示用 1s `setInterval` 只做「读 `Date.now()` 重算并直写 DOM」，它不准也没关系（隐藏时没人看）；到点判定只认那根长 timeout + `visibilitychange` 时的补算。

### 5.4 心跳

**`focus` / `focus(paused)` / 休息三种状态下一律每 5 秒**写一次 `lastHeartbeatAt`，另外在 `visibilitychange(hidden)` 与 `pagehide` 时各强制写一次。

⚠️ **暂停期间必须继续写心跳**（S2 评审）：否则「暂停去开会 2 分钟回来刷新页面」⇒ `gap = 120s > 90s` ⇒ 命中 `ask` 分支，弹一次完全无必要的「刚才那段算不算」对话。这在日常使用里天天发生。

- **不用 `beforeunload` / `unload`**：极不可靠，且注册 `unload` 监听会破坏 bfcache。`hidden` 是最后一个可靠可观测的状态。
- 崩溃 / 杀进程 / discarded 没有任何回调 ⇒ 心跳是唯一手段，最多丢 5 秒。

### 5.5 中断恢复判定（阈值按值执行）

页面加载时（**且 `hydrated === true` 之后**，§5.1.6）若读到 `RunningState`，令：

- `now = Date.now()`
- `gap = now - lastHeartbeatAt`
- **`暂停总时长 = Σ((p.until ?? now) - p.at)`** —— 末条未闭合的暂停按 `now` 闭合。与 §七 `netFocusMs`「末条未闭合暂停按 `endAt` 闭合」**必须是同一口径，同一个函数**
- `plannedEnd = startAt + plannedMs + 暂停总时长`

初稿是一张**无序**的条件表，S2 评审证明多行会同时命中且结论互斥（`now ≥ plannedEnd` 与 `>4h` 同时成立时 outcome 取哪个？`resume` 分支根本没有「结算」动作，`needsReview` 无处可挂）。**改为带优先级的有序 if-else 链，从上往下第一个命中者胜出**：

| 序 | 条件 | 处理 | 是否打扰用户 |
|---|---|---|---|
| 0 | **`phase !== 'focus'`（休息总闸）** | `now ≥ plannedEnd` → 静默回 `idle`（仅当 `now - plannedEnd < 60s` 才补响铃）；否则 `gap ≤ 90s` → 续跑休息，`gap > 90s` → 静默回 `idle`。**任何分支都不落库、不弹对话、不动节律计数** | 不打扰 |
| 1 | `now - startAt > 4h` | `hardCut`：强制结算，`focusMs = min(净时长, plannedMs)`，`outcome: 'completed'`，`needsReview: true` | 结果卡带待确认徽标 |
| 2 | **正在暂停中**（末条 `pauses.until` 缺省） | `resume`：**暂停中的会话永不自动结算**，原样恢复到暂停态 | 不打扰 |
| 3 | `now ≥ plannedEnd` | `settleAtPlannedEnd`：`outcome: 'completed'`，`focusMs` 取到 `plannedEnd` 为止的净值；`gap > 90s` 时附 `needsReview` | 面板显示结果卡（带「刚才不在，已按计划结算」说明），不弹阻塞对话 |
| 4 | `gap > 90s` | `ask`：暂停在 `lastHeartbeatAt` 处，弹**结算对话** `[算到刚才 X 分钟]` / `[继续跑]` / `[丢弃]`。X = `netFocusMs(startAt, lastHeartbeatAt, pauses)`，**不是裸截断**（否则暂停时长会被重复扣一次） | 一次明确选择 |
| 5 | 其余（`gap ≤ 90s` 且未到点） | `resume`：无缝续跑（正常刷新/切页） | 不打扰 |

两处关键修正的理由：

- **第 0 行（休息总闸）**：初稿的表全部以「结算并落库 `FocusSession`」为动作，而 `RunningState.phase` 有三个取值。休息中关页面再打开会命中「`now ≥ plannedEnd` → 按计划终点结算 `completed`」⇒ **写出一条休息伪装成的专注会话**，直接污染 `effectiveMinutes` 与全部复盘数字；更荒谬的是第 4 行会为一段休息弹「刚才那段算不算」。
- **第 2 行（暂停优先于到点）**：初稿的「暂停总时长」在末条暂停未闭合时无定义，若实现者读成「只累加已闭合暂停」，则「暂停 2 小时后重开」会让 `plannedEnd` 停在两小时前 ⇒ 命中到点分支 ⇒ **把一段用户明明按了暂停的会话按 `completed` 全额结算落库**。这是直接的「记错时间」。

**`needsReview` 是横切标记，不是分支**：跳变探测（§5.2 的两条自洽性检查 + 同文档内存 anchor 差 > 2000ms）只产出一个 boolean，叠加到最终结算结果上；落到 `resume` / 休息总闸时直接丢弃。⇒ `planRecovery` 返回 `{kind, focusMs?, needsReview: boolean}`，`kind ∈ {'resume','settleAtPlannedEnd','ask','hardCut','dropSilently'}`。

**结算 clamp（无条件执行）**：`focusMs = clamp(净时长, 0, plannedMs)`。越界（负数或超上限）一律 `needsReview: true`。
→ 「系统时钟被 NTP 校正」「用户改时区」造成的负时长或 8 小时假会话，结构上不可能落库。

### 5.6 多标签一致性

- **显示**免费一致（§5.1.3）。需要协调的只有**副作用**：响铃、弹通知、写结算记录。否则 3 个标签会响 3 声、弹 3 条、写 3 次。
- **选主用 Web Locks**：`navigator.locks.request('yearflow-pomodoro', {mode:'exclusive'}, () => new Promise(() => {}))` —— 请求一把**永不释放**的锁，拿到锁的标签即 leader。标签关闭/崩溃 → 锁自动释放 → 下一个标签自动接位。**崩溃安全，不需要心跳超时**，这是它相对 BroadcastChannel 选主的决定性优势。
- **两条实现约束**（S2 评审）：
  1. **锁请求必须在模块顶层、全文档只执行一次**。放进 React `useEffect` 会被 StrictMode 的 dev 双调用发出第二次 request，而 `() => new Promise(() => {})` 的回调**永不 resolve、锁永不释放**，`AbortSignal` 在授予之后也无法回收 ⇒ 第二个请求永久排队且卸载时无法清理，属结构性泄漏。
  2. **拿到锁不是同步的**：回调只在轮到本标签时才执行 ⇒ `isLeader` 初值必须是 `false`，并显式定义「尚未选出 leader 时到点了」= 所有标签都不响铃（可接受，窗口极短）。**leader 换人时（原 leader 关闭、新 leader 上位）新 leader 必须立即重下闹钟**——它此前作为 follower 没有 timeout。
  3. ⚠️ **「有没有 leader」这个标记必须在拿到锁之前就置位**（S4 实测新增，`kernel.ts` 的 `leaderKnown`）。S3 实现把它写在授予回调里 —— 那是 leader 视角，而它真正的消费者是 **follower**（`onAlarm` 的 `!isLeader && leaderKnown` 门禁）。等自己拿到锁才置位 ⇒ 排队中的 follower 永远认为「还没选出 leader」⇒ **每个标签都自己结算、自己响铃**。S4 双标签实测：**follower 抢先落库**（leader 反被自己的 `storage` 事件挡回 `settledIds`），于是结果卡与响铃出现在用户没在看的那个标签，声音响两遍。Dexie 行数靠预生成 id 仍是 1 ⇒ 不丢数、不报错，纯粹是「响两声 + 卡片跑错标签」，正是最容易被当成玄学的一类缺陷。
     ⇒ **只要 `navigator.locks.request` 存在就立刻 `leaderKnown = true`**，只有 request 本身 reject（API 不可用）才降级回 `false`（此时各标签各自负责，靠幂等 id 保住行数）。修正后复测：leader 落库 + 结果卡 + 节律 +1，follower 零写入、零 undo、干净回 idle。
- 非 leader 标签：照常显示倒计时、照常可操作（操作会写 localStorage，leader 通过 `storage` 事件感知），但**不响铃、不弹通知、不执行结算落库**。
  例外（有意如此）：`catchUp` / `initPomodoro` 的**恢复结算不受 leader 门禁约束** —— leader 恰好是被冻结的那个标签时，只有前台标签能救回这段时长；重复由 `settledIds` + 幂等 id 兜住。
- 落库幂等兜底：结算用预生成的 `sessionId` 作为 id ⇒ 即使出现双写也只是同一行被覆盖两次，不会产生两条。
- 不引入 BroadcastChannel：`storage` 事件已经免费提供跨标签通知（运行状态本来就存在 localStorage）。

### 5.7 声音与通知

**声音**（默认开）：用 `OscillatorNode` 现场合成两声短促柔和音——880Hz → 1174Hz，各 90ms，指数衰减，峰值 gain 0.12~0.2，总时长 < 400ms。不引入音频文件（省一次请求、省 PWA 预缓存体积、天然离线、不占 bundle）。
- `AudioContext` **必须在「开始专注」的手势回调里创建并 `resume()`**（autoplay policy：手势之前创建会是 `suspended`），之后全程复用同一个实例。
- ⚠️ **播放前必须重新检查 `state`**（S2 评审）：从创建到响铃隔着 25 分钟，页面进过 bfcache/frozen 会让上下文被 suspend。播放前一律 `if (ctx.state !== 'running') await ctx.resume()`（该文档已有 sticky user activation，非手势 resume 会被允许）；`resume()` 失败则**静默降级**到通知/title 闪烁，绝不 toast 报错。响铃在 §5.3b 的序列里排在**落库之后**。
- 桌面 Chrome 后台标签页可以播（音频恰是节流豁免项）。不承诺锁屏能响。

**通知**（默认关）：`new Notification(...)`，**只在用户主动打开「到点提醒」开关时请求权限**——绝不在页面加载时请求（Chrome 对滥用者有更安静的权限 UI 惩罚）。
- 只在**页面隐藏**时发通知；页面在前台时用页内结果卡 + 声音（用户就在看着页面，弹系统通知是最差选择）。
- **必须带 `tag: 'yearflow-pomodoro'`**：零成本的双弹去重兜底，Web Locks 选主失效时唯一的防线。
- ⚠️ **已知瑕疵，v1 接受**：这个条件的正确形式是「没有任何 YearFlow 标签在前台」，而 leader 只知道**自己**的 `document.hidden`。两个标签、leader 是后台那个、用户正盯着前台那个 ⇒ 仍会弹系统通知。修它需要各标签把 `{tabId, hidden, at}` 写进一个 localStorage 心跳 key 供 leader 汇总；v1 不做（单人单窗口是常态），但必须记在这里，别当 bug 查。
- 权限被拒 → 降级为 `document.title` 闪烁（交替两个字符串），**必须有停止条件**：用户回到页面、30 秒超时、**用户开始了下一段番茄**（此时 title 应立刻变倒计时）、**leader 换人**——四条任一即停。
- v1 不碰 Service Worker（§二）。

**`document.title` 倒计时**：只在 `document.hidden` 时更新，频率 1/s，格式 `12:34 · YearFlow`。
- 可见时不更新（页面上已有大号倒计时），避免屏幕阅读器每秒朗读一次标题。
- `restoreTitle()` 写成**幂等函数**，在**五处**调用：`visibilitychange→visible` / 离开 running 态 / 组件卸载 / `pagehide` / **任何新的 title 写入之前**。恢复目标是 `YearFlow — 年度计划`（`index.html:8`）。
- 隐藏标签本身被节流 ⇒ title「跳秒」是正常现象，不为此加 Worker。

### 5.8 DEV 观测句柄（必需，不是可选）

初稿写的 `window.__pomodoro = usePomodoroStore` **不够用**（S2 评审）：§11.2 的两条用例照它写根本跑不了 —— ①「剩余时间」按 §5.1.3 铁律是现算的，`getState()` 里**不存在**这个字段可读；②「`plannedMs` 改小到 3s」无从注入，`plannedMs` 唯一来源是 `settings.pomodoro.focusMin`（整数分钟）。⇒ DEV 句柄改为显式测试面：

```typescript
if (import.meta.env.DEV) window.__pomodoro = {
  store: usePomodoroStore,
  remainingMs: () => number,              // 现算，供挂钟对照
  start: (opts?: { plannedMs?: number; taskId?: string }) => void, // plannedMs 覆盖，供 3s 跑完用例
  forceSettle: () => void,                // 立即走 §5.3b 终止序列
};
```

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

> 命名约定：**口径统称 `effectiveMinutes`**（本文档其余地方沿用这个说法），但**函数与中间量一律以 ms 为单位、名字带 `Ms`**，只有渲染那一行才 `round(ms/60000)`。见下方「全程以 ms 为单位」。

**问题**：同一天同一任务可能同时有手填 `minutes` 和番茄会话。相加必然重复计（用户手填时往往是估算整天，已含番茄那部分）；只取自动会丢掉「没开计时器的那一小时」；只取手填会丢掉真实数据。

**口径**：`max(自动, 手填)`，**在 (goal, task, date) 粒度上取 max，再求和**。

```
effectiveMsByGoalDate(checkIns, sessions, goalId, date):
    manualMs[taskKey] = Σ (CheckIn.minutes ?? 0) × 60000   // 同 (goal,task,date) 键，taskId 缺省归入 '' 桶
    autoMs[taskKey]   = Σ focusMs                          // outcome !== 'discarded'、!deletedAt
    return Σ over taskKey  max(manualMs[taskKey], autoMs[taskKey])
```

为什么按任务分桶而不是直接在目标级取 max：一个目标下任务 A 手填 60 分、任务 B 跑了 25 分钟番茄，目标级 max 会得到 60（丢掉 B 的 25）；分桶后是 60 + 25 = 85，正确。仍然只有一种算法。

一句话可向用户解释：**「取更完整的那个」**。

#### ⚠️ 全程以 **ms** 为单位，只在最外层显示时取整（S2 评审修正）

初稿伪码写的 `Σ round(focusMs / 60000)` 与 §九 自己立的规矩「存 ms，只在显示层取整；**聚合永远从原始值算**」直接冲突：4 段各 25 分 29 秒，逐段 round 得 100 分，整体 round 得 102 分，误差随段数线性增长，且「面板今日已专注」与「月度投入」会给出**两个都对但不一样**的数——正是既有先例（`AnnualOverview.tsx:115-130`「避免累加已四舍五入的月值」，`PROGRESS.md:193`）要挡的事。
⇒ 派生层函数一律 **ms 进 ms 出**（手填分钟 ×60000 后参与 max），命名带 `Ms`；`round(totalMs/60000)` 只出现在**渲染的那一行**。

#### `taskId` 缺省桶（`''`）的合并规则

`''` 桶按上式与其它桶同样处理，即 `+ max(manualMs[''], autoMs[''])`。

评审提出过一个反例：用户在目标级手填「今天这个目标花了 60 分」（落 `''` 桶），同时给该目标下任务 t1 跑了 50 分番茄（落 `'t1'` 桶）⇒ 60 + 50 = 110，构成 §6.4 声称要消灭的重复计。**裁决：接受此瑕疵，不改公式**，理由是复核后确认它只发生在历史数据上：

- 全仓 `setCheckIn` 的调用点（`GoalCheckCard.tsx:56,111,121`、`CheckinPopover.tsx:94,106,116`）与 `batchCheckIn`（`actions.ts:411-421`）**全部传具体 `taskId`**；`CheckinPopover` 的 `anchor.taskId` 在 `GanttView.tsx:563` 被直接用作 `tasks[anchor.taskId]` 索引 ⇒ 现行 UI **没有任何路径**写出 `taskId` 缺省的打卡（那是 `dayPanel.test.ts:154-158` 的 `legacyRecord` 老数据）。
- 而**改公式的代价是硬的**：任何在目标级取 max 的写法，都会让「空 `sessions` 时结果与改造前完全一致」这条回归护栏失效（改造前是 `Σ manual_t + manual_''`），`review.test.ts` 那 5 条就不再是护栏。

⇒ 记入 §十三 局限清单：**「目标级手填 + 任务级番茄会相加」，仅影响历史遗留的目标级打卡记录。**

#### 分桶必须按「打卡记录的实际日期」，不能按 `dayset`

`monthlyGoalStats` 内部有一个「应打卡日集合」；若照它遍历取数，会丢掉**非应打卡日**的手填分钟 ⇒ 空 `sessions` 时结果与改造前不一致，回归护栏当场失效。实现时按 checkIn 自身的 `date` 分桶。

**配套 UI**（消除重复填写的动机）：当天该任务有会话时，分钟输入框 placeholder 显示自动值（如 `自动 50 分`），并在卡上让「自动」与「手填」两个数并列可见——两个数、一个结论。

### 6.5 消费端改造（穷举，共 4 处）

`minutes` 的全部消费者只有复盘页与年度总览（`01-facts` §5.2 已穷举）。改造点：

| 位置 | 现状 | 改成 |
|---|---|---|
| `src/lib/derive/review.ts:50-54` `monthlyGoalStats` | `minutes += c.minutes ?? 0` | 走 `effectiveMsByGoalDate` 逐日求和（按 checkIn 自身 `date` 分桶，**不是按 `dayset`**），最后一次取整 |
| `src/lib/derive/review.ts:97-111` `minutesByGoalByMonth` | 直接累加 `c.minutes`；签名是 `(checkIns, year)` → `Map<month, Map<goalId, number>>`，**按年一次算完 12 个月** | 走 `effectiveMsByGoalByYear`（形状同构，一次遍历；goalId 键集合并入 sessions） |
| `src/review/AnnualOverview.tsx:116-130` `totals`（投入总时长卡） | **不复用 review.ts，自己重新遍历 checkIns** | 同上（保留「不累加已四舍五入的月值」的既有正确性，`PROGRESS.md:193`） |
| `src/pages/ReviewPage.tsx:73-87` + `:170` | 显式构造参数对象调 `monthlyGoalStats`，依赖数组在 `:86`；`AnnualOverview` 是 `memo` 组件、靠 props 接数据（`:90-96` 只有 `goals/tasks/milestones/checkIns`） | **加 `focusSessions` 订阅 + `sessionList` 的 `useMemo` + 传参 + `:86` 依赖数组 + 给 `AnnualOverview` 加 `sessions` prop**（共 4 处） |

⚠️ 初稿写的「`ReviewPage.tsx:88` 消费 `monthlyGoalStats` ⇒ 自动生效，零改动」**是错的**（S2 评审）：`sessions` 参数缺省为空正是「不传就退化」——不传 = **番茄数据永远不进复盘**，功能等于没做，而 `tsc` 全绿、测试全绿，是典型的静默失效。消费端因此是 **4 处**，不是 3 处。

**回归护栏（照抄 `buildRowLayout` 那次的手法）**：这两个 review 函数**新增 `sessions` 参数且缺省为空**，缺省时行为与改造前**完全一致** ⇒ `review.test.ts` 既有 5 条测试一行不改仍全绿，它们就是回归护栏。

**顺带记录、但本次不改的既有口径瑕疵**（`01-facts` §5.3，避免下次误以为是番茄钟引入的）：
- `monthlyGoalStats.minutes` 不排除 `status === 'skipped'` 的 `minutes`（现网看不出来只因种子数据 skipped 的 minutes 是 `undefined`）。
- 同一函数内两套去重规则：完成分用「同日取最强」，时长用直接累加。
- 免打卡区间不影响投入时长——这是**正确的**（出差期间的专注照常计入），明确保留。
- 跨设备并发可能产生同 `(goal, task, date)` 的重复 `CheckIn`，`review.ts:52` 现状是两条都加。`effectiveMs` 不修复它，但会让它从「时长偏大」变成「时长偏大且盖住真实自动值」（max 的一侧被撑大）。

---

## 七、派生与统计

新文件 `src/lib/derive/focus.ts`（纯函数 + vitest，不入库，遵守 CLAUDE.md）。

| 函数 | 签名要点 | 口径 |
|---|---|---|
| `settleSession(running, now, opts)` | `RunningState → FocusSession \| null` | 结算的**唯一**实现：算净时长、扣暂停、clamp 到 `plannedMs`、判 `needsReview`、`< 60s` 返回 `null`。UI 与恢复流程共用同一函数（预览与提交零口径漂移，照 `batchCheckIn` dryRun 的先例） |
| `netFocusMs(startAt, endAt, pauses)` | 纯算术 | 扣除全部暂停区间；末条未闭合暂停按 `endAt` 闭合 |
| `planRecovery(running, now)` | → `{kind:'resume'\|'settleAtPlannedEnd'\|'ask'\|'hardCut'\|'dropSilently', focusMs?, needsReview: boolean}` | §5.5 的**有序** if-else 链（含休息总闸），纯函数，全部阈值与优先级可单测 |
| `focusMsByTaskDate(sessions, date)` | → `Map<taskKey, ms>` | 排除 `discarded` 与软删。**返回 ms**（§6.4 的 ms 铁律） |
| `effectiveMsByGoalDate(checkIns, sessions, goalId, date)` | → `number`（ms） | §6.4 口径 |
| `effectiveMsByGoalByYear(checkIns, sessions, year)` | → `Map<month(1-12), Map<goalId, ms>>` | **与既有 `minutesByGoalByMonth(checkIns, year)` 的形状同构**（`review.ts:97-100` 是按年一次算完 12 个月，`AnnualOverview.tsx:99` 一次性消费），一次遍历。⚠️ **goalId 键集合 = checkIns ∪ sessions**：现行实现的键全来自 checkIns，只有番茄没打卡的目标会整个缺键 |
| `todayFocusMs(sessions, date)` | → `number`（ms） | 面板「今日已专注」 |
| `unassignedSessions(sessions)` | → `FocusSession[]` | `goalId` 缺省者，供「N 段未归类」清理入口 |
| `focusIndexForGantt(sessions, year)` | → `{ focusDaysByTask: Map<taskId, Set<date>>, msByTask: Map<taskId, ms> }` | §6.3 甘特中间态 + §8.6 bar tooltip **共用同一次 `useMemo`**（避免两次全表扫）。⚠️ **`range` 必须是「当前 `yearInView` 全年」，绝不能是可视日期范围**——甘特图到处是 `visStartDate/visEndDate` 的列虚拟化，依赖里带上它就是每帧全表扫 8000 行会话，滚动直接掉帧，比初稿担心的 `useGanttDerive` 失效更严重。依赖仅 `[focusSessions, year]`<br>**S5 实现期改签名**（初稿是 `(checkIns, sessions, year)` → `noCheckInDaysByGoal`）：① 「无打卡」在渲染侧本来就成立——`CheckinDots` 只在 missed / 占位两个分支上加描边，这两个分支的定义就是「该任务该日没有打卡记录」；② goal 粒度会串味——目标 G 下任务 A 已打卡、任务 B 只跑了番茄时，goal 级取交集会把 B 的标记整个抹掉，恰恰是 §6.3 要解决的场景。⇒ 收成 task 粒度、不吃 `checkIns`，顺带消掉了「每次打卡编辑全表重扫」那笔已知代价 |

**已知代价（初稿写在这里的那条已在 S5 消失）**：初稿的 `focusIndexForGantt` 吃 `checkIns`，任何一次打卡编辑都会触发全表重扫；S5 改成 task 粒度、不吃 `checkIns` 后，只有会话写入或换年份才重扫。

**未归类会话不进任何 goal 级统计**（所有聚合入口都带 `goalId`；`ReviewPage.tsx:60-66` 与 `AnnualOverview` 只遍历 `goals` 列表，且 `:63` 还过滤了 `archived`）。⇒ 面板「今日 1 小时 25 分」与复盘的数可能对不上，正是 §十四 说的「两套投入数字是可信度杀手」。**因此 §8.2 的「N 段未归类」入口必须常驻可见，且复盘页要加一行灰字**：`另有 N 段未归类（M 分）未计入`。归档目标的会话同理不进复盘。

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
| 专注中 | `🍅 12:34`（**只显示时间**，任务名放 `title` 属性与面板里） | `--accent` 文字 + `--accent-soft` 底 |
| 暂停中 | `⏸ 12:34` | `--warning` |
| 休息中 | `☕ 4:12` | `--text-secondary` |

**倒计时刷新方式（硬性）**：单例 1s ticker **直写 DOM 的 `textContent`**，零 React 重渲。
理由：番茄钟在任何页面都可能开着；若每秒 `setState`，甘特页每秒重渲一次会直接违反「拖拽 60fps / 缩放 <150ms」门槛。React 只在**状态迁移**时重渲（开始/暂停/结束/切阶段），一次番茄最多几次。

⚠️ **不能照抄 `dragHint.ts`**（S2 评审）：那个样板之所以绝对安全，是因为它的元素由 `document.createElement` + `body.appendChild` 造出来（`dragHint.ts:11,27`），**完全在 React 树之外**；而胶囊在顶栏 JSX 里，`App` 每次重渲（主题切换 `App.tsx:201`、`setPaletteOpen`、`setHelpOpen`、hydrate）都会重渲整个 header 子树，把 ticker 写的值刷掉，倒计时随机跳回旧值。

**实现约束**：承载倒计时的元素**必须是空元素** —— `<span ref={tickRef} className="tnum" />`，JSX 里**零 children**，文本只由 ticker 经 ref 写入；状态迁移时也走同一个 ticker 函数刷新文本，而不是让 React 渲染它。
**ticker 维护一个 `Set<HTMLElement>` 订阅者**，胶囊、面板 hero 数字、进度环共用这一个 1s 单例。

**为什么胶囊不带任务名**（S2 评审的手感风险）：右侧簇现有 SyncIndicator（28px）+ `?`（~26px）+「主题：跟随系统」（~95px）+ gap，中间 `GanttToolbarSlot` 是 `flex-1`（`App.tsx:179`）且已塞进九组控件；再插一个「🍅 12:34 · MM 模块」（~140px）在 1280px 宽度下只能从工具栏抢空间。只显示 `🍅 12:34`（~64px）是代价最小的解。
另注：`SyncIndicator` 在未配置 Supabase 时**整个返回 `null`**（`SyncIndicator.tsx:32`）⇒「插在它之前」在部分环境下等于「右侧簇第一个」，间距必须靠父级 `gap` 而不是相邻选择器控制。

**挂载点**：`App.tsx:233-237` 那串浮层兄弟节点的末尾（`ShortcutHelp` 之后）放面板与结果卡的 portal 宿主；胶囊本身在顶栏内。两者都在 `BrowserRouter` 内，拿得到 router context（结果卡的「去甘特图定位」需要）。

### 8.2 面板（点胶囊展开）

宽 **320px**，照 `SyncIndicator.tsx:44,62-71` 的 `relative` 父 + `absolute` 子模式（不 portal，顶栏下拉的既有写法）。点外部 / 再点胶囊关闭；`Esc` **不参与**（见 8.5）。

自上而下：

1. **hero 倒计时** `25:00`，`--font-32` + `.tnum`，居中；左侧同行一枚进度环（直径 48，线宽 3，`--accent` 描边，`rotate(-90)` 起点在 12 点方向，几何常量进 `src/pomodoro/constants.ts`）。
   ⚠️ **hero 数字与进度环的 `stroke-dashoffset` 同样走 ref 直写**，与胶囊共用 §8.1 那个单例 ticker。初稿只规定了胶囊的直写方案，而这两个也必须 1 Hz 变化——按常规 setState 写就是每秒 1 次重渲，§10.1 的「每秒 0 次」当场破功；若那个 state 还放进 `usePomodoroStore` 而 App 层也订阅了它（§5.8 暴露的正是这个 store），会变成**整个 App 树每秒重渲**，甘特拖拽 60fps 门槛直接失守。
   **推论（写死）**：`usePomodoroStore` 里**不得存放任何每秒变化的字段**，剩余时间永远现算。
2. **阶段与节律**：`专注 · 第 2/4 段`（段数读 §5.2b 的独立 key）或 `短休息`，`--font-12` `--text-tertiary`。
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
  **必须同时给一个 `[知道了]`**（清 `needsReview`，走 `updateFocusSession`，不改时长故不置 `source:'manual'`）。否则用户认可现状、什么都不想改时，徽标永远挂着没法消——完整的确认流是 P1，但**清除路径 v1 就必须有**。
- **`< 60s` 被静默丢弃时给一条极轻的 toast**：「这段不足 1 分钟，未记录」。否则用户开了 30 秒发现开错、按 P 暂停去改任务（§5.3c 会把它切成两条会话，第一条被丢弃），会怀疑「刚才那 30 秒去哪了」。
- 到点结算时同时：响铃（若开）+ 通知（若开且页面隐藏）。

### 8.4 打卡页接入（`src/checkin/GoalCheckCard.tsx`）

**入口位置**：`TaskRow` 行内（`:213-224`，与 `StatusButtons compact` 并列）与单任务目标的卡头簇（`:300-305`）。
理由：这是 `(goalId, taskId, date)` 三元键**唯一齐备**的层。目标级卡头在多任务目标下拿不到 `taskId`，与「按任务统计真实投入」直接相悖。`AdhocSection.tsx:15` 已经演示了复用路径（手工整出同形 `DayTaskEntry` 再喂给共用件）。

**形态**：一枚 ▶ 小按钮（`--font-12`，hover 才显色），点击 = 以该任务启动番茄。仅 `date === todayStr()` 时渲染（补卡历史日期不该启动计时器）。

**分钟输入框**：当天该任务有会话时，`TaskEditor` 的自定义分钟 input（`GoalCheckCard.tsx:148-172`）placeholder 显示 `自动 50 分`，并在 `N分` 展示位（`:217-221`）把自动值与手填值并列（`50 分（自动）` / `60 分`）。**不预填、不覆盖**——手填永远是用户的显式动作。
⚠️ **展示位有两处，`AdhocSection.tsx:28-30` 是平行的第二处**（「随缘」任务当日记录）。漏了它就会出现：§九 明确要求 adhoc 任务能被计时，而 adhoc 区反而看不到自动值。

⚠️ **FLIP 约束**：`useFlip` 会对 `listRef` 子树里所有 `[data-flip-id]` 元素做 WAAPI translate（260ms）。启动按钮是静态元素没问题；**运行中的计时器主体绝不能放进打卡卡片内**（会随卡片被平移动画拖着漂）——这也是主形态选顶栏胶囊的又一个理由。

### 8.5 快捷键

**`P` = 开始 / 暂停**（唯一新增全局键）。已核实空闲：`ShortcutHelp` 已占 `T/+−/←→/B/N/M/D/Del/Esc//`/`Ctrl+K/?/Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y`；`GanttView.tsx:457-525` 的 switch 另占 `=`；空格被 `useSpacePan` 占。

- **不抢空格**（=甘特抓手平移）、**不用 `Esc`**（全仓 9 个消费者互相竞争 capture 顺序：CheckinPopover/ContextMenu/TaskDrawer/FilterMenu/GoalIconPicker/dragCore/InlineInput/CommandPalette/BackfillDialog）。面板关闭用点外部或再点胶囊。
- **`Shift+P` = 停止**（S2 评审新增）：到点自动结算是主路径，但「开错任务想丢弃」不该逼用户开面板点两次。
- 实现必须复刻 `App.tsx:129,135` 的 typing 守卫（`INPUT`/`TEXTAREA`/`isContentEditable`，且 `ctrl/meta/alt` 时早退），**并把 `SELECT` 补进去**：现有守卫不挡 `<select>`，用户在设置页的主题/每周从下拉里按 `P` 做 type-ahead 就会顺手起一个番茄。改成 `['INPUT','TEXTAREA','SELECT'].includes(t.tagName)`，顺手也修好既有的 `D` / `/` / `?`（这三个键今天就有同样的问题）。
- **必须同时补进 `src/components/ShortcutHelp.tsx:2-36` 的 GROUPS「其他」组**（既有约定：速查表是快捷键的唯一文档）。

### 8.6 甘特图与复盘（S5）

- **甘特点阵中间态**：`CheckinDots.tsx:49-97`。语义：该日有专注、无打卡。数据来自 §七 的 `focusIndexForGantt`。
  **改用点自身的描边，不用「点内小竖线」**（S2 评审推翻初稿）：该中间态只可能落在两种底态上——`missedSet` 分支（`:70`，纯 `fill="var(--missed-dot)"`）与占位点分支（`:74`，纯 `fill` 8% alpha）——**两者都没有 stroke**，描边是空闲维度；今日环（`:77-81`）半径 `ringR=4.5` 而点半径 `r=3.5`，两者本就分离、可以共存。而 7px 直径里的 1px 竖线，配上浮点 `cx`（`:52`）必然落半像素抗锯齿，会糊成两列灰。⇒ **底态无 stroke 的两种点加一圈 `--warning` 描边**。
  ⚠️ **必须承认：这个标记在 year / quarter 两档看不见**。`constants.ts:37-38` `HEAT_MODE_THRESHOLD = 10`，日宽低于 10px 时点阵**整体退化为热度条**，而 `ZOOM_DAY_WIDTH` 的 `year: 2.5` / `quarter: 8` 都在阈值之下（`constants.ts:12-17`）。⇒ §6.3「割裂感用可见性解决」只覆盖 month/week 两档，其余靠**打卡页补卡建议**与 **bar tooltip** 兜底。别让 §6.3 的论证依赖一个在默认视图里不存在的标记。
- **bar tooltip 加一行**：`BarTooltip.tsx:38-43` 的 `rows` 数组追加「专注 1 小时 25 分」。
  ⚠️ 初稿说这是「最便宜的纯 additive 改动」，不成立：`BarTooltip` 的 props 只有 `{anchor, task, tg, streak}`（`:32`），要塞进去只有两条路——扩 `TaskGantt`（产自 `useGanttDerive`，等于把 `focusSessions` 塞进那个 hook 的输入，**正是 §七『性能约定』明令禁止的**），或加新 prop（要改 `GanttView.tsx:762-764` 的传参与 memo 依赖链）。**取后者**，数据取自 §七 `focusIndexForGantt` 的 `msByTask`，与点阵中间态**共用同一次 `useMemo`**。
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
- 数字 input 的 `onBlur` 必须 **clamp 到 §三 的取值范围**后写回并回显，不是「非法就不写」。
- 区块底部一行灰字诚实说明：**「番茄钟仅在电脑端可用。切到后台或最小化时，到点提醒可能延迟；计时依赖页面存活，合盖休眠或关闭标签页后重新打开时会让你确认这段时间是否计入。」**（初稿漏了「提醒可能延迟」——`frozen` 态下所有 timer 都不跑，见 §5.3）
- 「数据」区各表计数（`:135-145`）会自动多出「专注会话 N」（第 18 项 `TABLE_LABEL`），这同时是 §十容量红线的可见性来源。

---

## 九、边界与故障处理表

| 场景 | 处理 | 依据 |
|---|---|---|
| 后台标签页倒计时变慢 | 剩余时间由 `Date.now()` 反算；闹钟走单根长 timeout（链长 1，免疫 intensive 档）；`visibilitychange → visible` 立即重算并补结算 | §5.1/5.3 |
| 合盖休眠 3 小时 | `focusMs` clamp 到 `plannedMs` ⇒ 结构上不可能记出 3 小时；`gap > 90s` 走结算对话；跳变探测置 `needsReview` | §5.5 |
| 系统时钟被 NTP 校正 / 改时区 | clamp `0 ≤ focusMs ≤ plannedMs`，越界置 `needsReview`；`date` 从 `startAt` 派生一次后**冻结**，历史不随时区漂移 | §三、§5.5 |
| 刷新 / 关标签 / 崩溃 / 杀进程 | 心跳 5s + `hidden`/`pagehide` 强制写；重开按 §5.5 判定。最多丢 5 秒 | §5.4 |
| 多标签同时开着 | 显示天然一致；副作用由 Web Locks leader 独占；结算用预生成 id 幂等兜底 + 模块级 `settledIds` 防重复入 undo 栈 | §5.6 / §5.3b |
| 暂停中关页面，很久之后重开 | 恢复判定里**暂停优先于到点**（§5.5 第 2 行），原样恢复到暂停态，绝不自动结算 | §5.5 |
| 休息中关页面再重开 | 休息总闸：静默回 `idle`，不落库、不弹对话、不动节律 | §5.5 第 0 行 |
| 到点 timeout 与用户点「停止」同时发生 | §5.3b 终止序列：先 `clearTimeout` + `settledIds` 早退 ⇒ 一次会话恒定**一格** undo | §5.3b |
| 窗口被拖窄到 `<768px` | 计时照常跑（内核是模块单例），只是入口不渲染；拉宽回来无缝接上 | §5.1.5 |
| 用户忘了在 Supabase 执行 0002 | fail-fast：整轮同步失败并在顶栏与设置页显示「拉取 focus_sessions 失败」，下一轮自动重试；游标不动故无丢数。**不做单表隔离**（推送游标是全局单值，吞掉异常反而会让该表永久漏推），裁决与证据见 §4.2 | §4.2 |
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
| 运行中 React 重渲次数 | **每秒 0 次，含面板打开态**（胶囊 + hero 数字 + 进度环全部 ref 直写，共用一个 1s 单例 ticker）。整场番茄只在状态迁移时重渲 |
| 甘特页开着番茄钟 | 拖拽仍全程 60fps、缩放切换仍 < 150ms |
| 首屏 | 仍 < 1s（含 `focusSessions` 全量 hydrate，见 10.2） |
| 新增 npm 依赖 | **0 个**（Web Locks / AudioContext / Notification 全是平台 API） |
| 主包体积增量 | **门槛 ≤ 15KB gzip + 明确的测量与退路**（不是愿望）：S4 收尾跑一次 `vite build`，对照 PROGRESS 记录的既有主包 532KB。超了就把**面板**拆成 `lazy()`——胶囊常驻、面板点开时才拉，这不影响任何计时正确性（内核在模块里，不在面板里）。任何 recharts 图表只许进 review 分包 |

### 10.2 容量红线（本次设计必须显式承认的取舍）

现网基数：全库约 340 行 / 110KB JSON（约 7 个月使用量），`checkIns` 年增约 500 行。
番茄会话：8~16 段/天 ⇒ **2900~5800 行/年**，5 年累计 1.5~3 万行 / 3.6~10MB JSON。这是当前全库行数的 **8~17 倍/年**。

现有架构**没有任何分片机制**：`hydrate` 是全表进内存、`exportBundle` 是内存全量出 JSON、同步是全表按 `updatedAt` 增量。

**v1 决策：全量 hydrate，与既有 7 张表一致，零特例。**
依据：1~2 年内是 3000~6000 行，与现有 `checkIns` 同阶；既有实测基线是「2070 实体写入+派生+渲染 114ms」。为一个还没发生的问题引入特例，代价大于收益。

**红线与触发条件（写死在这里，S5 要在设置页让它可见）**：
> 当**专注会话行数 > 8000**（8~16 段/天 ⇒ 500~1000 天 ⇒ **约 1.4~2.7 年**）时，启用窗口化载入：
> 1. `hydrate` 该表只载入 `date >= 今天-400天`（走 §4.1 已建好的 `date` 索引，无需再升 Dexie 版本）；
> 2. `exportBundle` 对该表改为**读 Dexie 全量**（否则备份会静默丢掉窗口外的历史，这是最危险的连带后果，必须同批改）。⚠️ 它会因此变 async，两个调用点 `SettingsPage.tsx:72` 与 `lib/download.ts:17` 都是同步调用，签名变更会波及；
> 3. **`replaceAllData` 的墓碑差集必须改为读 Dexie**（`useStore.ts:162` 用 `Object.values(state[t])` 造墓碑）。窗口化后内存只有 400 天内的行 ⇒「清空全部数据 / 导入备份」时**窗口外的历史会话不会被墓碑化**，Dexie 里仍存活，下次冷启动或复盘补载往年就会重新冒出来，还会经同步推回云端——比备份丢数更隐蔽的一类复活；
> 4. 复盘切到往年时按需 async 补载该年区间。
>
> ⚠️ **设置页的会话计数必须改成直接 `db.focusSessions.count()`**：现在是 `Object.keys(store[t]).length`（读内存，`SettingsPage.tsx:53`），窗口化一启用就被 400 天窗口封顶在 ~6400，**永远到不了 8000** —— 触发条件的观测手段会被窗口化本身砍掉。这条要在 S3 就顺手做掉，别等到触发红线时才发现看不见。
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
- [ ] `planRecovery`：`gap > 90s` 且未到点 → `ask`，`focusMs = netFocusMs(startAt, lastHeartbeatAt, pauses)`（**不是裸截断**，暂停不得被重复扣）
- [ ] `planRecovery`：`now - startAt > 4h` → `hardCut`，`focusMs = min(净时长, plannedMs)`，`needsReview`
- [ ] **`planRecovery` 优先级**：`>4h` 与 `now ≥ plannedEnd` 同时成立 → `hardCut` 胜出
- [ ] **`planRecovery` 暂停优先**：末条 `pauses.until` 缺省 + `now` 远超 `startAt + plannedMs` → **`resume`，绝不结算**
- [ ] **`planRecovery` 休息总闸**：`phase = 'shortBreak' | 'longBreak'` 的任意 gap / 任意时刻 → **不产生 `FocusSession`**（`dropSilently` 或 `resume`）
- [ ] 跨文档跳变探测：`now < lastHeartbeatAt`（时钟回拨）或 `now - startAt < 净时长` → `needsReview`；**刷新页面本身绝不产生 `needsReview`**（回归初稿 `clockAnchor.mono` 跨文档失效那个坑）
- [ ] `focusMsByTaskDate`：排除 `discarded` 与软删
- [ ] `effectiveMsByGoalDate`：仅手填 / 仅自动 / 两者取 max
- [ ] `effectiveMsByGoalDate`：多任务分桶后求和（A 手填 60 + B 自动 25 = 85，而非 60）
- [ ] `effectiveMsByGoalDate`：`taskId` 缺省的记录归入 `''` 桶且不与具体任务串味
- [ ] **ms 精度**：4 段各 `25分29秒` → 结果按 ms 求和后再取整（102 分），**不是逐段 round 相加**（100 分）
- [ ] 节律：`completed > 0 && completed % longBreakEvery === 0` 才进长休息；**`completed === 0` 是负例**；`stopped`/`discarded` 不递增；跨自然日 / `now - lastAt > 2h` 自动清零
- [ ] **回归护栏**：`monthlyGoalStats` / `minutesByGoalByMonth` 传空 `sessions` 时结果与改造前完全一致（`review.test.ts` 既有 5 条一行不改仍全绿）
- [ ] `backup.ts` 往返：新表数据导出再导入无损；**老备份（无 `focusSessions` 键）导入成功**；`settings.pomodoro` 往返不丢

### 11.2 Playwright（`scripts/capture-pomodoro.mjs`，真实 Chrome）

用 `chromium.launch({ channel: 'chrome' })`（系统 Chrome，不下载 playwright 浏览器）；`page.on('dialog', d => d.accept())`；`page.on('pageerror')` 直接 throw。⚠️ 写 store/settings 后须 `waitForTimeout(700~800)` 再跳转（500ms 落库防抖）。

- [ ] 视觉门槛：胶囊（空闲/专注中/暂停中）× 面板（含任务选择器展开、结果卡）× **深浅两主题**
- [ ] 挂钟对照：启动 → `waitForTimeout(65_000)` → 读 `window.__pomodoro` 剩余时间，与真实经过时间误差 < 2s
- [ ] 结算落库：`window.__pomodoro.start({ plannedMs: 62_000 })` 跑完 → 读 IndexedDB 确认一条 `focusSessions` 行，字段与口径正确。
      ⚠️ **`plannedMs` 必须 > 60 秒**：初稿写的 3000ms 结构上永远落不了库（净时长 < 1 分钟 ⇒ `settleSession` 返回 `null`）。
      要跑短用例请改用「注入一个 `startAt` 在数分钟前的运行态 + `forceSettle()`」（S3 已用该手法验过整条落库/undo 链路）
- [ ] undo：结算后 `Ctrl+Z` 完整移除该行；栈只吃掉**一格**（对照 `window.__store.getState().undoStack.length`）
- [ ] **终止竞态**：`start({plannedMs: 1500})` 后立刻点「停止」→ 只落一行、undo 栈只 +1、`outcome = 'stopped'`（不被随后的 timeout 覆盖成 `completed`）
- [ ] **双标签只写一条**：开两个标签跑同一段 → 落库恰好一行、undo 栈只 +1（这条从人工清单提到自动化）
- [ ] **远端表缺失时报错清楚**：stub 掉 `focus_sessions` 的远端响应为错误 → `status = 'error'` 且 `error` 文案指名该表（S3 裁决为 fail-fast，不做单表隔离，见 §4.2）
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

- [ ] §四 全部 **21** 项逐项打勾，**特别核对 ⚠️ 四处无编译护栏的**（`TABLE_NAMES` / `hydrate` 的 `set()` / `TABLE_LABEL` / **`replaceAllData` 的 `set()`**）
- [x] ~~同步引擎：单表失败不中断整轮~~ → **裁决为不改**（§4.2）：推送游标是全局单值，吞掉单表异常会让该表永久漏推，比原问题更严重；0002 已执行 ⇒ 永久性失败条件消失。`engine.ts` 只加 `REMOTE_TABLE` 一个键
- [ ] **部署顺序约定**：新增表时先在 Supabase 执行 migration，再部署前端（否则整轮同步 fail-fast 报错直到执行）
- [ ] `0002_focus_sessions.sql` 落地 + `0001_init.sql` 头部加「不得单独重跑」注释；提醒用户在 SQL Editor 执行一次
- [ ] `src/lib/derive/focus.ts` + `focus.test.ts`（§11.1 用例）
- [ ] `src/pomodoro/`：`constants.ts`、运行状态 store（瞬态 zustand + localStorage 读写）、节律计数独立 key（§5.2b）、`settleSession`/`planRecovery` 接线、单根 timeout 闹钟（回调里跳宏任务再下单）、Web Locks 选主（**模块顶层，非 effect**）、心跳（暂停期间照写）、`settledIds` 终止序列（§5.3b）、DEV 测试面（§5.8）
  **全部是模块单例，且恢复结算挂在 `hydrated === true` 之后**（§5.1.5/5.1.6）
- [ ] `store/actions.ts` 五个 action + 级联软删**三个入口**（`deleteTask` / `deleteTasks` / `deleteGoal`）
- [ ] `review.ts` 两处 + `AnnualOverview.tsx` 一处 + **`ReviewPage.tsx` 四处传参**收口到 `effectiveMs`（新增参数缺省 ⇒ 既有测试不改；但不传就等于功能没做）
- [ ] `SettingsPage.tsx:53` 的表计数改为直接 `db.*.count()`（§10.2 红线可见性）
- [ ] `docs/SPEC.md` §三/§十 补第 7 张表；`docs/PROGRESS.md` 记录
- [ ] 验证：`tsc -b` + oxlint + vitest 全绿 → commit

### S4 — 桌面 UI 完全体 【已完成 2026-08-13】

- [x] `--font-32` 令牌；顶栏胶囊（**空元素 + ref 直写**，只显示时间）；320px 面板（hero 倒计时 + 进度环，**两者同走那一个单例 ticker**，`ticker.ts`）+ 任务选择器 + 操作 + 今日已专注 + 未归类入口
- [x] 结果卡（含 `[✓ 记为完成]` 独立命令、「计入 X 月 X 日」+ 改归相邻日、`needsReview` 徽标 + **`[知道了]` 清除路径**、`< 60s` 丢弃 toast）
- [x] 声音（OscillatorNode 合成，**播放前查 `ctx.state`**）、通知（`new Notification` + `tag`，开关时才请求权限）、`document.title`（仅隐藏时 1/s，`restoreTitle()` 五处调用）
- [x] `P` / `Shift+P` 快捷键（typing 守卫补 `SELECT`，顺手修好既有的 `D` / `/` / `?` 与甘特 `t/b/n/m`）+ 补 `ShortcutHelp` GROUPS
- [x] 设置页「番茄钟」区 6 项（onBlur clamp 并回显）+ 诚实说明文案
- [x] 打卡页 ▶ 入口（`TaskRow` / 单任务卡头 / 随缘区三处）+ 分钟框自动值 placeholder + 自动值与手填值并列展示（**两处展示位都改了**）
- [x] 移动端隐藏全部入口（`useIsMobile` 卸载 + `max-md:hidden` 双保险；计时照常跑）
- [x] 失联结算对话（§5.5 第 4 行）落地为唯一会打扰用户的模态
- [x] **§5.6 第 3 条实现约束**（S4 实测发现的 leader 门禁缺陷，见该节）
- [x] 验证：`tsc -b` + oxlint + vitest 178 全绿；§11.2 主要项实测（见 PROGRESS）；主包增量 **+8.9KB gzip**（178.81 → 187.75，门槛 ≤15KB，无需把面板拆 `lazy()`）；`scripts/capture-pomodoro.mjs` 14 张截图（胶囊三态 × 面板/选择器/结果卡 × 深浅）

### S5 — 统计可视化 + 打磨验收 【已完成 2026-08-13】

- [x] 甘特点阵「有专注·未打卡」中间态（**点描边**，month/week 两档可见）+ bar tooltip 加行（走 `focusIndexForGantt` 的新 prop，**不进 `useGanttDerive`**，`range = 全年`）
- [x] 复盘页「另有 N 段未归类（M 分）未计入」灰字（顺带把「归档目标的会话同样不计入」也说出来）
- [x] 打卡页「这天你专注了 N 分钟 → 一键补卡」建议（页头一行汇总 + 行内「补卡」按钮，三处展示位共用 `FocusAutoBadge`）
- [x] 打卡 popover 显示当日该任务专注时长（并给一键补卡——中间态的点正是从这里点开的）
- [x] 会话历史 / 编辑 / 手动补录界面（`SessionHistory.tsx`，从面板「专注记录」进）
- [x] 复盘页专注指标（专注段数 / 平均段长 / 被打断率 / 专注总时长，纯文本卡，不引 recharts）
- [x] 性能实测（§10.1 全部指标，含「清空会话」对照组）+ `scripts/capture-pomodoro.mjs` 扩到 28 张
- [x] §11.2 相关项自动化实测；**§11.3 六条人工清单仍需用户本人过**（响铃音色 / 系统通知 / 后台准点 / 合盖 30 分 / 双标签 / 连续 4 段长休息——都要真实硬件与真实等待，无自动路径）
- [x] `docs/PROGRESS.md` 定稿 → commit

---

## 十三、已知局限与升级路径

**局限（都是本次取舍的直接后果，不是缺陷）**

1. **不承诺后台准点**：页面被浏览器冻结（Chrome 隐藏 10 秒后即可能进 intensive 档、更极端会 frozen/discarded）时，闹钟会迟到；靠回前台补算保证**时长正确**，但**提醒可能晚到**。真正的后台准点需要服务端 + Web Push。
2. **无移动端**：v1 明确不做（§一）。
3. **番茄设置不跨设备**：存 `AppSettings`，而 settings 不同步（换设备需重新配一次 6 项）。代价换来的是零 SQL、零同步改动。
4. **手填与自动仍是两个数**：`effectiveMinutes` 取 max 是「不重复计且不丢失」的稳妥近似，不是精确合并。极端情况（用户手填 30、实际专注 100 分但只跑了番茄 25）会低估。
5. **一个会话只能归一个任务**：进行中切任务 = 切分成两条。
6. **`discarded` 会话仍占行**：不计统计但占存储与同步流量。
7. **容量红线在 8000 行**（约 1.4~2.7 年）：越过后必须做窗口化改造（§10.2 四步 + 计数改读 Dexie），这是已知的未来工作，不是可以无限拖延的。
8. **目标级手填 + 任务级番茄会相加**：`effectiveMs` 按 `(goal, task, date)` 分桶，`taskId` 缺省的打卡落在独立的 `''` 桶里 ⇒ 若同一天既有目标级手填 60 分、又有任务级番茄 50 分，得到 110。**只影响历史遗留数据**——现行 UI 的全部写入路径都带具体 `taskId`（裁决与证据见 §6.4）。
9. **多标签下的通知条件不精确**：leader 只看自己的 `document.hidden`，「另一个 YearFlow 标签正在前台」时仍会弹系统通知（§5.7）。
10. **点阵中间态只在 month / week 两档可见**：year/quarter 日宽低于 `HEAT_MODE_THRESHOLD`，点阵整体退化为热度条（§8.6）。

**升级路径（都不需要推翻本设计）**

- **全屏专注模式**：新增一个 `/focus` 路由或全屏 overlay，复用同一个运行状态 store，零数据层改动。
- **会话列表页**：按日分组 + 编辑 + 手动徽标，纯 UI，`focusRepo` 已具备按 `date` 范围查的索引。
- **自动开始休息 / 下一段**：两个布尔配置项，状态机已有 `shortBreak/longBreak` 阶段。**`自动开始下一段` 必须默认关**（自动续开 × 忘记停 = 整夜假记录），且续开段同样受 4h 硬截断与结算对话约束。**前置条件**：闹钟必须已按 §5.3 的约束「回调里跳一个宏任务再下 timeout」实现，否则连续续段会把 timer nesting level 推过 5，此后每根闹钟掉进 1/min 档——本设计的核心论证会被这个升级静默毁掉。
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
| 改 Service Worker 发通知 | v1 纯桌面用不上；`generateSW` 下改 SW 会引入懒加载 chunk 部署后 404 的风险（P1 的悬浮小窗从另一条路解决了「看不到提醒」，见 §十六） |
| 番茄个数进复盘统计 | 权威口径只能有一个（专注分钟）。两套「投入」数字是可信度杀手 |

---

## 十五、S2 对抗评审留档（2026-08-13，规格已据此定稿）

两名评审员各自独立证伪：**A = 数据正确性视角**（改动清单 / SQL / 同步 / undo / 统计口径），**B = 手感·性能·平台视角**（状态机 / 平台 API / UI 接入 / 性能）。全部结论已回填进上面各章，本节只留「结果与不再重复论证的事项」。

### 已修正的致命问题（9 条）

| # | 问题 | 落点 |
|---|---|---|
| 1 | 不执行 0002 会让**六张老表也停止同步**（`pullAll` 先于 `pushAll` 且抛错中断整轮），初稿说的「只是该表不同步」错误 | §4.2（诊断成立；处方在 S3 复核后改为「保持 fail-fast」，理由见该节） |
| 2 | 漏了第 4 处无编译护栏的改动点 `replaceAllData` 的 `set()`，后果含**已软删数据复活并推上云** | §四 第 21 项 |
| 3 | `deleteTasks`（多选删除）是独立批量路径，级联漏改会留孤儿会话 | §四 第 19 项 |
| 4 | `clockAnchor` 持久化后 `performance.now()` 跨文档归零 ⇒ **刷新一次就 `needsReview`**，徽标沦为噪音 | §5.2 |
| 5 | `cycleIndex` 存在 `RunningState` 里 ⇒ v1 结构上恒为 0，长休息永不触发 | §5.2b 独立 key |
| 6 | 恢复判定的「暂停总时长」未定义 ⇒ 可能把**暂停中的会话按 completed 全额结算** | §5.5 第 2 行 + 公式 |
| 7 | 恢复判定表完全没覆盖休息阶段 ⇒ 会**把休息写成一条专注会话** | §5.5 第 0 行总闸 |
| 8 | 到点 timeout 与「停止」竞态 ⇒ 一次会话**两格 undo** 且 outcome 被覆盖 | §5.3b 终止序列 |
| 9 | 「`ReviewPage` 自动生效、零改动」错误 ⇒ 不改就是番茄数据永不进复盘，且全绿 | §6.5 第 4 行 |

其余修正（口径 ms 化、`planRecovery` 有序化、心跳覆盖暂停、Web Locks 模块单例、AudioContext 播放前查 state、胶囊/面板 ref 直写、点阵改描边、`focusIndexForGantt` 的 range=全年、设置项取值范围、`pauses` 上限、窗口化的三处连带、DEV 测试面形状、`SELECT` 守卫、`Shift+P`、`[知道了]`…）已分散落在对应章节，均标注了「S2 评审」。

### 评审提出但**裁决为不改**的（S3 不要重新论证）

1. **`taskId` 缺省桶与任务级桶相加**（A-F4）：改公式会毁掉「空 sessions 与改造前完全一致」这条回归护栏，而复核确认现行 UI 无任何路径写出目标级打卡 ⇒ 只影响历史数据。记入 §十三 局限 8。证据见 §6.4。
2. **推送游标全局单值的「静默漏推」**（初稿列为风险）：`BaseRepo` 无条件重盖 `updatedAt`、`persist.ts` 是唯一应用层通道 ⇒ 结构上不可能漏推。降级为文档性约定，§4.4。
3. **多标签通知条件不精确**：修它要引入跨标签可见性汇总，单人单窗口是常态 ⇒ v1 接受，记入 §十三 局限 9。
4. **「单表失败不中断整轮」**（A-F1 的处方，S3 落地前复核后否决）：`pushAll` 的推送游标是全局单值且在表循环之后才推进，吞掉单表异常会让该表脏行永久低于游标、再也不被推送 —— 比「整轮 fail-fast + 下轮重试」严重得多。真正的隔离要把游标改成 per-table 并迁移老游标（动 7 张表共用结构），风险与收益不成比例。0002 已执行 ⇒ 永久性失败条件消失，剩下的瞬时失败每轮自愈。详见 §4.2。

### 复核确认「初稿是对的」，不必再纠结的点

- Dexie `version(2)` 只声明新表即可（`stores` 对 `_versions` 累积），既有 7 张表与数据不丢；索引串正确。
- `0002` 的 SQL 与 `0001` 逐项对齐（`upsert_rows` 签名可 `create or replace` 覆盖、`touch_server_updated_at` 存在、`$sql$` 嵌 `$$` 合法、RLS/索引/触发器命名规则一致、无需补 grant）；**0001 里有而 0002 没有的东西：没有**。唯一新增的是「0001 不得再单独重跑」的告警。
- `streak.ts` / `heat.ts` / `scheduled.ts` / `dayPanel.ts` / `derive/gantt.ts` / `tracks.ts` 对 `minutes` **零命中** ⇒ 三条禁令的事实依据成立，131 个既有测试零风险。
- `Change` / `invertChange` 零改动；级联软删与会话进同一个 `Change[]` ⇒ 一格 undo。
- 墓碑清理不误删历史会话；`repoByTable` / `REMOTE_TABLE` / `EntityMaps` / `emptyMaps` / `DataBundle` 全是强护栏。
- Web Locks「永不 resolve 的排队请求」正是标准选主模式，崩溃安全，优于 `ifAvailable`（后者在锁被占时立即返回 `null` 且此后无任何通知）。
- `storage` 事件只在**其它**同源文档触发，§5.6「follower 写、leader 收」方向正确。
- 面板用 `relative` 父 + `absolute z-50` 子不会被裁剪（header 无 `overflow`/transform，`SyncIndicator` 是现网同款写法）。
- **`P` 键全仓无占用**（11 个 keydown 处理器逐个核过）。
- `useGanttDerive:60-69` 的 6 输入引用全等短路属实；给 `useStore` 加一张表不会让 `GanttView` 多渲（细粒度 selector）。
- `window.__ganttDeriveComputes` 存在，性能用例可执行；截图脚本模式与 `capture-tracks.mjs` 一致。
- §10.2 的量级算术无误（只有「8000 行 ≈ 1.5~2 年」改为 1.4~2.7 年）。



---

## 十六、P1 增补（2026-08-14）：自动休息 · 悬浮小窗 · 提醒可靠化 · 选择器收窄

> 本节是 v1 之后的第一次增补。与前十五节冲突时，**在本节列出的四块范围内以本节为准**。
> 实施记录与实测数据在 `docs/PROGRESS.md`「番茄钟 P1」。

### 16.1 自动开始休息（`autoBreak`，默认开）

口径：`专注到点 → 结算落库 → 响铃/通知 → 自动进入短/长休息倒计时 → 休息到点 → 响铃/通知 → 回 idle`。
**仍不做「自动开始下一段专注」**（§十三 的警告成立：自动续开 × 忘记停 = 整夜假记录）。

`kernel.startBreak(kind, owner)` 与 `startFocus` 同构；休息仍**永不落库**、不进 undo、不动统计。
接线点唯一：`terminate()` 的**末尾**（落库 → 响铃 → 才起休息，顺序不可调换）。三道闸：

| 闸 | 条件 | 漏掉的后果 |
|---|---|---|
| 结局 | `outcome === 'completed'` | `stopped`/`discarded` 是用户主动中断，此时弹一段休息是骚扰 |
| 新鲜度 | `Date.now() - endAt < AUTO_BREAK_FRESH_MS`（60s） | 合盖两小时后回来补算的那段，休息早就过完了，再弹一段休息倒计时是纯噪音 |
| leader | `isLeader \|\| !leaderKnown \|\| forced` | 每个标签各起一段休息 |

两条实现约束：
- **长休息判定必须在 `bumpCycleCompleted()` 之后**（`nextBreakIsLong()` 读的是刚更新的 `cycleCompleted`），顺序反了会永远晚一段。
- **`startBreak` 不清 `lastResult`**（`startFocus` 会清，别照抄）：刚结算的结果卡要继续留在面板上。

§5.5 的恢复判定**一行未改** —— 休息总闸（第 0 行）本来就为这一天准备好了。

### 16.2 悬浮小窗（Document Picture-in-Picture）

`documentPictureInPicture.requestWindow()`，Chrome/Edge 116+ 桌面。**这是「看不到到点提醒」的正解**：真正的系统级窗口，浮在所有窗口之上、最小化浏览器后依然可见；小窗与主页面同一个 JS realm ⇒ kernel/ticker/store 直接可用，零跨窗通信。

- `src/pomodoro/pip.ts`：窗口生命周期 + **样式表整份搬运**（小窗不继承样式，否则是个无样式白窗）+ 主题 `MutationObserver` 跟随 `<html data-theme>` + opener `pagehide` 时关掉小窗（别留孤儿窗）。
- `src/pomodoro/PipView.tsx`：`createPortal` 进小窗 body。三形态：空闲（`25:00 · 待开始 · [开始]`）／运行中（倒计时 + 阶段 + 任务名 + `[开始][暂停][停止]`+丢弃）／**到点醒目态**（整窗 `--accent`/`--success` 满底 + 一句话 + `[开始休息]`或`[开始下一段专注]` + `[知道了]`，30 秒自动消退）。
- 倒计时仍走那一个 1s 单例 ticker + ref 直写；`usePomodoroStore` 新增的 `alert` / `pipHost` **都只在状态迁移时变**，不违反 store 铁律。
- ⚠️ `requestWindow` 要 transient user activation ⇒ **只有手势路径能自动开窗**（`pipAuto` 挂在「开始专注」上）；自动进休息、恢复结算不是手势，只更新已开的小窗。
- 不支持时**不渲染入口**（安静降级）。移动端同样不渲染。

**与页面冻结的关系（诚实边界）**：开着小窗时 opener 承载用户可见内容，Chrome 大概率不冻结它 ⇒ 闹钟准点。但**这是行为观察不是规范承诺**；若真被冻结，小窗倒计时会肉眼可见地卡住 —— 那本身就是最好的自检信号。不为此追加任何保活手段（§十四 已否决静音音频等全部脏办法）。

### 16.3 到点提醒可靠化

| 成因 | 修法 |
|---|---|
| **补算路径没有可见出口**（主因）：页面被冻结 ⇒ 闹钟没触发 ⇒ 切回来 `catchUp` 补算时页面已 visible ⇒ `if (!document.hidden) return` 之后什么都不做，只响一声铃 | `alert` 置位**挪到 `document.hidden` 判断之前**，小窗醒目态与结果卡都挂它 |
| **多标签下 leader 被冻结 = 全员静默**：`onAlarm` 的 `!isLeader && leaderKnown` 让 follower 直接 return | follower 等 `ALARM_FALLBACK_MS`(3s) 复查，运行态还在就 `terminate({forced:true})` 自己接手。重复由预生成 id + `settledIds` + `storage` 三重兜住，最坏是响两声而不是丢数据 |
| **权限层不可观测**：Chrome 站点权限 / Windows 通知设置 / 专注助手任一层都能吞掉通知，而设置页只显示开关是「开」 | 设置页显示权限真值 + **「发送测试通知」按钮**（一次点击分离三层）+ 诚实说明补「只在最小化或切到后台时发送」「后台可能延迟」 |

§5.7 的「只在页面隐藏时发系统通知」**不变**（前台弹系统通知仍是最差选择）；变的是前台/补算时**必须有页内出口**。

### 16.4 任务选择器收窄

- `Task.noFocus?: boolean`，**反向存储**（缺省 = 参与）⇒ 老数据零迁移；加字段对 Supabase 透明（`data jsonb`），**零 SQL、零 Dexie 升版**。必须同步补 `backup.ts` 的 `taskSchema`（zod 默认 strip 未声明键）。**只影响选择器的默认可见性，不影响任何统计口径。**
- 三个入口全走 `patchTask`/`patchTasks`（自动进 undo）：任务抽屉、甘特右键菜单（多选整批翻转）、**选择器行内 hover 的 `⊘`**（下拉不关闭 —— 用户此刻在做的是「清理这张列表」）。
- 三段分组：`最近`（localStorage `yearflow:pomodoro:recentTasks`，上限 8 存 5 显，**不受 `noFocus` 与「今日在办」约束**）/ `今日在办`（过滤 `noFocus`）/ `显示全部（另有 N 个已标不计时）` 折叠区。
- **搜索模式不受任何过滤影响** —— 搜得到才叫逃生阀。`dayEntries + adhocEntries` 合并去重的三条铁律（§8.2）一行未动。

### 16.5 §十三 局限清单的变化

- 局限 1（不承诺后台准点）**仍然成立**，但有了新的缓解手段：悬浮小窗（16.2）+ follower 兜底（16.3）。
- 新增局限 11：**悬浮小窗只有 Chrome/Edge 116+ 桌面有**；Firefox/Safari 无此 API，入口不渲染。
- 新增局限 12：**`noFocus` 是任务级标记，不区分设备**（跟着 tasks 同步，这是有意的：「这个任务不需要计时」是任务属性，不是设备偏好）。
