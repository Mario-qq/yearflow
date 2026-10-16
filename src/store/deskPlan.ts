/**
 * 工作台写操作的「计划」：给定当前实体，算出要执行的 Change[]。纯函数（不碰 store/Dexie），
 * 单测见 deskPlan.test.ts；deskActions.ts 负责取 state、生成 id/时间戳、走 execute 进 undo 栈。
 * 铁律同 actions.ts：只构造受影响实体的新对象，未动实体保持引用。
 */
import type { DayMark, Routine, RoutineLog, WorkItem } from '../types/domain';
import { moveItem, routineLogId } from '../lib/derive/desk';
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
    if (patch.status === 'done' || patch.status === 'dropped') after.doneAt = stamp;
    out.push({ table: 'workItems', type: 'put', before, after });
  }
  return out;
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
  return before ? [{ table: 'routines', type: 'put', before, after: { ...before, ...patch, updatedAt: stamp } }] : [];
}

/** 标为休息日 / 补班日；type = null 清除标记 */
export function planSetDayMark(s: DeskState, date: string, type: DayMark['type'] | null, stamp: string): Change[] {
  const before = s.dayMarks[date];
  if (type === null) return before ? [{ table: 'dayMarks', type: 'delete', before }] : [];
  if (before?.type === type) return [];
  return [{ table: 'dayMarks', type: 'put', before, after: { ...(before ?? {}), id: date, date, type, updatedAt: stamp } }];
}
