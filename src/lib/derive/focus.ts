/**
 * 专注会话派生（番茄钟规格 §五 / §六 / §七）：结算、中断恢复判定、投入时长口径。
 * 纯函数 + vitest，不入库（CLAUDE.md）。
 *
 * 两条贯穿全文件的铁律：
 * 1. 时长的唯一权威是墙钟差值（Date.now()），绝不 tick 累加。
 * 2. 全程以 ms 为单位，只有渲染那一行才 round(ms/60000)：
 *    逐段四舍五入再相加，4 段各 25 分 29 秒会得出 100 分而整体是 102 分，
 *    误差随段数线性增长，且「面板今日已专注」与「月度投入」会给出两个都对但不一样的数。
 */
import type { CheckIn, FocusPause, FocusSession, RunningPause, RunningState } from '../../types/domain';
import { dayjs, fmtDay } from '../date';
import {
  GAP_ASK_MS,
  HARD_CUT_MS,
  MIN_SESSION_MS,
  PAUSE_LIMIT,
  BREAK_CHIME_GRACE_MS,
} from '../../pomodoro/constants';

const MS_PER_MIN = 60_000;

/** 该会话是否计入统计：软删与「丢弃」都不计（丢弃留痕仅供审计） */
export function isCountedSession(s: FocusSession): boolean {
  return !s.deletedAt && s.outcome !== 'discarded';
}

/**
 * 落在 [from, to] 区间内的暂停总时长。末条未闭合的暂停按 to 闭合。
 * ⚠️ 结算（netFocusMs）与恢复判定（plannedEnd）必须共用这一个函数：
 * 两处口径若不一致，「暂停 2 小时后重开」会被按计划终点全额结算 —— 直接的记错时间。
 */
function pausedMsWithin(pauses: RunningPause[], from: number, to: number): number {
  let paused = 0;
  for (const p of pauses) {
    const start = Math.max(p.at, from);
    const end = Math.min(p.until ?? to, to);
    if (end > start) paused += end - start;
  }
  return paused;
}

/** 净专注毫秒：扣除全部暂停区间；末条未闭合暂停按 endAt 闭合 */
export function netFocusMs(startAt: number, endAt: number, pauses: RunningPause[]): number {
  return endAt - startAt - pausedMsWithin(pauses, startAt, endAt);
}

/** 暂停总时长（末条未闭合按 now 闭合），用于把计划终点往后推 */
export function pausedTotalMs(running: RunningState, now: number): number {
  return pausedMsWithin(running.pauses, running.startAt, now);
}

/** 计划终点 = 开始 + 计划时长 + 已发生的暂停 */
export function plannedEndOf(running: RunningState, now: number): number {
  return running.startAt + running.plannedMs + pausedTotalMs(running, now);
}

/** 是否正在暂停中（末条暂停未闭合） */
export function isPaused(running: RunningState): boolean {
  const last = running.pauses[running.pauses.length - 1];
  return last !== undefined && last.until === undefined;
}

/**
 * 暂停段上限：超出时合并最早的相邻两段。
 * focusMs 是结算后的权威值、不由 pauses 反算 ⇒ 合并不影响记账，只损失一点审计精度。
 */
function capPauses(pauses: RunningPause[], limit = PAUSE_LIMIT): RunningPause[] {
  const out = pauses.slice();
  while (out.length > limit) {
    const [a, b] = [out[0], out[1]];
    out.splice(0, 2, { at: a.at, until: b.until });
  }
  return out;
}

function toIsoPauses(pauses: RunningPause[], endAt: number): FocusPause[] {
  return capPauses(pauses).map((p) => ({
    at: new Date(p.at).toISOString(),
    until: new Date(Math.min(p.until ?? endAt, endAt)).toISOString(),
  }));
}

export interface SettleOpts {
  outcome: FocusSession['outcome'];
  /** 结算截止时刻（缺省 = now）：恢复流程传计划终点或最后心跳时刻 */
  endAt?: number;
  /** 已算好的净时长（恢复流程给出，避免与 planRecovery 口径漂移） */
  focusMs?: number;
  /** 横切标记：时钟跳变 / 长时间失联后补算 */
  needsReview?: boolean;
  source?: FocusSession['source'];
}

/**
 * 结算的唯一实现（UI 与恢复流程共用，预览与提交零口径漂移）。
 * 返回 null = 不落库：休息段永不落库；净时长不足 1 分钟视为误触。
 */
export function settleSession(
  running: RunningState,
  now: number,
  opts: SettleOpts,
): FocusSession | null {
  if (running.phase !== 'focus') return null; // 休息不是投入，存了只会污染统计与同步流量
  const endAt = opts.endAt ?? now;
  const raw = opts.focusMs ?? netFocusMs(running.startAt, endAt, running.pauses);
  // 无条件 clamp：NTP 校正/改时区造成的负时长或「合盖 3 小时」的假会话，结构上不可能落库
  const focusMs = Math.min(Math.max(raw, 0), running.plannedMs);
  const needsReview = Boolean(opts.needsReview) || raw < 0 || raw > running.plannedMs;
  if (focusMs < MIN_SESSION_MS) return null;

  const iso = (ms: number) => new Date(ms).toISOString();
  const pauses = toIsoPauses(running.pauses, endAt);
  const nowIso = iso(now);
  return {
    id: running.sessionId, // 预生成 ⇒ 重复结算幂等（多标签/竞态不会写两条）
    goalId: running.goalId,
    taskId: running.taskId,
    // 跨天会话（23:50 开始）按开始日整段归属，与「一天边界 = 本地 00:00」铁律一致；此后冻结
    date: fmtDay(dayjs(running.startAt)),
    startAt: iso(running.startAt),
    endAt: iso(endAt),
    focusMs,
    plannedMs: running.plannedMs,
    ...(pauses.length > 0 ? { pauses } : {}),
    outcome: opts.outcome,
    source: opts.source ?? 'timer',
    ...(needsReview ? { needsReview: true } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export type RecoveryKind =
  | 'resume'
  | 'settleAtPlannedEnd'
  | 'ask'
  | 'hardCut'
  | 'dropSilently';

export interface RecoveryPlan {
  kind: RecoveryKind;
  /** 结算类分支的净时长；resume / dropSilently 不带 */
  focusMs?: number;
  /** 结算截止时刻（settleAtPlannedEnd / ask 用） */
  endAt?: number;
  /** 横切标记，不是分支；落到 resume / 休息总闸时直接丢弃 */
  needsReview: boolean;
  /** 休息总闸：刚过点不久，补一次响铃 */
  chime?: boolean;
}

/**
 * 中断恢复判定（§5.5）—— 带优先级的有序 if-else 链，从上往下第一个命中者胜出。
 * 无序的条件表会出现多行同时命中且结论互斥（>4h 与已到点同时成立时算哪个？）。
 *
 * 跨文档跳变探测只看时钟自洽性，绝不碰 performance.now()：后者的原点是当前文档的
 * timeOrigin，刷新即归零 —— 拿上个文档的值做差，跑满 2 秒再刷新就会给每条会话打上待确认。
 */
export function planRecovery(running: RunningState, now: number): RecoveryPlan {
  const gap = now - running.lastHeartbeatAt;
  const plannedEnd = plannedEndOf(running, now);
  const netToHeartbeat = netFocusMs(running.startAt, running.lastHeartbeatAt, running.pauses);
  // 时钟回拨，或「已记录的净时长超过了总共流逝的时间」= 自相矛盾
  const jumped = now < running.lastHeartbeatAt || now - running.startAt < netToHeartbeat;

  // 0. 休息总闸：任何分支都不落库、不弹对话、不动节律计数。
  //    少了它，休息中关页面再打开会命中「已到点 → 按计划终点结算 completed」，
  //    写出一条休息伪装成的专注会话，直接污染投入时长与全部复盘数字。
  if (running.phase !== 'focus') {
    if (now >= plannedEnd) {
      return { kind: 'dropSilently', needsReview: false, chime: now - plannedEnd < BREAK_CHIME_GRACE_MS };
    }
    return gap <= GAP_ASK_MS
      ? { kind: 'resume', needsReview: false }
      : { kind: 'dropSilently', needsReview: false };
  }

  // 1. 超长硬截断优先于一切（含已到点）
  if (now - running.startAt > HARD_CUT_MS) {
    return {
      kind: 'hardCut',
      focusMs: Math.min(netFocusMs(running.startAt, now, running.pauses), running.plannedMs),
      endAt: now,
      needsReview: true,
    };
  }

  // 2. 暂停优先于到点：暂停中的会话永不自动结算（用户明明按了暂停）
  if (isPaused(running)) return { kind: 'resume', needsReview: jumped };

  // 3. 已过计划终点：按计划终点结算，不弹阻塞对话
  if (now >= plannedEnd) {
    return {
      kind: 'settleAtPlannedEnd',
      focusMs: netFocusMs(running.startAt, plannedEnd, running.pauses),
      endAt: plannedEnd,
      needsReview: jumped || gap > GAP_ASK_MS,
    };
  }

  // 4. 失联太久：暂停在最后心跳处，让用户做一次明确选择。
  //    focusMs 走 netFocusMs 而不是裸截断，否则暂停时长会被重复扣一次。
  if (gap > GAP_ASK_MS) {
    return {
      kind: 'ask',
      focusMs: netFocusMs(running.startAt, running.lastHeartbeatAt, running.pauses),
      endAt: running.lastHeartbeatAt,
      needsReview: jumped,
    };
  }

  // 5. 正常刷新/切页：无缝续跑
  return { kind: 'resume', needsReview: jumped };
}

/** 节律：是否该进长休息。缺了 completed > 0，第一段还没跑时也会为真 */
export function shouldLongBreak(completed: number, longBreakEvery: number): boolean {
  return longBreakEvery > 0 && completed > 0 && completed % longBreakEvery === 0;
}

// ── 统计口径 ─────────────────────────────────────────────────────────────

/** 某日各任务的自动专注毫秒。taskId 缺省归入 '' 桶 */
export function focusMsByTaskDate(sessions: FocusSession[], date: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    if (!isCountedSession(s) || s.date !== date) continue;
    const key = s.taskId ?? '';
    out.set(key, (out.get(key) ?? 0) + s.focusMs);
  }
  return out;
}

/** 某日全部专注毫秒（面板「今日已专注」） */
export function todayFocusMs(sessions: FocusSession[], date: string): number {
  let ms = 0;
  for (const s of sessions) {
    if (isCountedSession(s) && s.date === date) ms += s.focusMs;
  }
  return ms;
}

/** 未归类会话（goalId 缺省），供面板「N 段未归类 · 去归类」入口。软删与丢弃不列 */
export function unassignedSessions(sessions: FocusSession[]): FocusSession[] {
  return sessions.filter((s) => !s.goalId && isCountedSession(s));
}

type Bucket = [manualMs: number, autoMs: number];

function bucketOf(map: Map<string, Bucket>, key: string): Bucket {
  let b = map.get(key);
  if (!b) {
    b = [0, 0];
    map.set(key, b);
  }
  return b;
}

/**
 * 投入时长口径：max(手填, 自动)，在 (goal, task, date) 粒度上取 max 再求和。
 * 一句话解释给用户：「取更完整的那个」。
 *
 * 为什么按任务分桶而不是直接在目标级取 max：一个目标下任务 A 手填 60 分、任务 B 跑了
 * 25 分钟番茄，目标级 max 会得到 60（丢掉 B 的 25）；分桶后是 85，正确。
 *
 * prefix 可以是 'YYYY-MM-DD'（某日）/ 'YYYY-MM'（某月）/ 'YYYY-'（某年）。
 * 分桶按记录自身的 date，绝不按「应打卡日集合」—— 否则非应打卡日的手填分钟会整段丢失。
 */
export function effectiveMsByGoalPrefix(
  checkIns: CheckIn[],
  sessions: FocusSession[],
  goalId: string,
  prefix: string,
): number {
  const buckets = new Map<string, Bucket>();
  for (const c of checkIns) {
    if (c.deletedAt || c.goalId !== goalId || !c.date.startsWith(prefix)) continue;
    bucketOf(buckets, `${c.taskId ?? ''}|${c.date}`)[0] += (c.minutes ?? 0) * MS_PER_MIN;
  }
  for (const s of sessions) {
    if (!isCountedSession(s) || s.goalId !== goalId || !s.date.startsWith(prefix)) continue;
    bucketOf(buckets, `${s.taskId ?? ''}|${s.date}`)[1] += s.focusMs;
  }
  let total = 0;
  for (const [manual, auto] of buckets.values()) total += Math.max(manual, auto);
  return total;
}

/** 某目标某日的投入毫秒 */
export function effectiveMsByGoalDate(
  checkIns: CheckIn[],
  sessions: FocusSession[],
  goalId: string,
  date: string,
): number {
  return effectiveMsByGoalPrefix(checkIns, sessions, goalId, date);
}

/**
 * 按月×目标投入毫秒（年度堆叠面积图 + 投入总时长卡的共同数据源）。
 * 形状与旧的 minutesByGoalByMonth 同构：一次遍历算完 12 个月。
 * ⚠️ goalId 键集合 = checkIns ∪ sessions —— 只跑了番茄没打卡的目标不能整个缺键。
 * 未归类会话（goalId 缺省）不进任何 goal 级统计（复盘页另给一行灰字说明）。
 */
export function effectiveMsByGoalByYear(
  checkIns: CheckIn[],
  sessions: FocusSession[],
  year: number,
): Map<number, Map<string, number>> {
  const prefix = `${year}-`;
  // month → goalId → `${taskKey}|${date}` → Bucket
  const raw = new Map<number, Map<string, Map<string, Bucket>>>();
  const bucket = (month: number, goalId: string, key: string): Bucket => {
    let byGoal = raw.get(month);
    if (!byGoal) {
      byGoal = new Map();
      raw.set(month, byGoal);
    }
    let byKey = byGoal.get(goalId);
    if (!byKey) {
      byKey = new Map();
      byGoal.set(goalId, byKey);
    }
    return bucketOf(byKey, key);
  };

  for (const c of checkIns) {
    if (c.deletedAt || !c.minutes || !c.date.startsWith(prefix)) continue;
    const month = Number(c.date.slice(5, 7));
    bucket(month, c.goalId, `${c.taskId ?? ''}|${c.date}`)[0] += c.minutes * MS_PER_MIN;
  }
  for (const s of sessions) {
    if (!isCountedSession(s) || !s.goalId || !s.date.startsWith(prefix)) continue;
    const month = Number(s.date.slice(5, 7));
    bucket(month, s.goalId, `${s.taskId ?? ''}|${s.date}`)[1] += s.focusMs;
  }

  const out = new Map<number, Map<string, number>>();
  for (const [month, byGoal] of raw) {
    const totals = new Map<string, number>();
    for (const [goalId, byKey] of byGoal) {
      let ms = 0;
      for (const [manual, auto] of byKey.values()) ms += Math.max(manual, auto);
      // 只在有量时建键：空 sessions 时结果与改造前完全一致（回归护栏）
      if (ms > 0) totals.set(goalId, ms);
    }
    if (totals.size > 0) out.set(month, totals);
  }
  return out;
}
