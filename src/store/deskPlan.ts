/**
 * 工作台写操作的「计划」：给定当前实体，算出要执行的 Change[]。纯函数（不碰 store/Dexie），
 * 单测见 deskPlan.test.ts；deskActions.ts 负责取 state、生成 id/时间戳、走 execute 进 undo 栈。
 * 铁律同 actions.ts：只构造受影响实体的新对象，未动实体保持引用。
 */
import type { DayMark, Routine, RoutineLog, WorkItem } from '../types/domain';
import { isFocusOn, MAX_FOCUS, moveItem, routineLogId } from '../lib/derive/desk';
import type { Change, EntityMaps } from './types';

type DeskState = Pick<EntityMaps, 'workItems' | 'routines' | 'routineLogs' | 'dayMarks'>;

/** 工作台里可以被选中、挪动、勾选的东西：一件事项，或例行的某一次（按原日期定位） */
export type DeskKey = { type: 'item'; id: string } | { type: 'routine'; routineId: string; origDate: string };

const liveLog = (s: DeskState, id: string): RoutineLog | undefined => {
  const l = s.routineLogs[id];
  return l && !l.deletedAt ? l : undefined;
};

// ── 事项 ─────────────────────────────────────────────────────────────────

/** 勾选/取消：done ↔ open；不做了的再勾一次回到 open */
export function planToggleItem(s: DeskState, id: string, stamp: string): Change[] {
  const before = s.workItems[id];
  if (!before) return [];
  const after: WorkItem = { ...before, updatedAt: stamp };
  if (before.status === 'open') {
    after.status = 'done';
    after.doneAt = stamp;
  } else {
    after.status = 'open';
    delete after.doneAt;
  }
  return [{ table: 'workItems', type: 'put', before, after }];
}

export function planPatchItems(s: DeskState, ids: string[], patch: Partial<WorkItem>, stamp: string): Change[] {
  const out: Change[] = [];
  for (const id of ids) {
    const before = s.workItems[id];
    if (!before) continue;
    const after: WorkItem = { ...before, ...patch, updatedAt: stamp };
    // patch 里显式给 undefined = 删掉这个字段（如清除截止日），不留 undefined 键进库/同步
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (after as unknown as Record<string, unknown>)[k];
    if (patch.status === 'done' || patch.status === 'dropped') after.doneAt = stamp;
    if (patch.status === 'open') delete after.doneAt;
    out.push({ table: 'workItems', type: 'put', before, after });
  }
  return out;
}

/**
 * 编辑一件事项（编辑卡「保存」）：一次改多个字段 = 一条撤销记录。
 * - 改成待办 ⇒ 去掉对象与告知/下发；改成跟进却没写对象 ⇒ 仍按待办存（跟进 = 带对象的待办）。
 * - 改排期日走挪动的口径（derive/desk.moveItem）：往后挪 deferCount + 1，往前/进待处理不加。
 * - patch 里显式给 undefined = 删掉这个字段（清除截止日、目标、备注）。
 * 没有任何变化 ⇒ 空数组（不进撤销栈）。
 */
export function planEditItem(s: DeskState, id: string, patch: Partial<WorkItem>, stamp: string): Change[] {
  const before = s.workItems[id];
  if (!before) return [];
  let after: WorkItem = { ...before, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (after as unknown as Record<string, unknown>)[k];
  if ('date' in patch && patch.date !== before.date) {
    const moved = moveItem(before, patch.date ?? null, stamp).item;
    after = { ...after, deferCount: moved.deferCount };
    if (moved.deferCount === undefined) delete after.deferCount;
  }
  if (after.kind === 'followup' && !after.person?.trim()) after.kind = 'todo';
  if (after.kind === 'todo') {
    delete after.person;
    delete after.mode;
  } else {
    after.person = after.person!.trim();
    after.mode = after.mode ?? 'inform';
  }
  after.title = after.title.trim() || before.title;
  const changed = (Object.keys({ ...before, ...after }) as (keyof WorkItem)[]).some((k) => k !== 'updatedAt' && before[k] !== after[k]);
  if (!changed) return [];
  after.updatedAt = stamp;
  return [{ table: 'workItems', type: 'put', before, after }];
}

/**
 * 设为 / 取消 date 那天的要事（date = null ⇒ 取消）。每天最多 MAX_FOCUS 件：
 * 超出的不设，over = 没设上的件数（UI 提示「先移出一件」）。已经是那天要事的跳过、但照样占位。
 */
export function planSetFocus(s: DeskState, ids: string[], date: string | null, stamp: string): { changes: Change[]; over: number } {
  if (date === null) {
    const changes = ids.flatMap((id) => {
      const before = s.workItems[id];
      return before?.focusOn ? planPatchItems(s, [id], { focusOn: undefined }, stamp) : [];
    });
    return { changes, over: 0 };
  }
  // 已经是那天要事的照样占一个位子（下面直接跳过它们，不再占第二次）
  let room = MAX_FOCUS - Object.values(s.workItems).filter((i) => isFocusOn(i, date)).length;
  const changes: Change[] = [];
  let over = 0;
  for (const id of ids) {
    const before = s.workItems[id];
    if (!before || before.focusOn === date) continue;
    if (room <= 0) {
      over++;
      continue;
    }
    room--;
    changes.push(...planPatchItems(s, [id], { focusOn: date }, stamp));
  }
  return { changes, over };
}

/**
 * 在挪动的基础上顺带改范围（拖到某天的「生活」区 = 挪到那天 + 改成生活）。
 * 只改事项（例行的范围属于整条规则，不因挪一次而变）；同一天内拖到另一区 = 只改范围。
 */
export function withScope(s: DeskState, keys: DeskKey[], changes: Change[], scope: WorkItem['scope'], stamp: string): Change[] {
  const out = [...changes];
  for (const k of keys) {
    if (k.type !== 'item') continue;
    const at = out.findIndex((c) => c.table === 'workItems' && c.type === 'put' && c.after.id === k.id);
    const c = out[at];
    if (c && c.table === 'workItems' && c.type === 'put') {
      if (c.after.scope !== scope) out[at] = { ...c, after: { ...c.after, scope } };
      continue;
    }
    const before = s.workItems[k.id];
    if (before && before.scope !== scope) out.push({ table: 'workItems', type: 'put', before, after: { ...before, scope, updatedAt: stamp } });
  }
  return out;
}

/**
 * 在挪动（及改范围）的基础上顺带设 / 移出要事：拖进某天的要事区 = 挪到那天 + 设为那天的要事；
 * 把要事拖到工作/生活区 = 移出要事。只认事项（例行不能当要事）；设上时守每天 MAX_FOCUS 的上限，
 * 被拖的这几件原本就是那天要事的不重复占位。返回合并后的变更与没设上的件数。
 */
export function withFocus(s: DeskState, keys: DeskKey[], changes: Change[], date: string | null, stamp: string): { changes: Change[]; over: number } {
  const out = [...changes];
  const ids = keys.flatMap((k) => (k.type === 'item' && s.workItems[k.id] ? [k.id] : []));
  const dragged = new Set(ids);
  let room = date ? MAX_FOCUS - Object.values(s.workItems).filter((i) => !dragged.has(i.id) && isFocusOn(i, date)).length : 0;
  let over = 0;
  for (const id of ids) {
    const at = out.findIndex((c) => c.table === 'workItems' && c.type === 'put' && c.after.id === id);
    const c = out[at];
    const cur = c && c.table === 'workItems' && c.type === 'put' ? c.after : s.workItems[id];
    let focusOn: string | undefined;
    if (date) {
      if (room <= 0) {
        over++;
        continue;
      }
      room--;
      if (cur.focusOn === date) continue;
      focusOn = date;
    } else if (!cur.focusOn) continue;
    const next: WorkItem = { ...cur, focusOn, updatedAt: stamp };
    if (c && c.table === 'workItems' && c.type === 'put') out[at] = { ...c, after: next };
    else out.push({ table: 'workItems', type: 'put', before: s.workItems[id], after: next });
  }
  return { changes: out, over };
}

/** 某人的未完成跟进全部标为已说（人物卡「全部标为已说」） */
export function planMarkPersonSaid(s: DeskState, person: string, stamp: string): Change[] {
  const ids = Object.values(s.workItems)
    .filter((i) => i.kind === 'followup' && i.person === person && i.status === 'open')
    .map((i) => i.id);
  return planPatchItems(s, ids, { status: 'done' }, stamp);
}

// ── 挪动 ─────────────────────────────────────────────────────────────────

/**
 * 把一组 key 挪到 target(key) 算出的日期（null = 待处理）。一次挪动 = 一条 undo 命令。
 * 事项：只改 date，往后挪 deferCount + 1（derive/desk.moveItem）。
 * 例行：只改这一次 —— 记 RoutineLog{moved, movedTo}；挪回原日 = 删掉这条改期记录；例行不能进待处理。
 * 已完成的例行这一次不挪（挪一件做完的事没有意义，还会丢掉完成记录）。
 */
export function planMove(
  s: DeskState,
  keys: DeskKey[],
  target: (key: DeskKey) => string | null,
  stamp: string,
): { changes: Change[]; pastDue: number; moved: number } {
  const changes: Change[] = [];
  let pastDue = 0;
  for (const key of keys) {
    const to = target(key);
    if (key.type === 'item') {
      const before = s.workItems[key.id];
      if (!before || before.date === (to ?? undefined)) continue;
      const r = moveItem(before, to, stamp);
      if (r.pastDue) pastDue++;
      changes.push({ table: 'workItems', type: 'put', before, after: r.item });
      continue;
    }
    if (to === null) continue;
    const id = routineLogId(key.routineId, key.origDate);
    const before = liveLog(s, id);
    if (before && (before.status === 'done' || before.doneAt)) continue;
    if (to === key.origDate) {
      if (before?.status === 'moved') changes.push({ table: 'routineLogs', type: 'delete', before });
      continue;
    }
    const after: RoutineLog = {
      id,
      routineId: key.routineId,
      date: key.origDate,
      status: 'moved',
      movedTo: to,
      createdAt: before?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    changes.push({ table: 'routineLogs', type: 'put', before, after });
  }
  return { changes, pastDue, moved: changes.length };
}

// ── 例行的一次 ───────────────────────────────────────────────────────────

/**
 * 勾选/取消例行的某一次。onDate = 实际在哪天做的（补做/改期时晚于原日期）。
 * 无记录 → 记 done；done → 删记录（回到未做）；skipped → done；moved → 切换 doneAt（仍是改期记录）。
 */
export function planToggleOccurrence(
  s: DeskState,
  routineId: string,
  origDate: string,
  onDate: string,
  stamp: string,
): Change[] {
  const id = routineLogId(routineId, origDate);
  const before = liveLog(s, id);
  if (before?.status === 'done') return [{ table: 'routineLogs', type: 'delete', before }];
  if (before?.status === 'moved') {
    const after: RoutineLog = { ...before, updatedAt: stamp };
    if (before.doneAt) {
      delete after.doneAt;
      delete after.doneOn;
    } else {
      after.doneAt = stamp;
      after.doneOn = onDate;
    }
    return [{ table: 'routineLogs', type: 'put', before, after }];
  }
  const after: RoutineLog = {
    id,
    routineId,
    date: origDate,
    status: 'done',
    doneAt: stamp,
    doneOn: onDate,
    createdAt: before?.createdAt ?? stamp,
    updatedAt: stamp,
  };
  return [{ table: 'routineLogs', type: 'put', before, after }];
}

/** 这一次有意跳过（与「完成」分开记）；再点一次取消跳过 */
export function planSkipOccurrence(s: DeskState, routineId: string, origDate: string, stamp: string): Change[] {
  const id = routineLogId(routineId, origDate);
  const before = liveLog(s, id);
  if (before?.status === 'skipped') return [{ table: 'routineLogs', type: 'delete', before }];
  const after: RoutineLog = { id, routineId, date: origDate, status: 'skipped', createdAt: before?.createdAt ?? stamp, updatedAt: stamp };
  return [{ table: 'routineLogs', type: 'put', before, after }];
}

// ── 例行本身 / 休班标记 ────────────────────────────────────────────────

/** 删除例行：软删例行本身，记录保留（统计与回滚用；派生层会因例行已删而忽略它们） */
export function planDeleteRoutine(s: DeskState, id: string): Change[] {
  const before = s.routines[id];
  return before ? [{ table: 'routines', type: 'delete', before }] : [];
}

export function planPatchRoutine(s: DeskState, id: string, patch: Partial<Routine>, stamp: string): Change[] {
  const before = s.routines[id];
  if (!before) return [];
  const after: Routine = { ...before, ...patch, updatedAt: stamp };
  // 显式 undefined = 删掉这个字段（清除时间、备注、恢复暂停）
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (after as unknown as Record<string, unknown>)[k];
  return [{ table: 'routines', type: 'put', before, after }];
}

/** 标为休息日 / 补班日；type = null 清除标记 */
export function planSetDayMark(s: DeskState, date: string, type: DayMark['type'] | null, stamp: string): Change[] {
  const before = s.dayMarks[date];
  if (type === null) return before ? [{ table: 'dayMarks', type: 'delete', before }] : [];
  if (before?.type === type) return [];
  return [{ table: 'dayMarks', type: 'put', before, after: { ...(before ?? {}), id: date, date, type, updatedAt: stamp } }];
}
