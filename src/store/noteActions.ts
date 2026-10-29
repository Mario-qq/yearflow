/**
 * 便签写操作入口（UI 只调这里，NOTES_SPEC §三）：每个函数算 Change[] → execute 进 undo 栈。
 */
import { nanoid } from 'nanoid';
import type { Note, NoteColor, WorkItem } from '../types/domain';
import { clampBody, expiredTrash, noteRest, noteTitle, parseChecklist, toggleChecklistLine } from '../lib/derive/notes';
import type { Change } from './types';
import { useStore } from './useStore';

const nowIso = () => new Date().toISOString();

const short = (n: Note) => noteTitle(n.body) || '空便签';

function patch(id: string, fn: (n: Note, stamp: string) => Note | null, label: (n: Note) => string): boolean {
  const st = useStore.getState();
  const before = st.notes[id];
  if (!before) return false;
  const after = fn(before, nowIso());
  if (!after) return false;
  st.execute(label(before), [{ table: 'notes', type: 'put', before, after }]);
  return true;
}

/** 新建；正文全空返回 null。mergeKey 给了 ⇒ 和随后的编辑会话合成一条撤销 */
export function createNote(body: string, opts: { color?: NoteColor; mergeKey?: string } = {}): string | null {
  if (!body.trim() && !opts.mergeKey) return null;
  const stamp = nowIso();
  const n: Note = {
    id: nanoid(),
    body: clampBody(body).body,
    ...(opts.color ? { color: opts.color } : {}),
    editedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
  };
  useStore
    .getState()
    .execute(`新建便签「${short(n)}」`, [{ table: 'notes', type: 'put', after: n }], { mergeKey: opts.mergeKey });
  return n.id;
}

/**
 * 编辑器保存正文。base = 编辑器开始这次编辑时看到的正文：库里那条已经不是 base 了（同步拉来了别处的修改）
 * ⇒ 你正在看的这版存进原便签，库里那版另存成冲突副本（两边都不丢）。返回是否因超长被截断。
 */
export function saveNoteBody(id: string, body: string, base: string, mergeKey: string): { clipped: boolean; conflict: boolean } {
  const st = useStore.getState();
  const before = st.notes[id];
  const { body: next, clipped } = clampBody(body);
  if (!before || before.body === next) return { clipped, conflict: false };
  const stamp = nowIso();
  const changes: Change[] = [{ table: 'notes', type: 'put', before, after: { ...before, body: next, editedAt: stamp, updatedAt: stamp } }];
  const conflict = before.body !== base && before.body.trim() !== '';
  if (conflict) {
    const copy: Note = {
      id: nanoid(),
      body: before.body,
      ...(before.color ? { color: before.color } : {}),
      ...(before.localOnly ? { localOnly: true } : {}),
      conflictOf: id,
      pinnedAt: stamp,
      editedAt: before.editedAt,
      createdAt: stamp,
      updatedAt: stamp,
    };
    changes.push({ table: 'notes', type: 'put', after: copy });
  }
  st.execute(`编辑便签「${noteTitle(next) || '空便签'}」`, changes, { mergeKey });
  return { clipped, conflict };
}

/** 编辑会话收起时正文全空 ⇒ 直接删掉（同一 mergeKey：刚新建的会和新建抵消，不留撤销） */
export function discardIfEmpty(id: string, mergeKey: string): boolean {
  const st = useStore.getState();
  const before = st.notes[id];
  if (!before || before.body.trim()) return false;
  st.execute('删除空便签', [{ table: 'notes', type: 'delete', before }], { mergeKey });
  return true;
}

export function toggleNoteCheck(id: string, line: number): void {
  patch(
    id,
    (n, stamp) => {
      const body = toggleChecklistLine(n.body, line);
      return body === n.body ? null : { ...n, body, editedAt: stamp, updatedAt: stamp };
    },
    (n) => `勾选便签「${short(n)}」的清单`,
  );
}

export function setNoteColor(id: string, color: NoteColor | null): void {
  patch(
    id,
    (n, stamp) => {
      if ((n.color ?? null) === color) return null;
      const { color: _c, ...rest } = n;
      return { ...rest, ...(color ? { color } : {}), updatedAt: stamp };
    },
    (n) => `改便签「${short(n)}」的颜色`,
  );
}

export function toggleNotePin(id: string): void {
  patch(
    id,
    (n, stamp) => {
      const { pinnedAt, ...rest } = n;
      return pinnedAt ? { ...rest, updatedAt: stamp } : { ...rest, pinnedAt: stamp, updatedAt: stamp };
    },
    (n) => `${n.pinnedAt ? '取消置顶' : '置顶'}便签「${short(n)}」`,
  );
}

export function setNoteArchived(id: string, on: boolean): void {
  patch(
    id,
    (n, stamp) => {
      if (!!n.archivedAt === on) return null;
      const { archivedAt: _a, pinnedAt: _p, ...rest } = n;
      // 归档顺手取消置顶：拿回来时回到「最近」里，不突然占住顶上
      return on ? { ...rest, archivedAt: stamp, updatedAt: stamp } : { ...rest, ...(n.pinnedAt ? { pinnedAt: n.pinnedAt } : {}), updatedAt: stamp };
    },
    (n) => `${on ? '归档' : '取消归档'}便签「${short(n)}」`,
  );
}

/** 删除 = 进回收站（可恢复） */
export function trashNote(id: string): void {
  patch(id, (n, stamp) => (n.trashedAt ? null : { ...n, trashedAt: stamp, updatedAt: stamp }), (n) => `删除便签「${short(n)}」`);
}

export function restoreNote(id: string): void {
  patch(
    id,
    (n, stamp) => {
      if (!n.trashedAt) return null;
      const { trashedAt: _t, ...rest } = n;
      return { ...rest, updatedAt: stamp };
    },
    (n) => `恢复便签「${short(n)}」`,
  );
}

/** 永久删除（软删除 = 同步墓碑）：只对回收站里的 */
export function purgeNotes(ids: string[], label?: string): number {
  const st = useStore.getState();
  const changes: Change[] = [];
  for (const id of ids) {
    const before = st.notes[id];
    if (before?.trashedAt) changes.push({ table: 'notes', type: 'delete', before });
  }
  if (changes.length === 0) return 0;
  st.execute(label ?? (changes.length === 1 ? `永久删除便签「${short(changes[0].before as Note)}」` : `永久删除 ${changes.length} 条便签`), changes);
  return changes.length;
}

export function emptyTrash(): number {
  const ids = Object.values(useStore.getState().notes)
    .filter((n) => n.trashedAt)
    .map((n) => n.id);
  return purgeNotes(ids, `清空回收站（${ids.length} 条）`);
}

/** 进回收站满 30 天的永久删除（面板打开时跑一次） */
export function purgeExpiredTrash(now = new Date()): number {
  const ids = expiredTrash(Object.values(useStore.getState().notes), now).map((n) => n.id);
  return ids.length > 0 ? purgeNotes(ids, `清理回收站里 30 天前的 ${ids.length} 条便签`) : 0;
}

export function setNoteLocalOnly(id: string, on: boolean): void {
  patch(
    id,
    (n, stamp) => {
      if (!!n.localOnly === on) return null;
      const { localOnly: _l, ...rest } = n;
      return { ...rest, ...(on ? { localOnly: true } : {}), updatedAt: stamp };
    },
    (n) => `便签「${short(n)}」${on ? '改为仅本机' : '恢复云同步'}`,
  );
}

/**
 * 转待办（进工作台「待处理」）。line 缺省 = 整条（标题 + 其余正文作备注）；给了 = 那一行清单。
 * 便签和新待办同一条撤销。返回新待办 id。
 */
export function convertNoteToTodo(id: string, line?: number): string | null {
  const st = useStore.getState();
  const before = st.notes[id];
  if (!before) return null;
  let title: string;
  let note: string | undefined;
  if (line === undefined) {
    title = noteTitle(before.body);
    note = noteRest(before.body) || undefined;
  } else {
    title = parseChecklist(before.body).find((c) => c.line === line)?.text.trim() ?? '';
  }
  if (!title) return null;
  const stamp = nowIso();
  const item: WorkItem = {
    id: nanoid(),
    kind: 'todo',
    title,
    urgency: 'normal',
    scope: 'work',
    status: 'open',
    order: Date.now(),
    createdAt: stamp,
    updatedAt: stamp,
    ...(note ? { note } : {}),
  };
  const after: Note = { ...before, convertedTo: [...(before.convertedTo ?? []), item.id], updatedAt: stamp };
  st.execute(`便签转待办「${title}」`, [
    { table: 'workItems', type: 'put', after: item },
    { table: 'notes', type: 'put', before, after },
  ]);
  return item.id;
}
