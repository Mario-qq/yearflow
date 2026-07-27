/**
 * 行布局（纯函数，vitest 覆盖）——左侧网格与时间轴行对齐的唯一来源。
 * 两侧同时消费同一份 rows 数组；行虚拟化、y→行命中（跨泳道拖拽）都以此为准。
 * ghost 行 = 每个展开目标分组末尾的「+ 添加任务」矮行（空间常驻，内容 hover 才显示）。
 */
import type { Goal, Task } from '../types/domain';
import type { TrackIndex } from '../lib/derive/tracks';
import { ROW_H_GHOST, ROW_H_GOAL, ROW_H_TASK, ROW_H_TRACK } from './constants';

/** track 行的 id 前缀 —— 避开与头任务的 task 行 id 撞键 */
export const trackRowId = (trackId: string) => `track:${trackId}`;

export interface GanttRow {
  kind: 'goal' | 'track' | 'task' | 'ghost';
  id: string;
  goalId: string; // goal 行 = 自身 id；track/ghost 行 = 所属目标 id
  top: number;
  height: number;
  /** task 行：0 = 直属目标，1 = 轨道成员（留 number 以便将来多级） */
  depth?: number;
  /** track 行 = 自身 trackId；成员 task 行 = 所属 trackId */
  trackId?: string;
  memberCount?: number; // 仅 track 行
}

export interface RowLayout {
  rows: GanttRow[];
  totalHeight: number;
  rowById: Record<string, GanttRow>;
  /** goalId → 该目标的任务行（折叠时为空数组，含轨道成员行），汇总条/聚合热度条用 */
  taskRowsByGoal: Record<string, GanttRow[]>;
  /** trackId → track 行；依赖线端点上浮用 */
  trackRowByTrackId: Record<string, GanttRow>;
  /** goalId → 顶层排序单元的行（非成员任务行 + track 行）；左栏重排落点解析用 */
  unitRowsByGoal: Record<string, GanttRow[]>;
  /** trackId → 展开后的成员任务行（折叠时为空数组） */
  memberRowsByTrack: Record<string, GanttRow[]>;
}

export interface RowLayoutOptions {
  trackIndex?: TrackIndex;
  /** 轨道默认折叠，故传"已展开"的集合；缺省 = 全部折叠 */
  expandedTrackIds?: string[];
}

/**
 * opts 缺省时行为与未引入轨道前逐字节一致（不产生 track 行、depth 为 0），
 * 这是既有 rowLayout 测试与调用方的回归护栏。
 */
export function buildRowLayout(
  goals: Record<string, Goal>,
  tasks: Record<string, Task>,
  collapsedGoalIds: string[],
  opts?: RowLayoutOptions,
): RowLayout {
  const trackIndex = opts?.trackIndex;
  const expanded = new Set(opts?.expandedTrackIds ?? []);
  const collapsed = new Set(collapsedGoalIds);
  const goalList = Object.values(goals)
    .filter((g) => !g.archived && !g.deletedAt)
    .sort((a, b) => a.order - b.order);
  const tasksByGoal = new Map<string, Task[]>();
  for (const t of Object.values(tasks)) {
    if (t.deletedAt) continue;
    const list = tasksByGoal.get(t.goalId);
    if (list) list.push(t);
    else tasksByGoal.set(t.goalId, [t]);
  }

  const rows: GanttRow[] = [];
  const rowById: Record<string, GanttRow> = {};
  const taskRowsByGoal: Record<string, GanttRow[]> = {};
  const trackRowByTrackId: Record<string, GanttRow> = {};
  const unitRowsByGoal: Record<string, GanttRow[]> = {};
  const memberRowsByTrack: Record<string, GanttRow[]> = {};
  let top = 0;
  for (const goal of goalList) {
    const goalRow: GanttRow = { kind: 'goal', id: goal.id, goalId: goal.id, top, height: ROW_H_GOAL };
    rows.push(goalRow);
    rowById[goal.id] = goalRow;
    taskRowsByGoal[goal.id] = [];
    unitRowsByGoal[goal.id] = [];
    top += ROW_H_GOAL;
    if (collapsed.has(goal.id)) continue;
    const goalTasks = (tasksByGoal.get(goal.id) ?? []).sort((a, b) => a.order - b.order);

    const pushTask = (task: Task, depth: number, trackId?: string) => {
      const row: GanttRow = { kind: 'task', id: task.id, goalId: goal.id, top, height: ROW_H_TASK };
      if (depth > 0) {
        row.depth = depth;
        row.trackId = trackId;
      }
      rows.push(row);
      rowById[task.id] = row;
      taskRowsByGoal[goal.id].push(row);
      top += ROW_H_TASK;
      return row;
    };

    // 排序单元：每条轨道一个（键 = 头任务 order），每个非成员任务一个（键 = 自身 order）。
    // 轨道整块参与泳道内排序，成员在轨道内部按开始日排列。
    const goalTracks = trackIndex?.tracksByGoal[goal.id] ?? [];
    if (goalTracks.length === 0) {
      for (const task of goalTasks) unitRowsByGoal[goal.id].push(pushTask(task, 0));
    } else {
      const trackOfTask = trackIndex!.trackIdByTask;
      const headOrder = new Map(
        goalTracks.map((tr) => [tr.id, tasks[tr.headId]?.order ?? 0] as const),
      );
      type Unit = { key: number; task?: Task; trackId?: string };
      const units: Unit[] = [];
      for (const task of goalTasks) {
        if (!trackOfTask[task.id]) units.push({ key: task.order, task });
      }
      for (const tr of goalTracks) units.push({ key: headOrder.get(tr.id) ?? 0, trackId: tr.id });
      units.sort((a, b) => a.key - b.key);

      for (const unit of units) {
        if (unit.task) {
          unitRowsByGoal[goal.id].push(pushTask(unit.task, 0));
          continue;
        }
        const tr = trackIndex!.byId[unit.trackId!];
        const trackRow: GanttRow = {
          kind: 'track',
          id: trackRowId(tr.id),
          goalId: goal.id,
          top,
          height: ROW_H_TRACK,
          trackId: tr.id,
          memberCount: tr.memberIds.length,
        };
        rows.push(trackRow);
        rowById[trackRow.id] = trackRow;
        trackRowByTrackId[tr.id] = trackRow;
        unitRowsByGoal[goal.id].push(trackRow);
        memberRowsByTrack[tr.id] = [];
        top += ROW_H_TRACK;
        if (!expanded.has(tr.id)) continue;
        for (const id of tr.memberIds) {
          const member = tasks[id];
          if (member) memberRowsByTrack[tr.id].push(pushTask(member, 1, tr.id));
        }
      }
    }

    const ghost: GanttRow = { kind: 'ghost', id: `ghost-${goal.id}`, goalId: goal.id, top, height: ROW_H_GHOST };
    rows.push(ghost);
    rowById[ghost.id] = ghost;
    top += ROW_H_GHOST;
  }
  return {
    rows,
    totalHeight: top,
    rowById,
    taskRowsByGoal,
    trackRowByTrackId,
    unitRowsByGoal,
    memberRowsByTrack,
  };
}

/** body y 坐标 → 命中行（二分；越界返回 null） */
export function rowAtY(layout: RowLayout, y: number): GanttRow | null {
  const { rows } = layout;
  if (y < 0 || rows.length === 0 || y >= layout.totalHeight) return null;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top + rows[mid].height <= y) lo = mid + 1;
    else hi = mid;
  }
  return rows[lo];
}

/** 可视 y 范围 → 可视行下标闭区间（虚拟化用） */
export function visibleRowRange(layout: RowLayout, yStart: number, yEnd: number): [number, number] {
  const { rows } = layout;
  if (rows.length === 0) return [0, -1];
  let lo = 0;
  while (lo < rows.length - 1 && rows[lo].top + rows[lo].height <= yStart) lo++;
  let hi = lo;
  while (hi < rows.length - 1 && rows[hi + 1].top < yEnd) hi++;
  return [lo, hi];
}
