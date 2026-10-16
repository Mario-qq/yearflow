/**
 * 工作台写操作入口（UI 只调这里）。每个函数：取 state → deskPlan 算 Change[] → execute 进 undo 栈。
 * 单独成文件而不塞进 actions.ts：那边已经 766 行、横跨 8 个领域（项目地图 store 体检结论）。
 */
import { nanoid } from 'nanoid';
import type { Routine, RoutineRule, Urgency, WorkItem, WorkScope } from '../types/domain';
import { todayStr } from '../lib/date';
import { moveTarget, type MoveHow } from '../lib/derive/desk';
import type { QuickAddResult } from '../lib/desk/parseQuickAdd';
import {
  planDeleteRoutine,
  planMarkPersonSaid,
  planMove,
  planPatchItems,
  planPatchRoutine,
  planSetDayMark,
  planSkipOccurrence,
  planToggleItem,
  planToggleOccurrence,
  type DeskKey,
} from './deskPlan';
import { useStore } from './useStore';

const nowIso = () => new Date().toISOString();
/** 新建排在最后：时间戳单调递增，免去扫描最大 order */
const nextOrder = () => Date.now();

const URGENCY_LABEL: Record<Urgency, string> = { urgent: '紧急', soon: '尽快', normal: '普通' };

// ── 新建 ─────────────────────────────────────────────────────────────────

export interface NewItemInput {
  kind: WorkItem['kind'];
  title: string;
  urgency?: Urgency;
  scope?: WorkScope;
  date: string | null;
  dueDate?: string;
  person?: string;
  mode?: WorkItem['mode'];
  goalId?: string;
  note?: string;
}

export function createItem(input: NewItemInput): string {
  const stamp = nowIso();
  const item: WorkItem = {
    id: nanoid(),
    kind: input.kind,
    title: input.title.trim(),
    urgency: input.urgency ?? 'normal',
    scope: input.scope ?? 'work',
    status: 'open',
    order: nextOrder(),
    createdAt: stamp,
    updatedAt: stamp,
    ...(input.date ? { date: input.date } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.kind === 'followup' && input.person ? { person: input.person, mode: input.mode ?? 'inform' } : {}),
    ...(input.goalId ? { goalId: input.goalId } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  useStore.getState().execute(`新建「${item.title}」`, [{ table: 'workItems', type: 'put', after: item }]);
  return item.id;
}

export interface NewRoutineInput {
  title: string;
  rule: RoutineRule;
  scope?: WorkScope;
  time?: string;
  startDate?: string;
  note?: string;
}

export function createRoutine(input: NewRoutineInput): string {
  const stamp = nowIso();
  const r: Routine = {
    id: nanoid(),
    title: input.title.trim(),
    scope: input.scope ?? 'work',
    rule: input.rule,
    startDate: input.startDate ?? todayStr(),
    order: nextOrder(),
    createdAt: stamp,
    updatedAt: stamp,
    ...(input.time ? { time: input.time } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  useStore.getState().execute(`新建例行「${r.title}」`, [{ table: 'routines', type: 'put', after: r }]);
  return r.id;
}

/** 一句话新建的落地：例行建 Routine，其余建 WorkItem。返回新 id */
export function createFromQuickAdd(r: QuickAddResult): string {
  if (r.kind === 'routine' && r.rule) return createRoutine({ title: r.title, rule: r.rule, scope: r.scope });
  return createItem({
    kind: r.kind === 'followup' ? 'followup' : 'todo',
    title: r.title,
    urgency: r.urgency,
    scope: r.scope,
    date: r.date,
    dueDate: r.dueDate,
    person: r.person,
    mode: r.mode,
    goalId: r.goalId,
  });
}

// ── 事项 ─────────────────────────────────────────────────────────────────

export function toggleItem(id: string): void {
  const s = useStore.getState();
  const before = s.workItems[id];
  if (!before) return;
  s.execute(before.status === 'open' ? `完成「${before.title}」` : `恢复「${before.title}」`, planToggleItem(s, id, nowIso()));
}

export function patchItem(id: string, patch: Partial<WorkItem>, label: string): void {
  const s = useStore.getState();
  s.execute(label, planPatchItems(s, [id], patch, nowIso()));
}

export function setUrgency(ids: string[], urgency: Urgency): void {
  const s = useStore.getState();
  s.execute(`紧急度改为${URGENCY_LABEL[urgency]}：${ids.length} 件`, planPatchItems(s, ids, { urgency }, nowIso()));
}

export function completeItems(ids: string[]): void {
  const s = useStore.getState();
  s.execute(`完成 ${ids.length} 件`, planPatchItems(s, ids, { status: 'done' }, nowIso()));
}

/** 「不做了」：与完成分开计数，仍可在已完成折叠里找回 */
export function dropItems(ids: string[]): void {
  const s = useStore.getState();
  s.execute(`不做了：${ids.length} 件`, planPatchItems(s, ids, { status: 'dropped' }, nowIso()));
}

export function deleteItem(id: string): void {
  const s = useStore.getState();
  const before = s.workItems[id];
  if (before) s.execute(`删除「${before.title}」`, [{ table: 'workItems', type: 'delete', before }]);
}

export function markPersonSaid(person: string): void {
  const s = useStore.getState();
  s.execute(`${person} 的跟进全部标为已说`, planMarkPersonSaid(s, person, nowIso()));
}

// ── 挪动 ─────────────────────────────────────────────────────────────────

/** 一次挪动 = 一条撤销记录。返回 pastDue（挪到截止日之后的件数，UI 提示用）与实际挪动数 */
export function moveKeys(keys: DeskKey[], to: MoveHow | string | null): { moved: number; pastDue: number } {
  const s = useStore.getState();
  const today = todayStr();
  const isHow = to === 'tomorrow' || to === 'nextMonday' || to === 'sameDayNextWeek';
  const target = (k: DeskKey): string | null => {
    if (!isHow) return to;
    const from = k.type === 'item' ? s.workItems[k.id]?.date : (s.routineLogs[`${k.routineId}:${k.origDate}`]?.movedTo ?? k.origDate);
    return moveTarget(to, from, today);
  };
  const { changes, pastDue, moved } = planMove(s, keys, target, nowIso());
  const label = to === null ? `放进待处理：${moved} 件` : isHow ? `${{ tomorrow: '挪到明天', nextMonday: '挪到下周一', sameDayNextWeek: '挪到下周同一天' }[to]}：${moved} 件` : `挪到 ${to.slice(5).replace('-', '/')}：${moved} 件`;
  s.execute(label, changes);
  return { moved, pastDue };
}

// ── 例行 ─────────────────────────────────────────────────────────────────

export function toggleOccurrence(routineId: string, origDate: string, onDate: string): void {
  const s = useStore.getState();
  const r = s.routines[routineId];
  s.execute(`例行「${r?.title ?? ''}」`, planToggleOccurrence(s, routineId, origDate, onDate, nowIso()));
}

export function skipOccurrence(routineId: string, origDate: string): void {
  const s = useStore.getState();
  const r = s.routines[routineId];
  s.execute(`跳过「${r?.title ?? ''}」这一次`, planSkipOccurrence(s, routineId, origDate, nowIso()));
}

export function patchRoutine(id: string, patch: Partial<Routine>, label: string): void {
  const s = useStore.getState();
  s.execute(label, planPatchRoutine(s, id, patch, nowIso()));
}

export function deleteRoutine(id: string): void {
  const s = useStore.getState();
  const r = s.routines[id];
  if (r) s.execute(`删除例行「${r.title}」`, planDeleteRoutine(s, id));
}

/** 标为休息日 / 补班日；null = 清除 */
export function setDayMark(date: string, type: 'off' | 'work' | null): void {
  const s = useStore.getState();
  const label = type === null ? '清除休/班标记' : type === 'off' ? '标为休息日' : '标为补班日';
  s.execute(label, planSetDayMark(s, date, type, nowIso()));
}
