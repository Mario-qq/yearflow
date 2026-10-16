/**
 * 锁住「回滚会传播到所有设备」这件事（DESK_SPEC §七）：
 * ① 被替换掉的行打墓碑（同步把删除带到别的设备）；② 写入时 repo 把 updatedAt 重盖成当前时间
 * （回滚版本在整行 LWW 下必然胜出）。两条缺一条，回滚都只在本机生效、下次同步就被旧云端数据盖回去。
 */
import { describe, expect, it, vi } from 'vitest';
import type { Table } from 'dexie';
import { BaseRepo } from '../db/repos/baseRepo';
import type { WorkItem } from '../types/domain';
import { planReplaceAll } from './replace';
import { emptyBundle, TABLE_NAMES, type EntityMaps } from './types';

const OLD = '2026-10-01T00:00:00.000Z';
const wi = (id: string): WorkItem => ({
  id,
  kind: 'todo',
  title: id,
  urgency: 'normal',
  scope: 'work',
  status: 'open',
  order: 0,
  createdAt: OLD,
  updatedAt: OLD,
});

const maps = (): EntityMaps => Object.fromEntries(TABLE_NAMES.map((t) => [t, {}])) as unknown as EntityMaps;

describe('整库替换（回滚）', () => {
  it('当前有、备份里没有的行打墓碑；备份里的行原样写入', () => {
    const current = maps();
    current.workItems = { keep: wi('keep'), gone: wi('gone') };
    const bundle = { ...emptyBundle(), workItems: [wi('keep'), wi('back')] };
    const out = planReplaceAll(current, bundle, '2026-10-16T09:00:00.000Z');
    const byId = Object.fromEntries(out.workItems.map((e) => [e.id, e]));
    expect(byId.gone.deletedAt).toBe('2026-10-16T09:00:00.000Z');
    expect(byId.keep.deletedAt).toBeUndefined();
    expect(byId.back.deletedAt).toBeUndefined();
    expect(out.workItems).toHaveLength(3);
  });

  it('每张表都参与（新加的表不会被漏掉）', () => {
    expect(Object.keys(planReplaceAll(maps(), emptyBundle(), OLD)).sort()).toEqual([...TABLE_NAMES].sort());
  });

  it('repo.bulkPut 把 updatedAt 重盖成当前时间', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T09:30:00.000Z'));
    const written: WorkItem[] = [];
    const stub = { bulkPut: async (rows: WorkItem[]) => void written.push(...rows) } as unknown as Table<WorkItem, string>;
    await new BaseRepo<WorkItem>(stub).bulkPut([wi('a')]);
    vi.useRealTimers();
    expect(written[0].updatedAt).toBe('2026-10-16T09:30:00.000Z');
  });
});
