import { describe, expect, it } from 'vitest';
import { buildBackupJSON, parseBackupJSON } from './backup';
import { buildSeedBundle } from '../seed/seedData';
import { DEFAULT_SETTINGS } from '../store/defaults';
import type { RoutineRule } from '../types/domain';

describe('JSON 备份导出/导入', () => {
  it('导出 → 解析往返无损', () => {
    const bundle = buildSeedBundle('2026-07-16');
    const json = buildBackupJSON(bundle, DEFAULT_SETTINGS);
    const parsed = parseBackupJSON(json);
    expect(parsed.data).toEqual(bundle);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('非法 JSON 抛可读错误', () => {
    expect(() => parseBackupJSON('{oops')).toThrow('不是合法的 JSON');
  });

  it('更高版本的备份拒绝导入', () => {
    const bundle = buildSeedBundle('2026-07-16');
    const raw = JSON.parse(buildBackupJSON(bundle, DEFAULT_SETTINGS));
    raw.schemaVersion = 99;
    expect(() => parseBackupJSON(JSON.stringify(raw))).toThrow('请先升级应用');
  });

  it('字段不合法时校验失败并指出路径', () => {
    const bundle = buildSeedBundle('2026-07-16');
    const raw = JSON.parse(buildBackupJSON(bundle, DEFAULT_SETTINGS));
    raw.data.tasks[0].startDate = '2026/01/01';
    expect(() => parseBackupJSON(JSON.stringify(raw))).toThrow('备份校验失败');
  });

  it('种子数据打卡状态齐全（done/partial/skipped 都有）', () => {
    const bundle = buildSeedBundle('2026-07-16');
    const statuses = new Set(bundle.checkIns.map((c) => c.status));
    expect(statuses).toEqual(new Set(['done', 'partial', 'skipped']));
    expect(bundle.goals).toHaveLength(5);
    expect(bundle.tasks.filter((t) => t.baseline)).toHaveLength(2);
  });
});

describe('执行轨道字段的备份兼容', () => {
  it('任务的 trackId 往返保留', () => {
    const bundle = buildSeedBundle('2026-07-16');
    bundle.tasks[0] = { ...bundle.tasks[0], trackId: 'tk-1' };
    bundle.tasks[1] = { ...bundle.tasks[1], trackId: 'tk-1' };
    const parsed = parseBackupJSON(buildBackupJSON(bundle, DEFAULT_SETTINGS));
    expect(parsed.data.tasks[0].trackId).toBe('tk-1');
    expect(parsed.data.tasks[1].trackId).toBe('tk-1');
  });

  it('老备份缺 expandedTrackIds 时补默认空数组', () => {
    const bundle = buildSeedBundle('2026-07-16');
    const raw = JSON.parse(buildBackupJSON(bundle, DEFAULT_SETTINGS));
    delete raw.settings.ganttView.expandedTrackIds;
    const parsed = parseBackupJSON(JSON.stringify(raw));
    expect(parsed.settings?.ganttView.expandedTrackIds).toEqual([]);
  });
});

describe('工作台四张表的备份兼容', () => {
  const T = '2026-10-16T08:00:00.000Z';

  it('老备份没有这四个键时补空数组', () => {
    const raw = JSON.parse(buildBackupJSON(buildSeedBundle('2026-07-16'), DEFAULT_SETTINGS));
    for (const k of ['workItems', 'routines', 'routineLogs', 'dayMarks']) delete raw.data[k];
    const parsed = parseBackupJSON(JSON.stringify(raw));
    expect(parsed.data.workItems).toEqual([]);
    expect(parsed.data.routines).toEqual([]);
    expect(parsed.data.routineLogs).toEqual([]);
    expect(parsed.data.dayMarks).toEqual([]);
  });

  it('事项、例行（五种规则）、例行记录、休/班标记往返无损', () => {
    const bundle = buildSeedBundle('2026-07-16');
    bundle.workItems = [
      { id: 'w1', kind: 'followup', title: 'ARM 测试脚本', urgency: 'urgent', scope: 'work', date: '2026-10-20', dueDate: '2026-10-21', person: '李工', mode: 'dispatch', status: 'open', deferCount: 2, order: 1, createdAt: T, updatedAt: T },
      { id: 'w2', kind: 'todo', title: '研究统计信息', urgency: 'normal', scope: 'work', status: 'open', order: 2, createdAt: T, updatedAt: T },
    ];
    const rules: RoutineRule[] = [
      { type: 'daily' },
      { type: 'workday' },
      { type: 'weekly', daysOfWeek: [1, 3] },
      { type: 'monthlyDay', monthDay: -1 },
      { type: 'monthlyNth', nth: 2, weekday: 3 },
    ];
    bundle.routines = rules.map((rule, i) => ({ id: `r${i}`, title: `例行${i}`, scope: 'work' as const, rule, time: '09:00', startDate: '2026-10-01', order: i, createdAt: T, updatedAt: T }));
    bundle.routineLogs = [{ id: 'r2:2026-10-14', routineId: 'r2', date: '2026-10-14', status: 'moved', movedTo: '2026-10-15', createdAt: T, updatedAt: T }];
    bundle.dayMarks = [{ id: '2026-10-10', date: '2026-10-10', type: 'work', note: '国庆补班', updatedAt: T }];
    const parsed = parseBackupJSON(buildBackupJSON(bundle, DEFAULT_SETTINGS));
    expect(parsed.data).toEqual(bundle);
  });

  it('非法的例行规则校验失败', () => {
    const raw = JSON.parse(buildBackupJSON(buildSeedBundle('2026-07-16'), DEFAULT_SETTINGS));
    raw.data.routines = [{ id: 'r', title: 'x', scope: 'work', rule: { type: 'monthlyDay', monthDay: 0 }, startDate: '2026-10-01', order: 0, createdAt: T, updatedAt: T }];
    expect(() => parseBackupJSON(JSON.stringify(raw))).toThrow('备份校验失败');
  });
});
