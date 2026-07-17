/**
 * 实体 mutation 助手 —— Phase 3 起所有 UI 写入的唯一入口。
 * 每个函数组装 Change[] 后走 store.execute（进 undo 栈 + 防抖落库）。
 * 铁律：只构造受影响实体的新对象，未动实体保持引用（per-goal 派生缓存依赖此约定）。
 */
import { nanoid } from 'nanoid';
import type {
  CheckIn,
  CheckInStatus,
  ExemptionPeriod,
  Goal,
  Milestone,
  MonthlyReview,
  Task,
} from '../types/domain';
import { diffDays, eachDay, fmtDay, toDay, todayStr } from '../lib/date';
import { dayEntries } from '../lib/derive';
import { useStore } from './useStore';
import type { Change } from './types';

const nowIso = () => new Date().toISOString();

// ── 更新 ─────────────────────────────────────────────────────────────────

export function patchTask(id: string, patch: Partial<Task>, label: string): void {
  const s = useStore.getState();
  const before = s.tasks[id];
  if (!before) return;
  const after: Task = { ...before, ...patch, updatedAt: nowIso() };
  s.execute(label, [{ table: 'tasks', type: 'put', before, after }]);
}

/** 批量任务更新（多选批量操作），一条命令一次 undo */
export function patchTasks(items: { id: string; patch: Partial<Task> }[], label: string): void {
  const s = useStore.getState();
  const stamp = nowIso();
  const changes: Change[] = [];
  for (const { id, patch } of items) {
    const before = s.tasks[id];
    if (!before) continue;
    changes.push({ table: 'tasks', type: 'put', before, after: { ...before, ...patch, updatedAt: stamp } });
  }
  s.execute(label, changes);
}

export function patchGoal(id: string, patch: Partial<Goal>, label: string): void {
  const s = useStore.getState();
  const before = s.goals[id];
  if (!before) return;
  const after: Goal = { ...before, ...patch, updatedAt: nowIso() };
  s.execute(label, [{ table: 'goals', type: 'put', before, after }]);
}

export function patchMilestone(id: string, patch: Partial<Milestone>, label: string): void {
  const s = useStore.getState();
  const before = s.milestones[id];
  if (!before) return;
  const after: Milestone = { ...before, ...patch, updatedAt: nowIso() };
  s.execute(label, [{ table: 'milestones', type: 'put', before, after }]);
}

// ── 新建 ─────────────────────────────────────────────────────────────────

/** 新建目标：色板轮转取色、排在末尾；返回新 id（调用方随即打开行内改名） */
export function createGoal(name = '新目标'): string {
  const s = useStore.getState();
  const active = Object.values(s.goals).filter((g) => !g.deletedAt && !g.archived);
  const goal: Goal = {
    id: nanoid(),
    name,
    color: `goal-${(active.length % 5) + 1}`,
    icon: '🎯',
    order: active.reduce((m, g) => Math.max(m, g.order), -1) + 1,
    archived: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  s.execute(`新建目标「${name}」`, [{ table: 'goals', type: 'put', after: goal }]);
  return goal.id;
}

export interface CreateTaskInit {
  goalId: string;
  name?: string;
  startDate: string;
  endDate: string;
}

/** 新建任务：排在目标末尾，默认 planned + auto 进度；返回新 id */
export function createTask(init: CreateTaskInit): string {
  const s = useStore.getState();
  const siblings = Object.values(s.tasks).filter((t) => !t.deletedAt && t.goalId === init.goalId);
  const task: Task = {
    id: nanoid(),
    goalId: init.goalId,
    name: init.name ?? '新任务',
    startDate: init.startDate,
    endDate: init.endDate,
    progress: 0,
    progressMode: 'auto',
    status: 'planned',
    order: siblings.reduce((m, t) => Math.max(m, t.order), -1) + 1,
    updatedAt: nowIso(),
  };
  s.execute(`新建任务「${task.name}」`, [{ table: 'tasks', type: 'put', after: task }]);
  return task.id;
}

export function createMilestone(goalId: string, date: string, name = '新里程碑'): string {
  const s = useStore.getState();
  const ms: Milestone = { id: nanoid(), goalId, name, date, achieved: false, updatedAt: nowIso() };
  s.execute(`新建里程碑「${name}」`, [{ table: 'milestones', type: 'put', after: ms }]);
  return ms.id;
}

export function createExemption(
  startDate: string,
  endDate: string,
  reason?: string,
  goalIds?: string[],
): string {
  const s = useStore.getState();
  const ex: ExemptionPeriod = { id: nanoid(), startDate, endDate, reason, goalIds, updatedAt: nowIso() };
  s.execute('添加免打卡区间', [{ table: 'exemptions', type: 'put', after: ex }]);
  return ex.id;
}

export function updateExemption(id: string, patch: Partial<ExemptionPeriod>): void {
  const s = useStore.getState();
  const before = s.exemptions[id];
  if (!before) return;
  const after: ExemptionPeriod = { ...before, ...patch, updatedAt: nowIso() };
  s.execute('更新免打卡区间', [{ table: 'exemptions', type: 'put', before, after }]);
}

export function deleteExemption(id: string): void {
  const s = useStore.getState();
  const ex = s.exemptions[id];
  if (!ex) return;
  s.execute(`删除免打卡区间${ex.reason ? `「${ex.reason}」` : ''}`, [
    { table: 'exemptions', type: 'delete', before: ex },
  ]);
}

// ── 打卡（Phase 4：今日面板 / 甘特 popover / 批量补卡共用） ──────────────

const CHECKIN_TEXT: Record<CheckInStatus, string> = {
  done: '完成',
  partial: '做了一点',
  skipped: '跳过',
};

/** 某目标某日的现有打卡记录（同日多条取"最强"，与派生口径一致） */
export function findCheckIn(goalId: string, date: string): CheckIn | undefined {
  const rank: Record<CheckInStatus, number> = { done: 3, partial: 2, skipped: 1 };
  let best: CheckIn | undefined;
  for (const c of Object.values(useStore.getState().checkIns)) {
    if (c.deletedAt || c.goalId !== goalId || c.date !== date) continue;
    if (!best || rank[c.status] > rank[best.status]) best = c;
  }
  return best;
}

export interface SetCheckInArgs {
  goalId: string;
  date: string;
  status: CheckInStatus;
  taskId?: string;
  minutes?: number;
  note?: string;
}

/** 打卡 upsert：同目标同日已有记录则原位更新（保 id/createdAt），否则新建；一条命令 */
export function setCheckIn(args: SetCheckInArgs): string {
  const s = useStore.getState();
  const goalName = s.goals[args.goalId]?.name ?? '';
  const existing = findCheckIn(args.goalId, args.date);
  const label = `打卡「${goalName}」${CHECKIN_TEXT[args.status]}`;
  if (existing) {
    const after: CheckIn = {
      ...existing,
      status: args.status,
      taskId: args.taskId ?? existing.taskId,
      minutes: args.minutes ?? existing.minutes,
      note: args.note ?? existing.note,
      updatedAt: nowIso(),
    };
    s.execute(label, [{ table: 'checkIns', type: 'put', before: existing, after }]);
    return existing.id;
  }
  const record: CheckIn = {
    id: nanoid(),
    goalId: args.goalId,
    taskId: args.taskId,
    date: args.date,
    status: args.status,
    minutes: args.minutes,
    note: args.note,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  s.execute(label, [{ table: 'checkIns', type: 'put', after: record }]);
  return record.id;
}

/** 更新打卡附加信息（分钟/备注），不改状态 */
export function patchCheckIn(id: string, patch: Partial<CheckIn>, label: string): void {
  const s = useStore.getState();
  const before = s.checkIns[id];
  if (!before) return;
  const after: CheckIn = { ...before, ...patch, updatedAt: nowIso() };
  s.execute(label, [{ table: 'checkIns', type: 'put', before, after }]);
}

export interface BatchCheckInArgs {
  startDate: string;
  endDate: string;
  goalIds: string[];
  status: 'done' | 'skipped';
}

/**
 * 批量补卡（SPEC 第六节）：日期范围 × 勾选目标 → 批量标 done/skipped。
 * 只补"应打卡且尚无记录"的日子（免打卡区间与已有记录跳过），一条命令一次 undo。
 * 返回补卡条数（调用方 toast 用）。dryRun 时只计数不写入（对话框实时预览）。
 */
export function batchCheckIn(args: BatchCheckInArgs, dryRun = false): number {
  const s = useStore.getState();
  const today = todayStr();
  const end = args.endDate < today ? args.endDate : today;
  if (end < args.startDate || args.goalIds.length === 0) return 0;

  const goalList = Object.values(s.goals);
  const taskList = Object.values(s.tasks);
  const checkInList = Object.values(s.checkIns);
  const exemptionList = Object.values(s.exemptions);
  const wanted = new Set(args.goalIds);

  const stamp = nowIso();
  const changes: Change[] = [];
  for (const date of eachDay(args.startDate, end)) {
    for (const entry of dayEntries({ date, goals: goalList, tasks: taskList, checkIns: checkInList, exemptions: exemptionList })) {
      if (!wanted.has(entry.goalId) || entry.exempt || entry.status) continue;
      changes.push({
        table: 'checkIns',
        type: 'put',
        after: {
          id: nanoid(),
          goalId: entry.goalId,
          taskId: entry.dueTaskIds.length === 1 ? entry.dueTaskIds[0] : undefined,
          date,
          status: args.status,
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
    }
  }
  if (!dryRun && changes.length > 0) {
    s.execute(`批量补卡 ${changes.length} 条（${args.status === 'done' ? '完成' : '跳过'}）`, changes);
  }
  return changes.length;
}

/** 删除打卡记录（软删除，回到"未打卡"） */
export function removeCheckIn(id: string): void {
  const s = useStore.getState();
  const record = s.checkIns[id];
  if (!record) return;
  const goalName = s.goals[record.goalId]?.name ?? '';
  s.execute(`删除「${goalName}」${record.date} 的打卡记录`, [
    { table: 'checkIns', type: 'delete', before: record },
  ]);
}

// ── 月度复盘（Phase 4：笔记与星评自动保存，调用方防抖） ──────────────────

/** 复盘 upsert：按 month 找现有记录原位更新，否则新建；一条命令 */
export function saveReview(month: string, patch: { content?: string; rating?: number }): void {
  const s = useStore.getState();
  const existing = Object.values(s.reviews).find((r) => !r.deletedAt && r.month === month);
  const label = `保存 ${month} 复盘`;
  if (existing) {
    const after: MonthlyReview = { ...existing, ...patch, updatedAt: nowIso() };
    if (after.content === existing.content && after.rating === existing.rating) return;
    s.execute(label, [{ table: 'reviews', type: 'put', before: existing, after }]);
    return;
  }
  const review: MonthlyReview = {
    id: nanoid(),
    month,
    content: patch.content ?? '',
    rating: patch.rating,
    updatedAt: nowIso(),
  };
  s.execute(label, [{ table: 'reviews', type: 'put', after: review }]);
}

// ── 复合操作（右键菜单/批量操作条） ──────────────────────────────────────

const shiftDate = (date: string, days: number): string => fmtDay(toDay(date).add(days, 'day'));

/** 批量整体平移 N 天（多选操作条） */
export function shiftTasks(ids: string[], days: number): void {
  const s = useStore.getState();
  const stamp = nowIso();
  const changes: Change[] = [];
  for (const id of ids) {
    const before = s.tasks[id];
    if (!before) continue;
    changes.push({
      table: 'tasks',
      type: 'put',
      before,
      after: {
        ...before,
        startDate: shiftDate(before.startDate, days),
        endDate: shiftDate(before.endDate, days),
        updatedAt: stamp,
      },
    });
  }
  s.execute(`平移 ${ids.length} 个任务 ${days > 0 ? '+' : ''}${days}天`, changes);
}

/** 复制并顺延：生成紧接原任务之后的同长任务（SPEC 第六节） */
export function duplicateTaskAfter(id: string): string | null {
  const s = useStore.getState();
  const src = s.tasks[id];
  if (!src) return null;
  const duration = diffDays(src.endDate, src.startDate);
  const start = shiftDate(src.endDate, 1);
  const siblings = Object.values(s.tasks).filter((t) => !t.deletedAt && t.goalId === src.goalId);
  const copy: Task = {
    ...src,
    id: nanoid(),
    name: `${src.name}（续）`,
    startDate: start,
    endDate: shiftDate(start, duration),
    progress: 0,
    status: 'planned',
    baseline: undefined,
    dependsOn: [src.id], // 顺延任务默认 FS 依赖原任务
    order: siblings.reduce((m, t) => Math.max(m, t.order), -1) + 1,
    updatedAt: nowIso(),
  };
  s.execute(`复制并顺延「${src.name}」`, [{ table: 'tasks', type: 'put', after: copy }]);
  return copy.id;
}

/** 从某日拆分：原任务截止到 date 前一天，新任务接管 date..原结束（一条命令） */
export function splitTaskAt(id: string, date: string): string | null {
  const s = useStore.getState();
  const src = s.tasks[id];
  if (!src || date <= src.startDate || date > src.endDate) return null;
  const stamp = nowIso();
  const shortened: Task = { ...src, endDate: shiftDate(date, -1), updatedAt: stamp };
  const siblings = Object.values(s.tasks).filter((t) => !t.deletedAt && t.goalId === src.goalId);
  const rest: Task = {
    ...src,
    id: nanoid(),
    name: `${src.name}（后段）`,
    startDate: date,
    progress: 0,
    baseline: undefined,
    dependsOn: [src.id],
    order: siblings.reduce((m, t) => Math.max(m, t.order), -1) + 1,
    updatedAt: stamp,
  };
  s.execute(`拆分任务「${src.name}」`, [
    { table: 'tasks', type: 'put', before: src, after: shortened },
    { table: 'tasks', type: 'put', after: rest },
  ]);
  return rest.id;
}

// ── 依赖与基线 ───────────────────────────────────────────────────────────

/** 建立 FS 依赖：succ.dependsOn += pred（去重、防自依赖） */
export function addDependency(predId: string, succId: string): void {
  const s = useStore.getState();
  const pred = s.tasks[predId];
  const succ = s.tasks[succId];
  if (!pred || !succ || predId === succId) return;
  const deps = succ.dependsOn ?? [];
  if (deps.includes(predId)) return;
  patchTask(succId, { dependsOn: [...deps, predId] }, `添加依赖「${pred.name}」→「${succ.name}」`);
}

/** 删除依赖连线 */
export function removeDependency(succId: string, predId: string): void {
  const s = useStore.getState();
  const succ = s.tasks[succId];
  if (!succ?.dependsOn?.includes(predId)) return;
  const predName = s.tasks[predId]?.name ?? '';
  patchTask(
    succId,
    { dependsOn: succ.dependsOn.filter((id) => id !== predId) },
    `删除依赖「${predName}」→「${succ.name}」`,
  );
}

/** 顶栏「保存基线」：把当前全部活动任务的起止快照进 baseline（一条命令） */
export function saveBaselineAll(): number {
  const s = useStore.getState();
  const stamp = nowIso();
  const changes: Change[] = [];
  for (const t of Object.values(s.tasks)) {
    if (t.deletedAt) continue;
    changes.push({
      table: 'tasks',
      type: 'put',
      before: t,
      after: { ...t, baseline: { startDate: t.startDate, endDate: t.endDate }, updatedAt: stamp },
    });
  }
  s.execute(`保存基线（${changes.length} 个任务）`, changes);
  return changes.length;
}

// ── 删除（软删除，级联进同一条命令） ─────────────────────────────────────

/** 删除任务：级联软删指向该任务的打卡记录 */
export function deleteTask(id: string): void {
  const s = useStore.getState();
  const task = s.tasks[id];
  if (!task) return;
  const changes: Change[] = [{ table: 'tasks', type: 'delete', before: task }];
  for (const c of Object.values(s.checkIns)) {
    if (!c.deletedAt && c.taskId === id) changes.push({ table: 'checkIns', type: 'delete', before: c });
  }
  s.execute(`删除任务「${task.name}」`, changes);
}

/** 批量删除任务（多选），一条命令 */
export function deleteTasks(ids: string[]): void {
  const s = useStore.getState();
  const changes: Change[] = [];
  for (const id of ids) {
    const task = s.tasks[id];
    if (!task) continue;
    changes.push({ table: 'tasks', type: 'delete', before: task });
    for (const c of Object.values(s.checkIns)) {
      if (!c.deletedAt && c.taskId === id) changes.push({ table: 'checkIns', type: 'delete', before: c });
    }
  }
  s.execute(`删除 ${ids.length} 个任务`, changes);
}

/** 删除目标：级联软删其任务、里程碑与全部打卡记录（调用方先弹确认并说清后果） */
export function deleteGoal(id: string): void {
  const s = useStore.getState();
  const goal = s.goals[id];
  if (!goal) return;
  const changes: Change[] = [{ table: 'goals', type: 'delete', before: goal }];
  for (const t of Object.values(s.tasks)) {
    if (!t.deletedAt && t.goalId === id) changes.push({ table: 'tasks', type: 'delete', before: t });
  }
  for (const m of Object.values(s.milestones)) {
    if (!m.deletedAt && m.goalId === id) changes.push({ table: 'milestones', type: 'delete', before: m });
  }
  for (const c of Object.values(s.checkIns)) {
    if (!c.deletedAt && c.goalId === id) changes.push({ table: 'checkIns', type: 'delete', before: c });
  }
  s.execute(`删除目标「${goal.name}」`, changes);
}

export function deleteMilestone(id: string): void {
  const s = useStore.getState();
  const ms = s.milestones[id];
  if (!ms) return;
  s.execute(`删除里程碑「${ms.name}」`, [{ table: 'milestones', type: 'delete', before: ms }]);
}
