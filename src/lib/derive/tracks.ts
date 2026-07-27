/**
 * 执行轨道（track）派生 — 纯函数，不入库。
 *
 * 轨道 = 同一 goal 内 trackId 相同的一组任务，代表「一个长期迭代项目的多段执行」。
 * 折叠时收成一行（包络汇总条），展开时成员按开始日缩进排列。
 *
 * 归属来自 Task.trackId 这个显式字段，不从 dependsOn 推导：
 * 依赖表达时序先后，轨道表达项目归属，二者不等价（同项目的并行任务无依赖，
 * 有先后的任务也未必同项目）。
 */
import type { Task } from '../../types/domain';
import { diffDays } from '../date';

/** 闭区间 [startDate, endDate] */
export interface TrackSegment {
  startDate: string;
  endDate: string;
}

export interface Track {
  /** = Task.trackId */
  id: string;
  goalId: string;
  /** 派生：headId 对应任务的 name，无独立存储 */
  name: string;
  /** 组内 startDate 最早者；并列取 order 最小；再并列取 id 字典序 */
  headId: string;
  /** 按 (startDate, order, id) 升序 */
  memberIds: string[];
  /** 包络：min(member.startDate) */
  startDate: string;
  /** 包络：max(member.endDate) */
  endDate: string;
  /** 成员区间并集（重叠与"相邻一天"都合并）；相邻两段之间即折叠条上的浅色间隙 */
  segments: TrackSegment[];
}

export interface TrackIndex {
  /** 按 (goalId, head.order, headId) 升序，保证与输入顺序无关 */
  tracks: Track[];
  byId: Record<string, Track>;
  /** 仅成员任务入表 */
  trackIdByTask: Record<string, string>;
  /** 按 head.order 升序 */
  tracksByGoal: Record<string, Track[]>;
}

const EMPTY_INDEX: TrackIndex = { tracks: [], byId: {}, trackIdByTask: {}, tracksByGoal: {} };

/** (startDate, order, id) 三级比较 —— head 选取与成员排序共用 */
function byStartOrderId(a: Task, b: Task): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 成员区间并集；members 须已按 startDate 升序 */
function mergeSegments(members: Task[]): TrackSegment[] {
  const out: TrackSegment[] = [];
  for (const t of members) {
    const last = out[out.length - 1];
    // 隔 0 天（重叠/接续）或 1 天都算连续，避免出现 0 宽间隙
    if (last && diffDays(t.startDate, last.endDate) <= 1) {
      if (t.endDate > last.endDate) last.endDate = t.endDate;
    } else {
      out.push({ startDate: t.startDate, endDate: t.endDate });
    }
  }
  return out;
}

/**
 * 从任务集合派生全部轨道。
 * 只按 `${goalId}::${trackId}` 分组 —— 跨 goal 的同名 trackId 各自成组，
 * 因为轨道是泳道内的行布局单位，无法跨泳道用一行表示。
 * 组内只剩 1 个成员时不成轨道，该任务退回普通行。
 */
export function buildTracks(tasks: Task[]): TrackIndex {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.trackId || t.deletedAt) continue;
    const key = `${t.goalId}::${t.trackId}`;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }
  if (groups.size === 0) return EMPTY_INDEX;

  const tracks: Track[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(byStartOrderId);
    const head = sorted[0];
    let endDate = sorted[0].endDate;
    for (const t of sorted) if (t.endDate > endDate) endDate = t.endDate;
    tracks.push({
      id: head.trackId as string,
      goalId: head.goalId,
      name: head.name,
      headId: head.id,
      memberIds: sorted.map((t) => t.id),
      startDate: sorted[0].startDate,
      endDate,
      segments: mergeSegments(sorted),
    });
  }
  if (tracks.length === 0) return EMPTY_INDEX;

  const orderOf = new Map(tasks.map((t) => [t.id, t.order]));
  const headOrder = (tr: Track) => orderOf.get(tr.headId) ?? 0;
  tracks.sort((a, b) => {
    if (a.goalId !== b.goalId) return a.goalId < b.goalId ? -1 : 1;
    const d = headOrder(a) - headOrder(b);
    return d !== 0 ? d : a.headId < b.headId ? -1 : 1;
  });

  const byId: Record<string, Track> = {};
  const trackIdByTask: Record<string, string> = {};
  const tracksByGoal: Record<string, Track[]> = {};
  for (const tr of tracks) {
    byId[tr.id] = tr;
    for (const id of tr.memberIds) trackIdByTask[id] = tr.id;
    (tracksByGoal[tr.goalId] ??= []).push(tr); // tracks 已排好序，push 即有序
  }
  return { tracks, byId, trackIdByTask, tracksByGoal };
}

/** 按跨度天数加权的聚合进度（0-100，四舍五入）。progressOf 由调用方注入（含 auto 模式） */
export function aggregateTrackProgress(
  members: Task[],
  progressOf: (id: string) => number,
): number {
  let weighted = 0;
  let days = 0;
  for (const t of members) {
    const d = diffDays(t.endDate, t.startDate) + 1;
    weighted += progressOf(t.id) * d;
    days += d;
  }
  return days > 0 ? Math.round(weighted / days) : 0;
}

/** 折叠条上点某一天 → 该天所在的成员任务（重叠时取开始最早者，即 memberIds 序） */
export function memberAtDate(
  track: Track,
  tasks: Record<string, Task>,
  date: string,
): string | undefined {
  for (const id of track.memberIds) {
    const t = tasks[id];
    if (t && t.startDate <= date && date <= t.endDate) return id;
  }
  return undefined;
}
