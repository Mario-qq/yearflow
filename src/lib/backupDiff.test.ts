import { describe, expect, it } from 'vitest';
import type { DayMark } from '../types/domain';
import { emptyBundle } from '../store/types';
import { diffBundles } from './backupDiff';

const dm = (id: string, updatedAt: string): DayMark => ({ id, date: id, type: 'off', updatedAt });

describe('备份与当前数据的差异', () => {
  it('只在一边存在、或 updatedAt 不同的行都算改动', () => {
    const backup = { ...emptyBundle(), dayMarks: [dm('a', '1'), dm('b', '1'), dm('c', '1')] };
    const current = { ...emptyBundle(), dayMarks: [dm('a', '1'), dm('b', '2'), dm('d', '1')] };
    const d = diffBundles(backup, current).find((x) => x.table === 'dayMarks')!;
    // b 改过、c 回滚后会回来、d 回滚后会消失
    expect(d).toEqual({ table: 'dayMarks', inBackup: 3, current: 3, changed: 3 });
  });

  it('完全一致时没有改动', () => {
    const b = { ...emptyBundle(), dayMarks: [dm('a', '1')] };
    expect(diffBundles(b, b).every((x) => x.changed === 0)).toBe(true);
  });
});
