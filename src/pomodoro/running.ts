/**
 * 运行态与节律计数的持久化 —— 一律 localStorage，不入库、不同步、不进 undo。
 *
 * 为什么不用 Dexie：
 * · 同步写入无防抖（Dexie 走 500ms 防抖，硬刷新会丢最后 ≤500ms）；
 * · 不触发 emitLocalWrite ——否则每 5 秒一次心跳会不断重置云同步的 3 秒防抖，
 *   番茄运行期间云同步被无限推迟，直到停止写入 3 秒后才推；
 * · 天生设备本地不同步（两台设备各跑一个番茄是正确行为，不是冲突）；
 * · storage 事件让其它标签页免费收到变更通知。
 */
import type { CycleState, RunningState } from '../types/domain';
import { todayStr } from '../lib/date';
import { CYCLE_IDLE_RESET_MS, CYCLE_KEY, LAST_TASK_KEY, RUNNING_KEY } from './constants';

const hasStorage = (): boolean => typeof localStorage !== 'undefined';

function readJson<T>(key: string): T | null {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // 损坏视为不存在，绝不让脏数据把计时器卡死
  }
}

function writeJson(key: string, value: unknown): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式/配额满：宁可丢运行态也不要抛异常打断计时
  }
}

/** 读运行态；结构不完整的残留一律视为无（老版本键、手改坏了的值） */
export function readRunning(): RunningState | null {
  const r = readJson<RunningState>(RUNNING_KEY);
  if (!r || typeof r.sessionId !== 'string' || typeof r.startAt !== 'number') return null;
  if (typeof r.plannedMs !== 'number' || !Array.isArray(r.pauses)) return null;
  if (r.phase !== 'focus' && r.phase !== 'shortBreak' && r.phase !== 'longBreak') return null;
  return r;
}

export function writeRunning(r: RunningState): void {
  writeJson(RUNNING_KEY, r);
}

export function clearRunning(): void {
  if (hasStorage()) localStorage.removeItem(RUNNING_KEY);
}

/**
 * 读节律计数，顺带做自动清零：跨自然日 或 空闲超过 2 小时。
 * 独立于 RunningState 存放，因为后者每次回 idle 就被删 —— 计数放里面结构上永远是 0，
 * 长休息永不触发。
 */
export function readCycle(now: number): CycleState {
  const fresh: CycleState = { date: todayStr(), completed: 0, lastAt: now };
  const c = readJson<CycleState>(CYCLE_KEY);
  if (!c || typeof c.completed !== 'number' || typeof c.lastAt !== 'number') return fresh;
  if (c.date !== fresh.date || now - c.lastAt > CYCLE_IDLE_RESET_MS) return fresh;
  return c;
}

/** 只有 outcome === 'completed' 才调用（stopped / discarded 不算） */
export function bumpCycleCompleted(now: number): number {
  const c = readCycle(now);
  const next: CycleState = { date: todayStr(), completed: c.completed + 1, lastAt: now };
  writeJson(CYCLE_KEY, next);
  return next.completed;
}

/** 走完一次长休息后清零 */
export function resetCycle(now: number): void {
  writeJson(CYCLE_KEY, { date: todayStr(), completed: 0, lastAt: now } satisfies CycleState);
}

export function readLastTask(): { goalId?: string; taskId?: string } | null {
  return readJson<{ goalId?: string; taskId?: string }>(LAST_TASK_KEY);
}

export function writeLastTask(sel: { goalId?: string; taskId?: string }): void {
  writeJson(LAST_TASK_KEY, sel);
}
