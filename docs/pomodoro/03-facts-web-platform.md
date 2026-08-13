# Web 平台硬约束研究 —— 番茄钟（YearFlow）

> 结论先行（定调，共 6 条）
> 1. **计时唯一真相 = 持久化的 `startedAt` 等墙钟时间戳（epoch ms）**。UI 是 `f(Date.now(), record)` 的纯函数，不存在"计时器状态"。这一条同时解决了节流、刷新、崩溃、多标签、SW 更新五个问题——它们全部退化为"重新渲染"。
> 2. **闹钟（到点提醒）用「一根未链式化的长 `setTimeout`」**，不用 1s 心跳去比较；链长 <5 的定时器不进 Chrome 的 intensive throttling（1/min）。同时在每次 `visibilitychange→visible` / `resume` 里做一次墙钟补算兜底。
> 3. **番茄钟计入时长必须 `min(墙钟差, plannedMs)` 上限截断**；"休眠 3 小时"因此天然不可能记成 3 小时。中断场景再叠一层心跳截断 + 用户确认。
> 4. **运行中的会话是「设备本地」状态（同 `settings`），只有已完成的会话入同步**。不要让心跳走 Dexie 500ms 防抖 + 整行 LWW 同步，会互相打架。
> 5. **iOS 上一切后台能力等于零**：后台即冻结/被杀。iOS 的唯一可靠提醒通道是"已装到主屏 + 通知授权"，且仍然依赖页面被唤醒。iOS 定位为"前台专注 + 恢复时补算"，不承诺后台准点。
> 6. **当前 `registerType:'autoUpdate'` 不会自动 reload 页面**（已核实构建产物），所以 SW 更新目前不会打断计时；但 `sw.js` 顶层 `self.skipWaiting()` + `clientsClaim()` 会让新 SW 立刻接管，旧 lazy chunk（如 `assets/ReviewPage-*.js`）可能 404。别在未来给它加 `registerSW({immediate:true})`。

已核对的本项目事实（不是推测）：

- `D:\Agent\yearflow\vite.config.ts:18` → `registerType: 'autoUpdate'`，`strategies` 默认 `generateSW`
- `D:\Agent\yearflow\src\main.tsx` 与 `index.html` **均未** import `virtual:pwa-register`；`dist\registerSW.js` 全文只有：
  `if('serviceWorker' in navigator) {window.addEventListener('load', () => {navigator.serviceWorker.register('/sw.js', { scope: '/' })})}`
  → 没有 workbox-window，没有自动 reload 逻辑
- `dist\sw.js` 顶层：`self.skipWaiting(), e.clientsClaim(), e.precacheAndRoute([...])`
- `D:\Agent\yearflow\src\db\sync\engine.ts:217` 已有 `document.addEventListener('visibilitychange', ...)`（复用同一套可见性调度，别再各自加监听）
- `D:\Agent\yearflow\src\gantt\lib\tween.ts:51` 是项目里唯一的 `performance.now()`，仅用于动画补间——符合"performance.now 只做动画、不做计时"的分工
- `D:\Agent\yearflow\index.html:5` 已有品牌化 SVG favicon（年度进度环），动态改 favicon 会和它冲突

---

## 1. 后台标签页定时器节流

**结论**

| 档位 | 触发条件（Chrome） | 效果 |
|---|---|---|
| Minimal | 页面可见 / **近期发出过声音** / 被视为活跃 | 基本准时 |
| Throttling（1s） | 隐藏 且（链长 <5 或 隐藏 <5min 或 WebRTC 活跃） | 定时器每秒检查一次、批量执行 |
| **Intensive（1/min）** | 隐藏 >5min **且** 链长 ≥5 **且** 静音 ≥30s **且** WebRTC 未使用（四条同时满足） | 每分钟才唤醒一次 |

- 四个条件是 **AND**，这是本项目最重要的可利用点：**只要闹钟那根 timer 的链长 <5，就永远不会掉到 1/min**（置信度 中高 — 条件来自 Chrome 官方文档，"长 timeout 免疫"是对该规则的直接推论，需实测确认，见验证方法）。
- Chrome 后来把 5 分钟宽限期缩短：**quick intensive throttling**——页面在变为隐藏时已加载完成，则 **10 秒**后就进入 intensive 档（M109 起默认）。所以"5 分钟"不是安全垫，别指望它。（置信度 高）
- Firefox 桌面：隐藏标签 `setTimeout` 最小 **1000ms**；**页面内有活跃 `AudioContext` 时不节流**；另有 budget-based throttling。**Firefox for Android：最小 15 分钟，且可能直接卸载标签页**。（置信度 高，MDN）
- Safari：隐藏标签同样收敛到 ~1s 量级；**iOS Safari 在 App 进入后台或锁屏时直接挂起 JS**，不是"变慢"而是"停"。（置信度：桌面 中；iOS 挂起 高——Apple 开发者论坛多次明确"iOS 上这是故意的"）
- 豁免项：**可听音频** → 回到 minimal 档；**WebRTC**（有 open 的 DataChannel 或 live 的 MediaStreamTrack）→ 免 intensive、但仍受 1s 节流。**Web Lock 豁免节流：未能证实**——Chromium 内部确有 `disable_aggressive_throttling` 之类的调度策略位，但我没找到任何公开文档说"持有 Web Lock 可豁免定时器节流"，w3c/web-locks EXPLAINER 反而是在担心"持锁的后台标签被节流会拖累前台"。（置信度 低 → **不要依赖**）
- 所以直答："隐藏标签里 `setInterval` 到底准不准" = **不准，且不可预测**：最好 1s 一次，最坏 60s 一次，最坏中的最坏（frozen/discarded/iOS 后台）**一次都不执行**。

**证据来源**
- [Heavy throttling of chained JS timers beginning in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)（四条件、1/min、`grace_period_seconds/10` 测试开关）
- [Intent to Ship: Quick intensive timer throttling of loaded background pages](https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE) / [chromestatus 5580139453743104](https://chromestatus.com/feature/5580139453743104)（10s）
- [Background tabs in Chrome 57](https://developer.chrome.com/blog/background_tabs)（budget throttling、音频/WebSocket/WebRTC 豁免、1s 底线仍在）
- [MDN setTimeout — Timeouts in inactive tabs](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)（Firefox 1s / Android 15min / AudioContext 豁免；Chrome 三档表）
- [w3c/web-locks EXPLAINER](https://github.com/w3c/web-locks/blob/main/EXPLAINER.md)（未承诺节流豁免）
- [Apple Developer Forums: Preventing JavaScript from Stopping in Safari When It Goes into the Background](https://developer.apple.com/forums/thread/777860)

**对 YearFlow 的建议做法**
- **两根时钟分工**：
  - UI 时钟：可见时 `requestAnimationFrame`（或 250ms `setInterval`）重算显示；隐藏时**降到 0 根**（隐藏时没人看，别浪费唤醒）。
  - 闹钟：**一根** `setTimeout(fire, endAt - Date.now())`，在启动/继续的**用户手势回调里**创建（链长 0），不做任何 chained 续期。
- 绝不用"节流豁免"当功能基础；把节流当成"提醒可能晚 ≤60s"的既定事实，写进设置项文案（如"后台标签的提醒可能延迟约 1 分钟"）。
- 别为了准时去开 WebRTC 或长播音频（见 §6）。

**降级路径**
1. 长 `setTimeout` 到点 →（若没准时）`visibilitychange→visible` 补算 →（若页面被冻结/杀掉）下次打开时补算。三层都算不上"失败"，因为时长记录本身不依赖 tick。
2. Firefox Android / iOS：直接放弃后台准点，UI 明示"回到本页时结算"。

**验证方法**
- Chrome：`--enable-features=IntensiveWakeUpThrottling:grace_period_seconds/10` 或 `chrome://flags/#quick-intensive-throttling-after-loading`，切走标签 15s 后看 console 时间戳间隔是否变 60s。
- 对照实验：同页面各起 (a) chained 1s interval、(b) 单根 20min 长 timeout，隐藏 20 分钟，看 (b) 的实际触发误差。这一条决定 §1 的核心推论成立与否，**必须在实现前跑一次**。
- Performance 面板录制后台段，看 timer 唤醒对齐情况。

---

## 2. 正确的计时实现

**结论**
- **绝不 tick 累加**（`elapsed += 1000`）：节流会直接把计时器变慢表，1/min 档下 25 分钟能"走"出几分钟。
- 唯一正确模型：**分段墙钟差值求和**。
- `Date.now()`：可被系统改时钟 / NTP 校正跳变（可正可负），但它是"用户体验上的真实时间"，**必须作为时长的权威来源**。
- `performance.now()`：单调，但 **规范要求"系统睡眠期间也要继续走"，而 Chrome / Firefox / Safari 在若干平台上都不合规**——睡眠期间可能暂停（macOS/Linux 行为不同，`CLOCK_MONOTONIC` 是否含睡眠时间因平台而异）。所以 `timeOrigin + performance.now() ≈ Date.now()` 这个假设在休眠后可能差出几小时。（置信度 高）
- 正确取舍：**`Date.now()` 记账，`performance.now()` 只用来"检测 `Date.now()` 是否跳变"和驱动动画**。两者之差就是最好的跳变探测器。
- Web Worker 跑 tick：Worker 里的 timer 传统上不受主线程节流（这也是 `worker-timers` 类库存在的原因），但 (a) 各家浏览器/版本正在收紧，(b) 页面被 freeze/discard 时 worker 一起死，(c) iOS 后台一样挂起。**能到什么程度：最多把"1/min"改善回"~1s"，不能改善"页面被冻结"和"iOS 后台"**。（置信度 中——"worker 不被节流"广泛流传但缺一手官方文档，且规范未保证）
  → 结论：**本项目不需要 Worker**。Worker 唯一能买到的是"隐藏时 UI 数字更平滑"，而隐藏时没人看数字。用 Worker 换来的复杂度（+一个线程、+消息协议、+与 leader election 交叉）不划算。

**证据来源**
- [MDN Performance.now()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now) + [mdn/content#4713 "Chrome, Firefox, and Safari are not spec compliant on certain platforms"](https://github.com/mdn/content/issues/4713)
- [WebKit bug 225610 performance.now() does not tick during system sleep](https://bugs.webkit.org/show_bug.cgi?id=225610)、[Bugzilla 1709767（Linux/macOS 睡眠暂停）](https://bugzilla.mozilla.org/show_bug.cgi?id=1709767)
- [whatwg/html#6759 How should timers account for system sleep/suspend?](https://github.com/whatwg/html/issues/6759)（规范层至今没定论）
- [w3c/hr-time#115](https://github.com/w3c/hr-time/issues/115)
- Worker 不受节流的常见说法：[worker-interval](https://github.com/gorkemcnr/worker-interval)、[Overcoming browser throttling of setInterval](https://medium.com/@adithyaviswam/overcoming-browser-throttling-of-setinterval-executions-45387853a826)（社区来源，置信度中）

**对 YearFlow 的建议做法**

领域模型（放 `src/types/domain.ts`，与 SPEC 第三节风格一致）：

```ts
type PomodoroSegment = { startedAt: number; endedAt: number | null } // epoch ms
interface PomodoroSession {
  id: string
  goalId: string; taskId: string | null      // 复用现有 目标+任务 维度
  kind: 'focus' | 'shortBreak' | 'longBreak'
  plannedMs: number
  segments: PomodoroSegment[]                // 暂停/继续 = 关段/开段
  status: 'running' | 'paused' | 'completed' | 'abandoned'
  creditedMs?: number                        // 结算后写入，复盘只读这个
  anomaly?: 'clockJump' | 'longGap' | null
  // 审计/恢复用，不参与展示
  deviceId: string
  createdAt: number; updatedAt: number; deletedAt?: number | null
}
```

派生纯函数放 `src/lib/derive/pomodoro.ts`（配 vitest，和现有 131 个测试同风格）：

```ts
export const rawElapsedMs = (s: PomodoroSession, now: number) =>
  s.segments.reduce((a, g) => a + ((g.endedAt ?? now) - g.startedAt), 0)

// 唯一对外的"这次番茄算多少分钟"
export const creditedMs = (s: PomodoroSession, now: number) =>
  Math.max(0, Math.min(rawElapsedMs(s, now), s.plannedMs))   // ← 上限截断
```

跳变探测（一个小 hook，隐藏时不跑）：

```ts
let anchor = { d: Date.now(), p: performance.now() }
function drift() {                      // >0：Date 比 perf 多走（睡眠或时钟前跳）
  const d = Date.now(), p = performance.now()
  return (d - anchor.d) - (p - anchor.p)
}
// |drift| > 2000ms → 记 anomaly；drift < -2000ms（时钟回拨）→ 必须弹确认，不静默采信
```

- 显示层：`Math.ceil((endAt - Date.now())/1000)` 直接算剩余秒，永不自减。
- 从隐藏恢复：`visibilitychange → visible` 时**只做一次** `reconcile(session, Date.now())` —— 补算 + 判定是否已过 `endAt` + 重建那根长 timeout。挂到 `src/db/sync/engine.ts:217` 同一个 visibility 调度里，避免多处监听。

**降级路径**
- 没有 `performance.now()`（不存在的情况）→ 仅用 `Date.now()`，跳变探测退化为"gap 阈值判定"（§3 已覆盖）。
- 探测到时钟回拨 → 会话标 `anomaly`，按 `lastSeenAt` 截断，并给一次人工确认。

**验证方法**
- 单测：给 `creditedMs` 喂造好的 segments + 各种 `now`（含 3 小时 gap、负 gap），断言恒 ≤ `plannedMs` 且 ≥0。
- 手动：跑 5 分钟番茄，中途把 Windows 系统时间前调 2 小时 / 后调 10 分钟，看是否弹确认而不是静默完成。
- 手动：`powercfg /h off` 后合盖休眠 10 分钟再开，log 里对比 `Date.now` 差与 `performance.now` 差。

---

## 3. 进程/页面中断恢复

**结论**
- 各场景可观测性阶梯（Chrome Page Lifecycle）：`active/passive → hidden → frozen（"JavaScript 定时器和 fetch 回调都不运行"）→ discarded（"任何 JS 都不能运行"）→ terminated`。
- **`hidden` 是最后一个可靠可观测的状态**；`beforeunload`/`unload` "极不可靠，尤其在移动端"，而且带 `unload` 监听会**破坏 bfcache**。→ 所有落盘必须在 `visibilitychange(hidden)` / `pagehide` 完成。
- 崩溃 / 手机杀后台 / discarded：**没有任何回调**。唯一手段是"运行期周期性写心跳，重开时读心跳"。
- 合盖休眠：`Date.now()` 恢复后正确（跳了 3 小时），`performance.now()` 可能没跳 → 这正是 §2 探测器的用途。
- **"休眠 3 小时算不算专注" —— 答案是"结构上不可能记 3 小时"**：`plannedMs` 上限截断（25 分钟番茄最多记 25 分钟）。剩下的问题只是"这 25 分钟算不算"，用 gap + 心跳两层判定。

**证据来源**
- [Page Lifecycle API（Chrome for Developers）](https://developer.chrome.com/blog/page-lifecycle-api)：frozen 时 timer 不跑、discarded 无 JS、`hidden` 是可靠终点、避免 `unload`
- [iOS 主屏 PWA 后台约 5 秒后被冻结、退出后重启即丢状态（firt.dev / Apple 论坛）](https://firt.dev/ios-12.2/)（置信度 中：文章年代较早，iOS 16.4+ 状态保持有改善，但"可能被终止并从 `start_url` 重启"仍成立，需实机复测）

**对 YearFlow 的建议做法**

**心跳（本地、不同步、不进 undo）**：每 **5s**（仅在 `running` 且页面可见时）+ 每次状态迁移 + 每次 `visibilitychange` 立即写 `{ sessionId, lastSeenAt: Date.now() }`。
> 关键：**不要走 `src/store/persist.ts` 的 500ms 防抖，也不要走 `execute()`**。500ms 防抖会让崩溃时丢最后一拍；`execute()` 会把心跳灌进 undo 栈（100 步瞬间被冲掉）。心跳直写 repo（或 `settings` 单行表里的一个字段），绕过 undo。

**重开页面时的 `reconcile` 判定（建议阈值）**

设 `gap = now - lastSeenAt`，`endAt = 当前 running 段起点 + 剩余 plannedMs`：

| 条件 | 判定 | 默认动作 |
|---|---|---|
| `gap ≤ 60s` | 正常节流/切标签 | **静默继续**，无任何提示 |
| `gap ≤ 60s` 且 `now ≥ endAt` | 到点了但提醒没响 | 自动完成，`creditedMs = plannedMs`，页面内补一条"已完成"横幅 |
| `60s < gap ≤ 15min` 且 `now ≥ endAt` | 大概率"专注中但页面被压制" | **自动完成**（`completedAt = endAt`），标 `autoCompleted`，横幅"番茄已于 HH:mm 完成 · 撤销" |
| `gap > 15min` | 几乎一定是休眠 / 杀后台 / 崩溃 | **不自动全额记**：按 `min(lastSeenAt, endAt)` 截断为 `abandoned`（保留 `creditedMs`），横幅"上次番茄在 HH:mm 中断 · 记入 18 分钟 / 全额记入 / 丢弃" |
| `gap > 15min` 且 `lastSeenAt - segStart < 5min` | 刚开始就断 | 直接丢弃（不写 CheckIn 分钟），只留会话痕迹 |

- **最小计入阈值**：`creditedMs < 5min`（或 <60% `plannedMs`）→ 记 `abandoned`，**不参与**打卡 minutes / 复盘投入时长。避免复盘图被无数 30 秒碎片污染。
- **同时只允许一个 running 会话**（每设备）；启动新会话时先 `reconcile` 旧的。
- 所有"是否记入"的最终写入（改 CheckIn 的 minutes）**走 `execute()`**，这样用户能 undo；而番茄会话自身的生命周期变更走直写。这条边界值得在 PROGRESS.md 里写死。

**降级路径**
- 没有 `lastSeenAt`（首版数据 / 心跳丢失）→ 退化为纯 gap 判定：`now ≥ endAt` 且 `now - endAt > 15min` → 一律走"人工确认"分支，不猜。
- 用户拒绝确认（直接关页）→ 保持 `running` 不变，下次再问；但超过 24h 未确认的 `running` 自动降级 `abandoned`，防止永久悬挂。

**验证方法**
- `chrome://discards` 手动 Freeze / Discard 当前标签，再回来看 `reconcile` 分支是否正确。
- DevTools → 三点 → 直接 kill 渲染进程（或任务管理器结束标签进程）模拟崩溃。
- 真机：iPhone 上开始番茄 → 切 App 10 分钟 → 回来；再试杀后台。
- 合盖休眠 3 小时（或改系统时间模拟），断言最终 `creditedMs ≤ plannedMs` 且走了"中断"分支。
- 单测覆盖上表 5 行 + 边界（gap = 60s / 15min 整）。

---

## 4. 多标签页 / 多设备一致性

**结论**
- 因为"剩余时间 = f(持久化记录, Date.now())"，**多标签的显示一致性是免费的**——每个标签各自算，结果必然一致（同一台机器同一个时钟）。需要协调的只有 **副作用**：响铃、弹通知、写完成记录。否则 3 个标签会响 3 声、弹 3 条、写 3 次。
- 协调手段可用性：**Web Locks API 已是各家现代浏览器普遍支持**（`navigator.locks`，Chrome/Edge/Firefox/Safari 均有；secure context）；`BroadcastChannel` 同源跨标签广播，广泛支持；`storage` 事件是最老的兜底（但项目主存储在 IndexedDB，`localStorage` 只用来做信号，不存数据）。
- Web Locks 用作 leader election 的正确姿势：请求一把 **永不释放**的 exclusive 锁（回调里 `await new Promise(() => {})`），拿到锁的标签就是 leader；标签关闭/崩溃 → 锁自动释放 → 下一个标签自动接位。**这是它最大的优点：崩溃安全，不需要心跳超时。**
- 多设备：**运行中的番茄钟不应该跨设备同步**。理由与项目现状直接相关——同步是"整行 LWW（按 `updatedAt`）"，一个每 5 秒变一次的 running 行会 (a) 制造大量同步流量，(b) 两台设备互相 LWW 覆盖，出现"手机把电脑的番茄停了"这种鬼故事，(c) `supabase/migrations/0001_init.sql` 的 `upsert_rows` RPC 有硬编码表名白名单，任何新表都要同步改 SQL + `src/db/sync/engine.ts` 的 `REMOTE_TABLE` 映射，没必要为瞬态状态付这个代价。

**证据来源**
- [MDN Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)（`navigator.locks.request`、回调返回即释放、标签关闭自动释放）
- [w3c/web-locks EXPLAINER](https://github.com/w3c/web-locks/blob/main/EXPLAINER.md)
- 本项目同步语义：`D:\Agent\yearflow\src\db\sync\engine.ts`、`D:\Agent\yearflow\supabase\migrations\0001_init.sql`（整行 LWW + 表名白名单，已在任务背景中确认）

**对 YearFlow 的建议做法**

```ts
// src/pomodoro/leader.ts
let isLeader = false
navigator.locks?.request('yearflow.pomodoro.leader', { mode: 'exclusive' }, async () => {
  isLeader = true
  onBecameLeader()               // 只有 leader 装那根长 timeout、响铃、弹通知、写完成记录
  await new Promise<never>(() => {})   // 永不 resolve：持锁到标签关闭
})
```
- 完成时：leader 写库 + 通过 `BroadcastChannel('yearflow.pomodoro')` 广播 `{type:'completed', id}`，其余标签只刷新 UI（其实它们自己也会算出来，广播只是让刷新即时）。
- follower 标签的按钮（暂停/放弃）不需要转交给 leader：直接写库 + 广播，leader 收到后重建 timeout。写冲突用同一把锁的短期版本包一下即可（`navigator.locks.request('yearflow.pomodoro.write', cb)`）。
- **多设备原则（写进设置页文案）**：番茄钟是"此设备正在专注"，不跨设备接管；**只有已完成/已放弃的会话入云同步**。若同步下来发现两台设备的 focus 会话时间区间重叠 → 复盘页给一条低调提示"检测到重叠的专注记录"，由人决定删哪条，不自动合并。
- 若坚持要跨设备看到"电脑正在专注"，用一张**单向**的 `presence` 表（只由持有会话的设备写、别的设备只读，永不回写），避免 LWW 打架——但建议 v1 不做。

**降级路径**
- 无 `navigator.locks`（老浏览器）→ `BroadcastChannel` + "最小 tabId 当选" + 2s 心跳超时改选；再退一步 → 允许多标签都响，但通知加 `tag: 'yearflow-pomodoro'`（同 tag 会替换而非叠加，天然去重），写库用 `id` upsert 幂等（项目 repo 层已是 upsert 语义）。
- 无 `BroadcastChannel`（几乎不存在）→ `localStorage` 写一个信号 key + `storage` 事件。

**验证方法**
- 开 3 个标签跑同一个番茄：断言只有 1 声提示音、只有 1 条通知、库里只有 1 条 completed。
- 关掉 leader 标签（保留另外两个），断言 3 秒内有新 leader 接位并仍能准点提醒。
- 两台设备各跑一个，同步后断言两条独立记录、无一条被覆盖成 `running`。

---

## 5. 提醒（Notification）

**结论**
- **权限时机**：绝不在页面加载时请求。正确时机 = 用户第一次点"开始专注"且勾了"结束时提醒"，或设置页里显式点"开启提醒"。Chrome 对滥用者有"更安静的权限 UI"惩罚；**iOS 明确要求"必须由直接用户交互触发"**。
- **必须用 `ServiceWorkerRegistration.showNotification()`**，不能用 `new Notification()`：MDN 明确 "This constructor throws a `TypeError` when called in nearly all mobile browsers."（置信度 高）。项目已有 SW，条件满足。
- **iOS 前置条件（硬门槛）**：manifest 的 `display` 为 `standalone`/`fullscreen`（本项目 `vite.config.ts` 已是 `standalone` ✅）+ **必须由用户"添加到主屏幕"** + 请求必须来自用户手势。**Safari 标签页里的 YearFlow 永远拿不到通知权限。**
- **不存在"预约通知"**：Notification Triggers（`showTrigger`/`TimestampTrigger`）从未正式发布，只做过 origin trial。→ **页面/SW 被冻结时无法保证到点弹窗**。想要真正的"后台准点"只有 Web Push（需要服务端 + VAPID + 推送订阅），对单人工具是过度设计（且要新增服务端定时任务）。
- 页面在前台时通知其实是最差的选择（用户就在看着页面）；前台应该用**页面内的完成态**（数字归零 + 一个安静的完成横幅 + 声音），通知留给"页面隐藏/最小化/standalone 在后台"。
- 点击回焦：SW 里 `notificationclick` → `clients.matchAll({type:'window', includeUncontrolled:true})` → 找到同 origin 的 client `client.focus()`，没有则 `clients.openWindow(scope)`。
- **本项目配置影响（重要）**：现在是 `strategies: generateSW`，**生成的 `sw.js` 里没法直接写 `notificationclick`**。两条路：(a) 保守——`VitePWA({ workbox: { importScripts: ['pomodoro-sw.js'] } })`，把 `notificationclick` 放到 `public/pomodoro-sw.js`；(b) 彻底——切 `strategies:'injectManifest'` + `srcDir:'src'` + `filename:'sw.ts'` 自己写 SW。(a) 改动面小、不动现有缓存策略，**推荐 v1 走 (a)**。

**证据来源**
- [MDN Notification() 构造器警告](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification)
- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)："A web app that has been added to the Home Screen can request permission to receive push notifications… as long as that request is in response to direct user interaction"；与 Focus/通知设置集成
- [MoEngage: Safari Web Push for iOS](https://developers.moengage.com/hc/en-us/articles/13906923326100-Safari-Web-Push-for-iOS-and-iPadOS)（未加主屏则不允许请求权限）
- Notification Triggers 未落地：Chrome 平台状态历史（置信度 中高，建议实现前用 `'showTrigger' in Notification.prototype` 现场探测一次）

**对 YearFlow 的建议做法**
- 通知内容遵循"动词开头 + 克制"：标题「番茄已完成」，正文「目标 · 任务名 · 25 分钟」，`tag: 'yearflow-pomodoro'`（多标签去重 + 替换旧的），`silent: false` 桌面、`requireInteraction: true` 仅桌面 Chrome（让它不自动消失，符合"别漏掉"），`icon` 用现成的 `pwa-192.png`。
- 设置页三档：`提醒方式：通知 / 仅页面内 / 关闭`，并显示权限真实状态（`default/granted/denied`）+ 被拒时给"如何在浏览器里恢复"的一句说明，而不是反复弹。
- iOS 上如果 `!window.matchMedia('(display-mode: standalone)').matches` → 通知开关灰掉 + 一句「装到主屏后可开启提醒」。

**降级路径**（按优先级自动挑第一个可用的）
1. SW `showNotification`（权限 granted）
2. 页面内完成横幅 + 声音（页面可见时其实是首选）
3. **`document.title` 闪烁/前缀**（隐藏标签、非 standalone 时最有效，见 §8）
4. favicon 上一个小圆点（可选，见 §8 的坑）
5. 什么都不可用 → 打开页面时的"补算横幅"兜底（§3 已保证不丢时长）

**验证方法**
- 桌面 Chrome：最小化窗口跑 1 分钟番茄，断言弹窗出现、点击后窗口回到前台且路由停在番茄页。
- 权限 denied 情况下断言自动降级到横幅+标题，且不再弹权限请求。
- iPhone：Safari 标签页里断言开关是灰的；添加到主屏后断言能授权并收到通知。
- Android Chrome：断言用的是 SW 路径（把 `new Notification` 路径打个 warn，跑一次确认没进）。

---

## 6. 声音

**结论**
- Chrome autoplay policy：**AudioContext 若在用户手势之前创建，会是 `suspended` 状态**；必须在手势回调里 `ctx.resume()`。已安装的 PWA 会自动获得 autoplay 授权（这对本项目是加分项）。（置信度 高，Chrome 官方）
- **后台标签能播音频**（音频恰恰是节流豁免项），Chrome 桌面上隐藏标签播提示音没问题。**iOS Safari 进后台则整体挂起，播不了。**
- **iOS 静音开关（Ringer）会静音 Web Audio**，但 `<audio>`/`<video>` 媒体元素不受同样限制——社区通行解法是"配合播一个极短的静音 `<audio>` 把音频会话类型顶成媒体播放"。更现代的做法是 **Safari 的 AudioSession API（`navigator.audioSession.type = 'playback'`）**，但目前只有 Safari 实现、规范仍是 Editor's Draft。（置信度 中）
- **"用短音频保活/保准时"不值得**：
  - Chrome 的豁免条件是"近期发出过**可听**声音"；零振幅静音流通常不被判为 audible（也不会点亮标签页扬声器图标）→ **豁免大概率拿不到**（置信度 中，需实测）。
  - 副作用实打实：标签页扬声器图标常亮（用户以为在放东西）、抢占系统媒体会话 / 锁屏媒体控制、蓝牙耳机被占用/切换音频通道、移动端耗电、"安静"气质全毁。
  - 结论：**不做保活音频**。准时性靠 §1 的"单根长 timeout" + §3 的补算，那是零副作用方案。
- 音量与气质：单次提示音应当"像 macOS 系统音，不像微信"。建议 **两声短促柔和的正弦/三角波**（如 880Hz → 1174Hz，各 90ms，指数衰减），峰值 gain **0.12~0.2**，总时长 <400ms。用 `OscillatorNode` 现场合成即可，**不引入音频文件**（省一个网络请求、省 PWA 预缓存体积、天然离线可用、也不用担心 base64 塞进 bundle）。

**证据来源**
- [Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay/)（三种放行条件含"已安装 PWA"；AudioContext 手势前为 suspended，推荐 resume-on-gesture）
- [MDN setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)（Firefox：有活跃 AudioContext 则不节流）
- [Background tabs in Chrome 57](https://developer.chrome.com/blog/background_tabs)（播放可听音频的页面视为用户可见，豁免后台节流）
- iOS 静音开关与解锁：[nattog.dev: Avoiding unmuting iOS devices for the Web Audio API](https://nattog.dev/blog/web-audio-ios-unmute)、[swevans/unmute](https://github.com/swevans/unmute)、[feross/unmute-ios-audio](https://github.com/feross/unmute-ios-audio)（社区方案，置信度中）；AudioSession API 目前仅 Safari 实现（Editor's Draft）

**对 YearFlow 的建议做法**
- 单例 `AudioContext` 懒创建：**只在用户点"开始专注"时创建并 `resume()`**（这个手势天然存在，不需要额外的"点击以启用声音"步骤——这点很关键，能避免一个丑陋的解锁 UI）。
- 每次可见性恢复时若 `ctx.state === 'suspended'`，不要在非手势里硬 `resume()`（会被拒），而是在下一次任意用户交互时顺手 resume。
- 设置项：`提示音：开 / 关` + 音量三档（轻/中/静音），默认"轻"。
- iOS：若检测到 `ctx.state` 正常但用户反馈没声音 → 在设置页给一句「iPhone 侧边静音开关会屏蔽网页提示音」，**不要为此引入静音 `<audio>` 保活 hack**（v1 不做；若日后确有需求，再评估 `navigator.audioSession`，它比 hack 干净）。

**降级路径**
- `AudioContext` 不可用 / 被拒 → 静默失败，靠通知 + 页面内横幅（§5 降级链）。
- iOS 静音开关导致无声 → 通知 + 横幅 + （standalone 下）App 角标 `setAppBadge`（WebKit 明确支持前台/后台改角标）。

**验证方法**
- 隐藏标签 → 断言提示音仍响、且标签页扬声器图标只在响的那 0.4 秒出现。
- 全新无痕窗口打开、直接点"开始"→ 断言首次就有声（验证手势解锁走通）。
- iPhone 开/关静音开关各测一次，记录实际行为（这是本节唯一必须实机确认的点）。
- 断言 bundle 里没有音频资源（`dist/assets` 无 mp3/wav）。

---

## 7. 屏幕常亮（Screen Wake Lock）

**结论**
- `navigator.wakeLock.request('screen')`，**Baseline 2025**（各主流浏览器新版均可用；Safari 自 16.4 起）。需要 secure context + `screen-wake-lock` permissions policy（默认 `self`，同源页面没问题），Chrome 不弹权限框但会在低电量/省电模式下拒绝。
- **文档一旦 hidden，锁自动释放**；必须在 `visibilitychange → visible` 时重新申请。
- 现实限制：它只防"屏幕自动变暗/熄屏"，**不防用户手动锁屏、不防合盖休眠**。手机手动锁屏后 JS 照样挂起。所以它是"体验糖"，不是"计时保障"。

**证据来源**
- [MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)（用法、hidden 自动释放、需在 visible 时重新申请、Baseline 2025、低电量可能拒绝、`release` 事件）

**对 YearFlow 的建议做法**
- 设置项 `专注时保持屏幕常亮`，**默认关**（桌面上常亮反而是负担），在移动端首次开启番茄时给一次性提示"手机当番茄钟？可开启屏幕常亮"。
- 仅在 `status === 'running'` 且开关开时持锁；`paused/completed` 立即 `release()`。
- 用 try/catch 包住，失败**完全静默**（不弹错误 toast，这类失败太常见）；`wakeLock.addEventListener('release', ...)` 里同步 UI 上那个小图标状态。

**降级路径**
- API 不存在 / 被拒 → 不做任何补偿（**不要**用播视频等 hack 保持常亮：耗电、有声音风险、和 §6 的克制原则冲突）。UI 上那个"常亮"图标显示为不可用即可。

**验证方法**
- 桌面 Chrome：`chrome://settings` 里把屏幕保护/系统息屏调到 1 分钟，开常亮跑番茄，断言不息屏；切走标签断言锁被释放、切回断言重新获得。
- 手机：开常亮跑 5 分钟，断言不自动熄屏；手动锁屏再解锁，断言计时数字正确（走的是补算而不是常亮）。
- 低电量模式下断言 request 抛错且 UI 不报错。

---

## 8. document.title / favicon 做倒计时

**结论**
- `document.title` 倒计时在**浏览器标签页**里是性价比最高的环境显示，成本近乎零。
- 坑：
  1. **PWA standalone 下没有标签栏，title 完全不可见**（本项目 manifest 是 `standalone`）→ 对装了 PWA 的用户这套完全失效，必须有别的通道。iOS 主屏 App 同理。
  2. 屏幕阅读器会朗读 title 变化 → 每秒改一次 title 对无障碍是噪音；`prefers-reduced-motion` 管不到这个，需要自己节制（建议只在隐藏时更新，且频率 1/s；可见时不改，因为页面上已经有大字号倒计时）。
  3. 隐藏标签本身被节流 → title 更新频率就是节流频率，"跳秒"是正常现象，别为此加 worker。
  4. 会污染会话恢复/历史记录里的标题；离开番茄页/结束时必须**恢复原 title**（`'YearFlow — 年度计划'`，见 `index.html:8`），并在 `pagehide` 里也恢复一次。
  5. 标题闪烁（交替两个字符串）当"提醒降级"可以，但**必须有明确的停止条件**（用户回到页面 / 30 秒后自动停），否则很烦。
- 动态 favicon（canvas 画进度环 → `link.href = canvas.toDataURL()`）：Chrome/Edge/Firefox 可行；**Safari 对动态 favicon 支持历来不稳定**；且本项目 `index.html:5` 已经是精心做的 SVG 年度进度环图标 + `apple-touch-icon`，每秒替换它会 (a) 破坏品牌一致性，(b) 与 SVG favicon 混用时出现回退/闪烁。（置信度：Safari 不稳 中；品牌冲突 高，看代码即知）

**证据来源**
- 项目代码：`D:\Agent\yearflow\index.html:5`（`<link rel="icon" type="image/svg+xml" href="/favicon.svg">`）、`:8`（原始 title）、`vite.config.ts` manifest `display: 'standalone'`
- [MDN setTimeout — inactive tabs](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)（隐藏标签更新频率受限）
- [Page Lifecycle API](https://developer.chrome.com/blog/page-lifecycle-api)（`pagehide` 作为清理点）

**对 YearFlow 的建议做法**
- 只做 title，形如 `18:42 · 专注 — YearFlow`；**仅在 `document.hidden` 时启用**，变可见立刻恢复原 title（页面内已有大号倒计时，不需要重复）。
- 用 `display-mode` 检测：`window.matchMedia('(display-mode: standalone)').matches` 为 true 时**整个 title 方案不启用**（省掉无用功），改由通知 + 角标承担。
- favicon：**v1 不动**。如果日后确实想要，只做"静态两态"——`favicon.svg` 与 `favicon-running.svg`（同一个进度环 + 一个小圆点），切换而非每秒重绘，规避 Safari 与性能问题。
- 恢复 title 的清理必须挂在：组件卸载、`status` 离开 running、`visibilitychange→visible`、`pagehide` 四处（写成一个 `restoreTitle()` 反复调用幂等）。

**验证方法**
- 切走标签断言 title 每秒变、切回断言立刻恢复；关闭番茄断言 title 恢复。
- 安装 PWA 后断言 title 逻辑没启用（打点或断言 `document.title` 不变）。
- 用 VoiceOver/NVDA 打开，切标签，主观确认朗读噪音可接受。

---

## 9. PWA 差异 + SW 更新会不会打断计时

**结论 A（standalone vs 标签页）**

| 维度 | 浏览器标签页 | Android standalone | iOS 主屏 App |
|---|---|---|---|
| 后台存活 | hidden→节流→可能 frozen/discarded | 类似，但常被系统更快冻结 | **进后台约数秒后冻结；退出即可能被终止并从 `start_url` 重启，运行时状态全丢** |
| 通知 | 桌面可用（需权限）；Android 必须 SW `showNotification` | 可用 | **只有这里可用**（16.4+，且需用户手势授权） |
| 音频 | 后台可播（Chrome 桌面） | 后台受限 | 后台不可播（整体挂起）；前台受静音开关影响 |
| autoplay | 需手势 | **已安装 → 自动获得 autoplay 授权** | 需手势 |
| title/favicon | 可见，有用 | **不可见** | **不可见** |
| 角标 | 无 | `setAppBadge` 可用 | `setAppBadge` 可用（前台与处理 push 时都能改） |

→ 直接推论：**桌面 Chrome 标签页** = 主战场，能力最全（长 timeout 较准、后台能响、title 可用）。**iOS 主屏 PWA** = 只保证"前台准确 + 恢复时正确补算 + 已完成时能弹通知（若页面还活着）"，不承诺后台准点，UI 文案要诚实。

**结论 B（SW 更新与 reload 风险）—— 已在本仓库核实**
- vite-pwa 文档明确："**Automatic reload is not automatic page reload**，你需要在入口 import 虚拟模块并调用 `registerSW({ immediate: true })` 才会自动 reload"。本项目 `src/main.tsx` / `index.html` **没有** import `virtual:pwa-register`，构建出的 `dist/registerSW.js` 只有一行裸 `navigator.serviceWorker.register()`。
  → **当前配置不会自动 reload 页面，正在跑的番茄钟不会被 SW 更新打断。**（置信度 高，读构建产物得出）
- 但 `dist/sw.js` 顶层是 `self.skipWaiting(), clientsClaim()`（`autoUpdate` 会强制把这两个 workbox 选项设为 true）。后果：新 SW **立即**激活并接管已打开的页面。页面本身不 reload，但它持有的是**旧版本**的 chunk URL；`generateSW` 默认会清理过期 precache，**已 code-split 的 `assets/ReviewPage-*.js` 之类懒加载块在部署后可能 404** → 用户正跑着番茄去点"复盘"页，报 dynamic import 失败。
- 反过来的风险也要记住：**如果哪天为了"部署即生效"而加上 `registerSW({immediate:true})`，就会引入 vite-pwa 文档亲口警告的那句** —— "The user can lose data in any browser windows/tabs in which the application is open"。

**证据来源**
- [vite-pwa: Automatic reload](https://vite-pwa-org.netlify.app/guide/auto-update.html)（`clientsClaim`/`skipWaiting` 被设为 true；"will reload any browser windows/tabs … automatically"；数据丢失警告；`prompt` 替代方案）
- 本仓库产物：`D:\Agent\yearflow\dist\registerSW.js`、`D:\Agent\yearflow\dist\sw.js`（`self.skipWaiting(), e.clientsClaim()`）
- [WebKit: Web Push for Web Apps on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)（standalone/fullscreen manifest 是主屏 App 前提；角标）
- [Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay/)（已安装 PWA 获 autoplay 授权）
- iOS 主屏 App 冻结/重启丢状态：[firt.dev](https://firt.dev/ios-12.2/) 等（置信度 中，需实机复测）

**对 YearFlow 的建议做法**
1. **别改 `registerType`，但也别加 `registerSW({immediate:true})`**。如果将来想要更新提示，走 `prompt` 模式，并在 `onNeedRefresh` 里加一道闸：**有 `running` 番茄时不提示、不 reload，等会话结束或用户明确同意再更新**。
2. 加一个全局 dynamic-import 失败兜底（`window.addEventListener('vite:preloadError')` 或 import 的 catch）：提示"应用已更新，需要刷新"，同样**在有 running 番茄时降级为"稍后刷新"**——而且因为 §2 的设计，即便真刷新了，番茄钟也会原样恢复（这是最好的防御：让 reload 变成无害操作）。
3. 若要在 SW 里加 `notificationclick`，用 `workbox: { importScripts: ['pomodoro-sw.js'] }` + `public/pomodoro-sw.js`，**不要**为此把整个 PWA 策略切成 `injectManifest`（风险面大，会牵动现有离线缓存与 GH Pages 子路径 `base`）。
4. `start_url`/`scope` 已按 `base` 处理好（GH Pages 子路径），番茄钟的通知 `openWindow` 也必须用同一个 `base`，否则 iOS/Android 上点通知会开出 scope 外的新窗口。

**降级路径**
- SW 不可用（隐私模式/注册失败）→ 通知走 `new Notification()`（桌面可行）→ 再不行走 title + 声音 + 页面内横幅。
- 更新失败 / chunk 404 → 提示手动刷新；数据与计时不受影响（会话状态在 IndexedDB）。

**验证方法**
- 部署 A 版 → 打开页面开始番茄 → 部署 B 版 → 断言：页面**没有**自动 reload，番茄仍在跑；DevTools → Application → Service Workers 里新 SW 已 activated。
- 同一状态下点进复盘页，断言懒加载不 404（若 404，说明需要做第 2 条兜底）。
- DevTools 勾 "Update on reload" + 手动 skipWaiting，观察是否有意外 reload。
- iPhone：装到主屏 → 开始番茄 → 切 App 2 分钟 → 回来，断言走 `reconcile` 且时长正确、且（若已到点）弹了通知或显示了完成横幅。
- 断言无痕窗口（SW 不注册）下功能仍可用。

---

## 附：落地时会碰到的项目结构影响（供后续 agent 参考）

- **Dexie schema**：`D:\Agent\yearflow\src\db\schema.ts` 目前只有 `version(1)`。新增 `pomodoros` 表必须 `.version(2).stores({...})` 追加，保留 version(1) 定义不变（否则老设备升级会炸）。
- **同步**：`pomodoros` 若要入云，需同时改 `supabase\migrations\0002_*.sql`（新表 + `upsert_rows` RPC 的**硬编码表名白名单**）与 `src\db\sync\engine.ts` 的 `REMOTE_TABLE` 映射。**建议只同步已结束的会话**；`lastSeenAt` 心跳与"当前运行会话指针"归入**不同步**的本地存储（同 `settings` 的定位）。
- **undo 边界**：番茄会话生命周期（start/pause/complete/abandon）**不进** `execute()`（避免冲掉 100 步 undo 栈、避免 undo 出一个"复活的番茄钟"）；由番茄结算写入 CheckIn `minutes` 的那一步**走 `execute()`**，保持可撤销。这条要写进 `docs/PROGRESS.md`。
- **持久化时机**：心跳与状态迁移**绕过** `src\store\persist.ts` 的 500ms 防抖，直写 repo；否则崩溃会丢最后半秒到 5 秒的状态。
- **常量与令牌**：番茄时长档位、心跳间隔、gap 阈值（60s / 15min / 5min 最小计入）应集中成一个 `src/pomodoro/constants.ts`，颜色尺寸只引 `src/styles/tokens.css`（CLAUDE.md 铁律）。
- **必须先做的一个实验**（决定 §1 核心推论）：单根长 `setTimeout` 在 quick intensive throttling 开启下隐藏 20 分钟的实际误差。若实测发现它也被压到 1/min，则提醒延迟上限就是 ~60s，需相应调整设置页文案与 `reconcile` 的第二行判定（把"到点没响"视为常态而非异常）。

Sources:
- [Heavy throttling of chained JS timers beginning in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [Background tabs in Chrome 57](https://developer.chrome.com/blog/background_tabs)
- [Intent to Ship: Quick intensive timer throttling of loaded background pages](https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE)
- [Quick intensive timer throttling — Chrome Platform Status](https://chromestatus.com/feature/5580139453743104)
- [MDN: Window.setTimeout()](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)
- [MDN: Performance.now()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)
- [mdn/content issue 4713 — performance.now() spec non-compliance](https://github.com/mdn/content/issues/4713)
- [WebKit bug 225610 — performance.now() does not tick during system sleep](https://bugs.webkit.org/show_bug.cgi?id=225610)
- [Bugzilla 1709767 — performance.now() pauses during sleep](https://bugzilla.mozilla.org/show_bug.cgi?id=1709767)
- [whatwg/html issue 6759 — timers and system sleep](https://github.com/whatwg/html/issues/6759)
- [Page Lifecycle API](https://developer.chrome.com/blog/page-lifecycle-api)
- [MDN: Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [w3c/web-locks EXPLAINER](https://github.com/w3c/web-locks/blob/main/EXPLAINER.md)
- [MDN: Notification() constructor](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification)
- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [MoEngage: Safari Web Push for iOS and iPadOS](https://developers.moengage.com/hc/en-us/articles/13906923326100-Safari-Web-Push-for-iOS-and-iPadOS)
- [Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay/)
- [nattog.dev: Avoiding unmuting iOS devices for the Web Audio API](https://nattog.dev/blog/web-audio-ios-unmute)
- [swevans/unmute](https://github.com/swevans/unmute) · [feross/unmute-ios-audio](https://github.com/feross/unmute-ios-audio)
- [MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [vite-pwa: Automatic reload (autoUpdate)](https://vite-pwa-org.netlify.app/guide/auto-update.html)
- [Nolan Lawson: Why do browsers throttle JavaScript timers?](https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/)
- [Apple Developer Forums: Preventing JavaScript from Stopping in Safari When It Goes into the Background](https://developer.apple.com/forums/thread/777860)
- [firt.dev: What's new on iOS 12.2 for Progressive Web Apps](https://firt.dev/ios-12.2/)
- [worker-interval](https://github.com/gorkemcnr/worker-interval) · [Overcoming browser throttling of setInterval](https://medium.com/@adithyaviswam/overcoming-browser-throttling-of-setinterval-executions-45387853a826)