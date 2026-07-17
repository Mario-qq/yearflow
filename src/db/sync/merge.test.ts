import { describe, expect, it } from 'vitest';
import { planPullApply, remoteWins } from './merge';
import type { SyncableEntity } from '../../types/domain';

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
