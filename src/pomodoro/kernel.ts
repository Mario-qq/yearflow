/**
 * 计时内核（番茄钟规格 §五）。
 *
 * 五条不可让的铁律：
 * 1. 绝不 tick 累加。时长的唯一权威是 Date.now() 差值；剩余时间每次现算。
 * 2. 闹钟是单根长 setTimeout（定时器链长恒为 1 ⇒ 结构上免疫 Chrome 的 1 次/分钟
 *    intensive 节流档）；回调里必须先跳一个宏任务再下一单，否则链长会递增。
 * 3. 免疫 intensive ≠ 免疫 frozen：frozen 态下所有 timer 都不跑，
 *    所以 visibilitychange → visible 的补算是必需路径，不是兜底。
 * 4. 内核是模块单例，与任何 React 组件的挂载/卸载无关。窗口被拖窄到 <768px 时
 *    番茄入口不渲染，但计时照常跑（若闹钟挂在组件里，拉宽回来必然弹一次莫名的结算对话）。
 * 5. 任何 execute 都必须在 store.hydrated === true 之后 —— hydrate 的 set() 会整体
 *    替换 focusSessions map，抢跑的结算会「进了 Dexie 与 undo 栈，内存里却没有」。
 */
import { nanoid } from 'nanoid';
import type { FocusSession, RunningState } from '../types/domain';
import { useStore } from '../store/useStore';
import { commitFocusSession } from '../store/actions';
import {
  isPaused,
  netFocusMs,
  planRecovery,
  plannedEndOf,
  settleSession,
  shouldLongBreak,
  type RecoveryPlan,
} from '../lib/derive/focus';
import { CYCLE_KEY, HEARTBEAT_MS, LOCK_NAME, RUNNING_KEY } from './constants';
import {
  bumpCycleCompleted,
  clearRunning,
  readCycle,
  readRunning,
  resetCycle,
  writeLastTask,
  writeRunning,
} from './running';
import { usePomodoroStore, type RunningView } from './store';

const isBrowser = typeof window !== 'undefined';

// ── 模块级状态（不是组件 state） ──────────────────────────────────────────
let alarmHandle: ReturnType<typeof setTimeout> | null = null;
let alarmToken = 0;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
/** 已结算的 sessionId：幂等 id 只能保住 Dexie 行数，保不住 undo 栈格数 */
const settledIds = new Set<string>();
/**
 * 本文档是否知道「有 leader 存在」。
 *
 * ⚠️ S4 实测修正：这个标记必须在**拿到锁之前**就为 true（只要 Web Locks 可用），
 * 不能等自己被授予锁才置位 —— 后者是从 leader 视角看的，而它真正的消费者是
 * **follower**（`onAlarm` 的 `!isLeader && leaderKnown` 门禁）。等自己拿到锁才置位 ⇒
 * 排队中的 follower 永远 `leaderKnown === false` ⇒ **每个标签都会自己结算、自己响铃**：
 * 两个标签开着时实测由 follower 抢先落库（leader 反被 storage 事件挡回），结果卡与响铃
 * 出现在用户没在看的那个标签，声音还会响两遍。Dexie 行数靠预生成 id 仍是 1，所以这个
 * 缺陷不会丢数、也不报错，只会「响两声、卡片跑错标签」。
 * 置位后的剩余风险窗口是「锁还没授予就到点」——规格已明确接受（窗口只有几毫秒，
 * 且 catchUp/initPomodoro 的恢复路径不受 leader 门禁约束，时长不会丢）。
 */
let leaderKnown = false;
let initialized = false;

/** 响铃/通知由 S4 注入（音频异常绝不允许阻断数据写入，故排在落库之后） */
export type ChimeKind = 'focusEnd' | 'breakEnd';
let chimeHandler: ((kind: ChimeKind) => void) | null = null;
export function setChimeHandler(fn: ((kind: ChimeKind) => void) | null): void {
  chimeHandler = fn;
}

// ── 视图同步（状态迁移时才写 store） ─────────────────────────────────────

function toView(r: RunningState, now: number): RunningView {
  const paused = isPaused(r);
  const last = r.pauses[r.pauses.length - 1];
  return {
    sessionId: r.sessionId,
    phase: r.phase,
    goalId: r.goalId,
    taskId: r.taskId,
    startAt: r.startAt,
    plannedMs: r.plannedMs,
    paused,
    plannedEnd: plannedEndOf(r, now),
    pausedRemainingMs:
      paused && last ? Math.max(0, r.plannedMs - netFocusMs(r.startAt, last.at, r.pauses)) : null,
  };
}

function syncView(r: RunningState | null): void {
  usePomodoroStore.setState({ running: r ? toView(r, Date.now()) : null });
}

/** 剩余毫秒：现算，供 ticker 与 DEV 挂钟对照用 */
export function remainingMs(): number {
  const v = usePomodoroStore.getState().running;
  if (!v) return 0;
  if (v.pausedRemainingMs !== null) return v.pausedRemainingMs;
  return Math.max(0, v.plannedEnd - Date.now());
}

// ── 闹钟 ────────────────────────────────────────────────────────────────

function clearAlarm(): void {
  alarmToken += 1;
  if (alarmHandle !== null) clearTimeout(alarmHandle);
  alarmHandle = null;
}

/**
 * 下单根长 timeout。先经 MessageChannel 跳出一个新宏任务再 setTimeout：
 * HTML 规范的 timer nesting level 在「setTimeout 从定时器回调内部被调用」时递增，
 * 一旦将来接上「自动开始下一段」，连续续段会把链长推过 5，此后每根闹钟都掉进
 * 1 次/分钟档 —— 恰好毁掉「单根长 timeout 免疫 intensive 档」这条核心论证。
 */
function scheduleAlarm(delayMs: number): void {
  clearAlarm();
  if (!isBrowser) return;
  const token = alarmToken;
  const hop = new MessageChannel();
  hop.port1.onmessage = () => {
    if (token !== alarmToken) return; // 已被 clearAlarm 作废
    alarmHandle = setTimeout(() => {
      if (token !== alarmToken) return;
      alarmHandle = null;
      onAlarm();
    }, Math.max(0, delayMs));
  };
  hop.port2.postMessage(0);
}

function rearmAlarm(r: RunningState): void {
  if (isPaused(r)) {
    clearAlarm(); // 暂停时不留闹钟：剩余量冻结在按下暂停那一刻，继续时按剩余量重下单
    return;
  }
  scheduleAlarm(plannedEndOf(r, Date.now()) - Date.now());
}

function onAlarm(): void {
  const r = readRunning();
  if (!r) return;
  // hydrate 的 set() 会整体替换 focusSessions map，抢跑的 execute 会「进了库却不在内存」
  if (!useStore.getState().hydrated) return;
  // 非 leader 且已经选出了 leader：由 leader 负责结算与响铃，本标签只等 storage 事件
  if (!usePomodoroStore.getState().isLeader && leaderKnown) return;
  if (r.phase === 'focus') {
    terminate('completed', { endAt: plannedEndOf(r, Date.now()) });
  } else {
    endBreak(true);
  }
}

// ── 心跳 ────────────────────────────────────────────────────────────────

/**
 * 崩溃 / 杀进程 / 标签被 discard 没有任何回调，心跳是唯一手段，最多丢 5 秒。
 * ⚠️ 暂停期间必须继续写：否则「暂停去开会 2 分钟回来刷新页面」会 gap > 90s，
 * 弹一次完全无必要的「刚才那段算不算」对话 —— 这在日常使用里天天发生。
 */
function beat(): void {
  const r = readRunning();
  if (!r) {
    stopHeartbeat();
    return;
  }
  writeRunning({ ...r, lastHeartbeatAt: Date.now() });
}

function startHeartbeat(): void {
  if (!isBrowser || heartbeatHandle !== null) return;
  beat();
  heartbeatHandle = setInterval(beat, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatHandle !== null) clearInterval(heartbeatHandle);
  heartbeatHandle = null;
}

// ── 终止序列（硬性顺序，防「一次会话两格 undo」） ────────────────────────

interface TerminateOpts {
  endAt?: number;
  focusMs?: number;
  needsReview?: boolean;
}

/**
 * 任何终止路径（到点 / 停止 / 丢弃 / 恢复结算 / 切任务）都必须走这里。
 * 顺序不可调换：先 clearTimeout + settledIds 早退，再删 localStorage，再落库，最后响铃。
 * 否则「用户在计划终点前几毫秒点停止、timeout 随后触发」会写出两格 undo，
 * 且第二格把 outcome: 'stopped' 覆盖成 'completed'。
 */
function terminate(outcome: FocusSession['outcome'], opts: TerminateOpts = {}): void {
  clearAlarm();
  const r = readRunning();
  if (!r) return;
  if (settledIds.has(r.sessionId)) return;
  settledIds.add(r.sessionId);
  clearRunning();
  stopHeartbeat();
  usePomodoroStore.setState({ running: null, ask: null });

  if (r.phase !== 'focus') return; // 休息不落库

  const now = Date.now();
  const session = settleSession(r, now, { outcome, ...opts });
  if (session) {
    // 结算落库失败（Dexie 异常）不回滚、不重试：宁可丢一段记录，也不留状态不明的运行态
    try {
      commitFocusSession(session);
      usePomodoroStore.setState({ lastResult: session });
      if (session.outcome === 'completed') {
        const completed = bumpCycleCompleted(now);
        usePomodoroStore.setState({ cycleCompleted: completed });
      }
    } catch {
      usePomodoroStore.setState({ notice: '这段专注未能写入本地库，请检查浏览器存储权限' });
    }
  } else if (outcome !== 'discarded') {
    // 开了 30 秒发现开错的情况很常见，不给提示用户会怀疑「刚才那半分钟去哪了」
    usePomodoroStore.setState({ notice: '这段不足 1 分钟，未记录' });
  }

  if (usePomodoroStore.getState().isLeader || !leaderKnown) chimeHandler?.('focusEnd');
}

/** 休息结束（v1 只有「跳过休息」与残留态清理会走到） */
function endBreak(chime: boolean): void {
  clearAlarm();
  const r = readRunning();
  clearRunning();
  stopHeartbeat();
  usePomodoroStore.setState({ running: null });
  if (r?.phase === 'longBreak') {
    resetCycle(Date.now());
    usePomodoroStore.setState({ cycleCompleted: 0 });
  }
  if (chime && (usePomodoroStore.getState().isLeader || !leaderKnown)) chimeHandler?.('breakEnd');
}

// ── 对外操作 ────────────────────────────────────────────────────────────

export interface StartOpts {
  goalId?: string;
  taskId?: string;
  /** 覆盖计划时长（DEV/测试用）；缺省取设置里的专注时长 */
  plannedMs?: number;
}

export function startFocus(opts: StartOpts = {}): void {
  const existing = readRunning();
  // 进行中切任务 = 切分成两条会话（不做时间分摊：分摊比例无法可信获得）
  if (existing) terminate(existing.phase === 'focus' ? 'stopped' : 'discarded');

  const { focusMin } = useStore.getState().settings.pomodoro;
  const plannedMs = opts.plannedMs ?? focusMin * 60_000;
  const now = Date.now();
  const r: RunningState = {
    sessionId: nanoid(),
    phase: 'focus',
    goalId: opts.goalId,
    taskId: opts.taskId,
    startAt: now,
    plannedMs,
    pauses: [],
    lastHeartbeatAt: now,
  };
  writeRunning(r);
  writeLastTask({ goalId: opts.goalId, taskId: opts.taskId });
  usePomodoroStore.setState({ lastResult: null, ask: null });
  syncView(r);
  startHeartbeat();
  rearmAlarm(r);
}

export function pauseFocus(): void {
  const r = readRunning();
  if (!r || r.phase !== 'focus' || isPaused(r)) return;
  const next: RunningState = { ...r, pauses: [...r.pauses, { at: Date.now() }] };
  writeRunning(next);
  syncView(next);
  rearmAlarm(next);
}

export function resumeFocus(): void {
  const r = readRunning();
  if (!r || !isPaused(r)) return;
  const pauses = r.pauses.slice();
  pauses[pauses.length - 1] = { ...pauses[pauses.length - 1], until: Date.now() };
  const next: RunningState = { ...r, pauses };
  writeRunning(next);
  usePomodoroStore.setState({ ask: null });
  syncView(next);
  startHeartbeat();
  rearmAlarm(next);
}

/** 按 P：空闲则开始，运行则暂停，暂停则继续，休息中则跳过休息 */
export function togglePomodoro(sel: { goalId?: string; taskId?: string } = {}): void {
  const r = readRunning();
  if (!r) {
    startFocus(sel);
    return;
  }
  if (r.phase !== 'focus') {
    endBreak(false); // 休息中按 P = 跳过休息（不落库、不响铃）
    return;
  }
  if (isPaused(r)) resumeFocus();
  else pauseFocus();
}

/** 提前停止：按实际净时长记账 */
export function stopFocus(): void {
  const r = readRunning();
  if (!r) return;
  if (r.phase === 'focus') terminate('stopped');
  else endBreak(false);
}

/** 丢弃：focusMs 照实记但不计任何统计（不足 1 分钟则直接不落库） */
export function discardFocus(): void {
  if (readRunning()?.phase === 'focus') terminate('discarded');
  else endBreak(false);
}

export function skipBreak(): void {
  if (readRunning()?.phase !== 'focus') endBreak(false);
}

/** 结算对话的三个出口 */
export function resolveAsk(choice: 'keep' | 'continue' | 'discard'): void {
  const ask = usePomodoroStore.getState().ask;
  if (!ask) return;
  if (choice === 'continue') {
    resumeFocus();
    return;
  }
  terminate(choice === 'keep' ? 'stopped' : 'discarded', {
    endAt: ask.endAt,
    focusMs: ask.focusMs,
    needsReview: ask.needsReview,
  });
}

/** 下一段休息是否为长休息（面板节奏展示用） */
export function nextBreakIsLong(): boolean {
  const { longBreakEvery } = useStore.getState().settings.pomodoro;
  return shouldLongBreak(usePomodoroStore.getState().cycleCompleted, longBreakEvery);
}

// ── 中断恢复 ────────────────────────────────────────────────────────────

function applyRecovery(r: RunningState, plan: RecoveryPlan): void {
  switch (plan.kind) {
    case 'resume':
      syncView(r);
      startHeartbeat();
      rearmAlarm(r);
      break;
    case 'settleAtPlannedEnd':
    case 'hardCut':
      terminate('completed', {
        endAt: plan.endAt,
        focusMs: plan.focusMs,
        needsReview: plan.needsReview,
      });
      break;
    case 'ask': {
      // 暂停在最后一次心跳处，等用户做一次明确选择
      const paused: RunningState = {
        ...r,
        pauses: [...r.pauses, { at: r.lastHeartbeatAt }],
      };
      writeRunning(paused);
      usePomodoroStore.setState({
        ask: {
          sessionId: r.sessionId,
          focusMs: plan.focusMs ?? 0,
          endAt: plan.endAt ?? r.lastHeartbeatAt,
          needsReview: plan.needsReview,
        },
      });
      syncView(paused);
      startHeartbeat();
      break;
    }
    case 'dropSilently':
      endBreak(Boolean(plan.chime));
      break;
  }
}

/**
 * 回到前台时的补算。frozen 态下所有 timer 都不跑，所以这条路径是必需的。
 * 不按 leader 门禁：leader 恰好是那个被冻结的标签时，只有前台标签能救回这段时长。
 * 重复结算由 settledIds + 预生成 sessionId 幂等兜住。
 */
function catchUp(): void {
  const r = readRunning();
  if (!r || settledIds.has(r.sessionId)) return;
  if (!useStore.getState().hydrated) return; // initPomodoro 会在 hydrate 后接手

  applyRecovery(r, planRecovery(r, Date.now()));
}

function onStorage(e: StorageEvent): void {
  if (e.key === CYCLE_KEY) {
    usePomodoroStore.setState({ cycleCompleted: readCycle(Date.now()).completed });
    return;
  }
  // key === null 表示别的标签调用了 localStorage.clear()
  if (e.key !== null && e.key !== RUNNING_KEY) return;
  const r = readRunning();
  if (!r) {
    // 别的标签结束了这一段：立刻撤掉本标签的闹钟，防两格 undo
    const current = usePomodoroStore.getState().running;
    if (current) settledIds.add(current.sessionId);
    clearAlarm();
    stopHeartbeat();
    usePomodoroStore.setState({ running: null, ask: null });
    return;
  }
  const current = usePomodoroStore.getState().running;
  // 心跳只改 lastHeartbeatAt，不该引起任何重渲；只有真正的状态迁移才同步视图
  const migrated =
    !current ||
    current.sessionId !== r.sessionId ||
    current.phase !== r.phase ||
    current.paused !== isPaused(r);
  if (migrated) {
    syncView(r);
    rearmAlarm(r);
  }
}

// ── 初始化 ──────────────────────────────────────────────────────────────

/**
 * 模块顶层只做「装监听 + 拿锁」，恢复判定与结算挂在 hydrated 之后（见文件头铁律 5）。
 * 锁请求必须在模块顶层、全文档只执行一次：放进 useEffect 会被 StrictMode 的 dev 双调用
 * 发出第二次 request，而回调是一个永不 resolve 的 Promise（锁永不释放），
 * 第二个请求会永久排队且卸载时无法清理 —— 结构性泄漏。
 */
if (isBrowser) {
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', catchUp);
  window.addEventListener('online', catchUp);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') catchUp();
    else beat(); // hidden 是最后一个可靠可观测的状态（不用 beforeunload/unload：会破坏 bfcache）
  });
  window.addEventListener('pagehide', () => beat());

  if (navigator.locks?.request) {
    // 选主机制可用即认为「会有 leader」（见 leaderKnown 的注释：这一行决定 follower 是否闭嘴）
    leaderKnown = true;
    void navigator.locks
      .request(LOCK_NAME, { mode: 'exclusive' }, () => {
        usePomodoroStore.setState({ isLeader: true });
        // 上一任 leader 关闭后新 leader 才上位，此前作为 follower 没有闹钟 ⇒ 立即重下
        const r = readRunning();
        if (r) rearmAlarm(r);
        return new Promise<never>(() => {}); // 永不 resolve ⇒ 锁随标签存亡，崩溃安全
      })
      .catch(() => {
        leaderKnown = false;
      });
  }
}

/** App 在 hydrate 完成后调用一次 */
export function initPomodoro(): void {
  if (initialized) return;
  initialized = true;
  const now = Date.now();
  usePomodoroStore.setState({ cycleCompleted: readCycle(now).completed });
  const r = readRunning();
  if (r) applyRecovery(r, planRecovery(r, now));
}

// DEV 观测句柄：本机浏览器面板拿不到截图且会读到 React 提交前的旧渲染，
// 不暴露显式测试面就完全无法自动验证（既有约定：__store / __syncStore / __ganttDeriveComputes）
if (import.meta.env.DEV && isBrowser) {
  (window as unknown as Record<string, unknown>).__pomodoro = {
    store: usePomodoroStore,
    remainingMs,
    start: startFocus,
    forceSettle: () => stopFocus(),
  };
}
