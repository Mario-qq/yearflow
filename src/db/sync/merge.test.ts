import { describe, expect, it } from 'vitest';
import { noteConflictCopies, planPullApply, redactForPush, remoteWins } from './merge';
import type { Note, SyncableEntity } from '../../types/domain';

const e = (id: string, updatedAt: string, deletedAt?: string): SyncableEntity => ({
  id,
  updatedAt,
  ...(deletedAt ? { deletedAt } : {}),
});

const T1 = '2026-07-01T00:00:00.000Z';
const T2 = '2026-07-02T00:00:00.000Z';
const T3 = '2026-07-03T00:00:00.000Z';

describe('remoteWins（整行 LWW）', () => {
  it('本地缺失 → 远端赢', () => {
    expect(remoteWins(undefined, e('a', T1))).toBe(true);
  });

  it('远端严格更新 → 远端赢', () => {
    expect(remoteWins(e('a', T1), e('a', T2))).toBe(true);
  });

  it('updatedAt 相等（自己推送的回声）→ 跳过', () => {
    expect(remoteWins(e('a', T2), e('a', T2))).toBe(false);
  });

  it('远端更旧 → 本地赢', () => {
    expect(remoteWins(e('a', T2), e('a', T1))).toBe(false);
  });
});

describe('planPullApply（拉取应用计划）', () => {
  it('新实体：写库并并入内存', () => {
    const plan = planPullApply({}, [e('a', T1)]);
    expect(plan.dbPuts.map((x) => x.id)).toEqual(['a']);
    expect(plan.mapPuts.map((x) => x.id)).toEqual(['a']);
    expect(plan.mapDeletes).toEqual([]);
  });

  it('远端更旧的行整条跳过（不写库、不动内存）', () => {
    const plan = planPullApply({ a: e('a', T2) }, [e('a', T1)]);
    expect(plan.dbPuts).toEqual([]);
    expect(plan.mapPuts).toEqual([]);
    expect(plan.mapDeletes).toEqual([]);
  });

  it('远端墓碑更新 → 写库保留墓碑，内存移除', () => {
    const plan = planPullApply({ a: e('a', T1) }, [e('a', T2, T2)]);
    expect(plan.dbPuts).toHaveLength(1);
    expect(plan.dbPuts[0].deletedAt).toBe(T2);
    expect(plan.mapPuts).toEqual([]);
    expect(plan.mapDeletes).toEqual(['a']);
  });

  it('本地墓碑更新时，远端旧版存活行不得复活（须对照含墓碑的 Dexie 行）', () => {
    // 场景：本机 T2 删除（尚未推送），远端拉回 B 设备 T1 的修改 → 删除赢
    const plan = planPullApply({ a: e('a', T2, T2) }, [e('a', T1)]);
    expect(plan.dbPuts).toEqual([]);
    expect(plan.mapPuts).toEqual([]);
    expect(plan.mapDeletes).toEqual([]);
  });

  it('同 id 多条（分页期间被改写）取 updatedAt 最大的一条，与到达顺序无关', () => {
    const plan = planPullApply({}, [e('a', T3), e('a', T1), e('a', T2)]);
    expect(plan.dbPuts).toHaveLength(1);
    expect(plan.dbPuts[0].updatedAt).toBe(T3);
  });

  it('混合批次各归各位', () => {
    const local = { a: e('a', T1), b: e('b', T3), c: e('c', T1) };
    const plan = planPullApply(local, [
      e('a', T2), // 更新 → 应用
      e('b', T2), // 更旧 → 跳过
      e('c', T2, T2), // 墓碑 → 内存移除
      e('d', T1), // 新增
    ]);
    expect(plan.dbPuts.map((x) => x.id).sort()).toEqual(['a', 'c', 'd']);
    expect(plan.mapPuts.map((x) => x.id).sort()).toEqual(['a', 'd']);
    expect(plan.mapDeletes).toEqual(['c']);
  });
});

describe('noteConflictCopies（便签冲突副本）', () => {
  const n = (id: string, body: string, p: Partial<Note> = {}): Note => ({
    id,
    body,
    editedAt: T1,
    createdAt: T1,
    updatedAt: T1,
    ...p,
  });
  const NOW = '2026-07-05T00:00:00.000Z';
  let seq = 0;
  const mk = () => `copy${++seq}`;

  it('本机正文在上次推送后改过且和远端不同 ⇒ 另存一份本机版', () => {
    const local = { a: n('a', '本机版', { editedAt: T2, updatedAt: T2 }) };
    const remote = n('a', '远端版', { updatedAt: T3 });
    const copies = noteConflictCopies(local, [remote], T1, NOW, mk);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ body: '本机版', conflictOf: 'a', pinnedAt: NOW, createdAt: NOW, updatedAt: NOW });
    expect(copies[0].id).not.toBe('a');
  });

  it('本机修改已推过 / 正文相同 / 本机只改了颜色 ⇒ 不出副本', () => {
    expect(noteConflictCopies({ a: n('a', '旧', { editedAt: T1 }) }, [n('a', '新', { updatedAt: T3 })], T2, NOW, mk)).toEqual([]);
    expect(noteConflictCopies({ a: n('a', '同', { editedAt: T2 }) }, [n('a', '同', { updatedAt: T3, color: 'blue' })], T1, NOW, mk)).toEqual([]);
    expect(
      noteConflictCopies({ a: n('a', '旧', { editedAt: T1, updatedAt: T2, color: 'pink' }) }, [n('a', '新', { updatedAt: T3 })], T1, NOW, mk),
    ).toEqual([]);
  });

  it('远端删了而本机有没推的修改 ⇒ 保住本机版', () => {
    const copies = noteConflictCopies({ a: n('a', '本机', { editedAt: T2 }) }, [n('a', '本机', { updatedAt: T3, deletedAt: T3 })], T1, NOW, mk);
    expect(copies.map((c) => c.body)).toEqual(['本机']);
  });

  it('从没推过（游标 null）⇒ 本机修改都算没推；本机已删 / 空正文 / 本机没有 ⇒ 不出', () => {
    expect(noteConflictCopies({ a: n('a', '甲') }, [n('a', '乙', { updatedAt: T3 })], null, NOW, mk)).toHaveLength(1);
    expect(noteConflictCopies({ a: n('a', '甲', { editedAt: T2, deletedAt: T2 }) }, [n('a', '乙', { updatedAt: T3 })], T1, NOW, mk)).toEqual([]);
    expect(noteConflictCopies({ a: n('a', '  ', { editedAt: T2 }) }, [n('a', '乙', { updatedAt: T3 })], T1, NOW, mk)).toEqual([]);
    expect(noteConflictCopies({}, [n('a', '乙', { updatedAt: T3 })], T1, NOW, mk)).toEqual([]);
  });
});

describe('redactForPush（仅本机便签只推墓碑）', () => {
  it('仅本机 ⇒ 不含正文的墓碑，updatedAt 不变', () => {
    const note: Note = { id: 'a', body: '密码 123', localOnly: true, color: 'pink', editedAt: T2, createdAt: T1, updatedAt: T3 };
    const out = redactForPush('notes', note) as Note;
    expect(out).toEqual({ id: 'a', body: '', editedAt: T1, createdAt: T1, updatedAt: T3, deletedAt: T3 });
    expect(JSON.stringify(out)).not.toContain('密码');
  });
  it('普通便签与别的表原样', () => {
    const note: Note = { id: 'a', body: 'x', editedAt: T1, createdAt: T1, updatedAt: T1 };
    expect(redactForPush('notes', note)).toBe(note);
    const other = e('b', T1);
    expect(redactForPush('goals', other)).toBe(other);
  });
});
