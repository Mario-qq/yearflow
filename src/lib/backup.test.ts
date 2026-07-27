import { describe, expect, it } from 'vitest';
import { buildBackupJSON, parseBackupJSON } from './backup';
import { buildSeedBundle } from '../seed/seedData';
import { DEFAULT_SETTINGS } from '../store/defaults';

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
