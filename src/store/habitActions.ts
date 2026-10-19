/**
 * 日常习惯写操作入口（UI 只调这里）：每个函数算 Change[] → execute 进 undo 栈。
 */
import { nanoid } from 'nanoid';
import type { Habit, HabitLog } from '../types/domain';
import { habitLogId } from '../lib/derive/habits';
import type { Change } from './types';
import { useStore } from './useStore';

const nowIso = () => new Date().toISOString();

export type HabitDraft = Omit<Habit, 'id' | 'order' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** 去掉空串字段（落库不留 '' / []，老数据口径一致） */
function clean(d: HabitDraft): HabitDraft {
  return {
    title: d.title.trim(),
    kind: d.kind,
    startDate: d.startDate,
    ...(d.icon?.trim() ? { icon: d.icon.trim() } : {}),
    ...(d.cue?.trim() ? { cue: d.cue.trim() } : {}),
    ...(d.time ? { time: d.time } : {}),
    ...(d.why?.trim() ? { why: d.why.trim() } : {}),
    ...(d.daysOfWeek?.length && d.daysOfWeek.length < 7 ? { daysOfWeek: [...d.daysOfWeek].sort() } : {}),
    ...(d.paused ? { paused: true } : {}),
  };
}

export function createHabit(draft: HabitDraft): string {
  const stamp = nowIso();
  const h: Habit = { ...clean(draft), id: nanoid(), order: Date.now(), createdAt: stamp, updatedAt: stamp };
  useStore.getState().execute(`新建习惯「${h.title}」`, [{ table: 'habits', type: 'put', after: h }]);
  return h.id;
}

export function saveHabit(id: string, draft: HabitDraft): boolean {
  const before = useStore.getState().habits[id];
  if (!before) return false;
  const after: Habit = { id, order: before.order, createdAt: before.createdAt, updatedAt: nowIso(), ...clean(draft) };
  useStore.getState().execute(`修改习惯「${after.title}」`, [{ table: 'habits', type: 'put', before, after }]);
  return true;
}

export function setHabitPaused(id: string, paused: boolean): void {
  const before = useStore.getState().habits[id];
  if (!before) return;
  const { paused: _p, ...rest } = before;
  const after: Habit = { ...rest, ...(paused ? { paused: true } : {}), updatedAt: nowIso() };
  useStore.getState().execute(`${paused ? '暂停' : '恢复'}习惯「${before.title}」`, [{ table: 'habits', type: 'put', before, after }]);
}

/** 删掉习惯（记录留着不删：撤销时原样回来） */
export function deleteHabit(id: string): void {
  const before = useStore.getState().habits[id];
  if (!before) return;
  useStore.getState().execute(`删除习惯「${before.title}」`, [{ table: 'habits', type: 'delete', before }]);
}

/** 拖动排序：按给定顺序重写 order */
export function reorderHabits(ids: string[]): void {
  const { habits } = useStore.getState();
  const changes: Change[] = [];
  ids.forEach((id, n) => {
    const before = habits[id];
    if (before && before.order !== n) changes.push({ table: 'habits', type: 'put', before, after: { ...before, order: n, updatedAt: nowIso() } });
  });
  useStore.getState().execute('调整习惯顺序', changes);
}

/**
 * 记一天：status 与现有记录相同 ⇒ 撤掉（再点一下 = 取消）；否则写成这个状态。
 * 返回写完后这天有没有记录（UI 据此出「已记 / 已撤」的 toast）。
 */
export function toggleHabitLog(habitId: string, date: string, status: HabitLog['status']): boolean {
  const st = useStore.getState();
  const h = st.habits[habitId];
  if (!h) return false;
  const id = habitLogId(habitId, date);
  const before = st.habitLogs[id];
  const what = status === 'done' ? '做了' : '破了一次';
  if (before?.status === status) {
    st.execute(`撤销「${h.title}」${what}`, [{ table: 'habitLogs', type: 'delete', before }]);
    return false;
  }
  const stamp = nowIso();
  const after: HabitLog = { id, habitId, date, status, createdAt: before?.createdAt ?? stamp, updatedAt: stamp };
  st.execute(`「${h.title}」${what}`, [before ? { table: 'habitLogs', type: 'put', before, after } : { table: 'habitLogs', type: 'put', after }]);
  return true;
}
