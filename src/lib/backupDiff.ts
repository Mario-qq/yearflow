/**
 * 备份与当前数据的差异（设置页「回滚到这一刻」确认前展示用）。纯函数，单测见 backupDiff.test.ts。
 */
import { TABLE_NAMES, type DataBundle, type TableName } from '../store/types';
import type { SyncableEntity } from '../types/domain';

export interface TableDiff {
  table: TableName;
  inBackup: number;
  current: number;
  /** 回滚会改动的行：只在一边存在，或两边都在但 updatedAt 不同 */
  changed: number;
}

export function diffBundles(backup: DataBundle, current: DataBundle): TableDiff[] {
  return TABLE_NAMES.map((table) => {
    const a = backup[table] as SyncableEntity[];
    const b = current[table] as SyncableEntity[];
    const byId = new Map(b.map((e) => [e.id, e.updatedAt]));
    let changed = 0;
    for (const e of a) {
      const cur = byId.get(e.id);
      if (cur === undefined || cur !== e.updatedAt) changed++;
      byId.delete(e.id);
    }
    changed += byId.size; // 当前有、备份里没有 ⇒ 回滚会删掉
    return { table, inBackup: a.length, current: b.length, changed };
  });
}
