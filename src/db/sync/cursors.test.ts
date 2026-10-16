import { describe, expect, it } from 'vitest';
import { advancePush, describeFailures, isMissingTable, pushCursorOf, type Cursors } from './cursors';

describe('分表推送游标', () => {
  it('没有分表游标时回落到旧的全局游标；首次登录为 null', () => {
    const c: Cursors = { push: '2026-10-01T00:00:00Z', pull: {} };
    expect(pushCursorOf(c, 'workItems')).toBe('2026-10-01T00:00:00Z');
    expect(pushCursorOf({ push: null, pull: {} }, 'goals')).toBeNull();
  });

  it('只前移推送成功的那张表', () => {
    const c: Cursors = { push: 'A', pull: {} };
    advancePush(c, 'goals', 'B');
    expect(pushCursorOf(c, 'goals')).toBe('B');
    expect(pushCursorOf(c, 'workItems')).toBe('A'); // 失败的表停在原地，脏行留到下一轮
  });
});

describe('失败说明', () => {
  it('识别「云端没有这张表」的几种报法', () => {
    expect(isMissingTable({ table: 'work_items', message: 'x', code: 'PGRST205' })).toBe(true);
    expect(isMissingTable({ table: 'work_items', message: 'relation "public.work_items" does not exist', code: '42P01' })).toBe(true);
    expect(isMissingTable({ table: 'work_items', message: 'upsert_rows: 非法表名 work_items' })).toBe(true);
    expect(isMissingTable({ table: 'goals', message: 'JWT expired' })).toBe(false);
  });

  it('缺表时说清要执行迁移，并说明其余数据正常', () => {
    const msg = describeFailures([
      { table: 'work_items', message: 'Could not find the table', code: 'PGRST205' },
      { table: 'work_items', message: 'upsert_rows: 非法表名 work_items' },
      { table: 'routines', message: 'Could not find the table', code: 'PGRST205' },
    ]);
    expect(msg).toContain('云端缺少表 work_items、routines');
    expect(msg).toContain('其余数据已正常同步');
  });

  it('每张表报同一句话（断网/鉴权失效）时只说一次', () => {
    expect(
      describeFailures([
        { table: 'goals', message: 'Failed to fetch' },
        { table: 'tasks', message: 'Failed to fetch' },
      ]),
    ).toBe('同步失败：Failed to fetch');
  });
});
