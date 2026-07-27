import { describe, expect, it } from 'vitest';
import { aggregateTrackProgress, buildTracks, memberAtDate } from './tracks';
import type { Task } from '../../types/domain';

const task = (id: string, extra?: Partial<Task>): Task => ({
  id,
  goalId: 'g1',
  name: id,
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  progress: 0,
  progressMode: 'manual',
  status: 'active',
  order: 0,
  updatedAt: '',
  ...extra,
});

describe('buildTracks', () => {
  it('没有 trackId 的任务不产生轨道', () => {
    const idx = buildTracks([task('a'), task('b'), task('c')]);
    expect(idx.tracks).toEqual([]);
    expect(idx.trackIdByTask).toEqual({});
  });

  it('同 goal 内两个及以上同 trackId 的任务成组，name 取最早任务名', () => {
    const idx = buildTracks([
      task('b', { trackId: 'tk', startDate: '2026-03-01', endDate: '2026-03-05', name: '第二段' }),
      task('a', { trackId: 'tk', startDate: '2026-01-01', endDate: '2026-01-10', name: '第一段' }),
    ]);
    expect(idx.tracks).toHaveLength(1);
    const tr = idx.tracks[0];
    expect(tr.id).toBe('tk');
    expect(tr.headId).toBe('a');
    expect(tr.name).toBe('第一段');
    expect(tr.memberIds).toEqual(['a', 'b']);
    expect(idx.byId.tk).toBe(tr);
    expect(idx.trackIdByTask).toEqual({ a: 'tk', b: 'tk' });
    expect(idx.tracksByGoal.g1).toEqual([tr]);
  });

  it('组内只剩一个成员时不成轨道', () => {
    const idx = buildTracks([task('a', { trackId: 'tk' }), task('b')]);
    expect(idx.tracks).toEqual([]);
    expect(idx.trackIdByTask).toEqual({});
  });

  it('跨 goal 的同名 trackId 各自成组，不合并', () => {
    const idx = buildTracks([
      task('a', { goalId: 'g1', trackId: 'tk' }),
      task('b', { goalId: 'g1', trackId: 'tk' }),
      task('c', { goalId: 'g2', trackId: 'tk' }),
      task('d', { goalId: 'g2', trackId: 'tk' }),
    ]);
    expect(idx.tracks).toHaveLength(2);
    expect(idx.tracksByGoal.g1[0].memberIds).toEqual(['a', 'b']);
    expect(idx.tracksByGoal.g2[0].memberIds).toEqual(['c', 'd']);
    // byId 以 trackId 为键，跨 goal 撞键时后者覆盖 —— 消费方一律走 tracksByGoal / trackIdByTask
    expect(idx.trackIdByTask).toEqual({ a: 'tk', b: 'tk', c: 'tk', d: 'tk' });
  });

  it('已软删除的任务不参与成组', () => {
    const idx = buildTracks([
      task('a', { trackId: 'tk' }),
      task('b', { trackId: 'tk', deletedAt: '2026-05-01T00:00:00Z' }),
    ]);
    expect(idx.tracks).toEqual([]);
  });

  it('head 选取：startDate 并列取 order 最小，order 再并列取 id 字典序', () => {
    const same = { trackId: 'tk', startDate: '2026-01-01', endDate: '2026-01-05' };
    expect(
      buildTracks([task('x', { ...same, order: 5 }), task('y', { ...same, order: 2 })]).tracks[0]
        .headId,
    ).toBe('y');
    expect(
      buildTracks([task('b', { ...same, order: 1 }), task('a', { ...same, order: 1 })]).tracks[0]
        .headId,
    ).toBe('a');
  });

  it('memberIds 按 startDate 升序，与任务 order 无关', () => {
    const idx = buildTracks([
      task('late', { trackId: 'tk', order: 0, startDate: '2026-06-01', endDate: '2026-06-02' }),
      task('mid', { trackId: 'tk', order: 9, startDate: '2026-03-01', endDate: '2026-03-02' }),
      task('early', { trackId: 'tk', order: 5, startDate: '2026-01-01', endDate: '2026-01-02' }),
    ]);
    expect(idx.tracks[0].memberIds).toEqual(['early', 'mid', 'late']);
  });

  it('segments：完全重叠 / 部分重叠 / 相邻一天 都合成 1 段', () => {
    const seg = (a: Partial<Task>, b: Partial<Task>) =>
      buildTracks([task('a', { trackId: 'tk', ...a }), task('b', { trackId: 'tk', ...b })])
        .tracks[0].segments;

    expect(
      seg(
        { startDate: '2026-01-01', endDate: '2026-01-10' },
        { startDate: '2026-01-03', endDate: '2026-01-06' },
      ),
    ).toEqual([{ startDate: '2026-01-01', endDate: '2026-01-10' }]);

    expect(
      seg(
        { startDate: '2026-01-01', endDate: '2026-01-10' },
        { startDate: '2026-01-08', endDate: '2026-01-20' },
      ),
    ).toEqual([{ startDate: '2026-01-01', endDate: '2026-01-20' }]);

    expect(
      seg(
        { startDate: '2026-01-01', endDate: '2026-01-10' },
        { startDate: '2026-01-11', endDate: '2026-01-15' },
      ),
    ).toEqual([{ startDate: '2026-01-01', endDate: '2026-01-15' }]);
  });

  it('segments：隔 3 天分成 2 段，间隙即折叠条上的浅色部分', () => {
    const idx = buildTracks([
      task('a', { trackId: 'tk', startDate: '2026-01-01', endDate: '2026-01-10' }),
      task('b', { trackId: 'tk', startDate: '2026-01-14', endDate: '2026-01-20' }),
    ]);
    expect(idx.tracks[0].segments).toEqual([
      { startDate: '2026-01-01', endDate: '2026-01-10' },
      { startDate: '2026-01-14', endDate: '2026-01-20' },
    ]);
  });

  it('包络 span 与 segments 首尾一致，且不被"后开始但更早结束"的成员拉短', () => {
    const idx = buildTracks([
      task('a', { trackId: 'tk', startDate: '2026-01-01', endDate: '2026-08-31' }),
      task('b', { trackId: 'tk', startDate: '2026-02-01', endDate: '2026-02-05' }),
    ]);
    const tr = idx.tracks[0];
    expect(tr.startDate).toBe('2026-01-01');
    expect(tr.endDate).toBe('2026-08-31');
    expect(tr.segments[0].startDate).toBe(tr.startDate);
    expect(tr.segments[tr.segments.length - 1].endDate).toBe(tr.endDate);
  });

  it('tracksByGoal 按 head.order 升序', () => {
    const mk = (id: string, tk: string, order: number, start: string) =>
      task(id, { trackId: tk, order, startDate: start, endDate: start });
    const idx = buildTracks([
      mk('b1', 'tkB', 10, '2026-01-01'),
      mk('b2', 'tkB', 11, '2026-02-01'),
      mk('a1', 'tkA', 1, '2026-05-01'),
      mk('a2', 'tkA', 2, '2026-06-01'),
    ]);
    expect(idx.tracksByGoal.g1.map((t) => t.id)).toEqual(['tkA', 'tkB']);
  });

  it('输出与输入数组顺序无关', () => {
    const input = [
      task('a', { trackId: 'tk', startDate: '2026-01-01', endDate: '2026-01-05' }),
      task('b', { trackId: 'tk', startDate: '2026-02-01', endDate: '2026-02-05' }),
      task('c', { goalId: 'g2', trackId: 'tk2', startDate: '2026-03-01', endDate: '2026-03-05' }),
      task('d', { goalId: 'g2', trackId: 'tk2', startDate: '2026-04-01', endDate: '2026-04-05' }),
    ];
    expect(buildTracks([...input].reverse())).toEqual(buildTracks(input));
  });
});

describe('aggregateTrackProgress', () => {
  it('按跨度天数加权', () => {
    const members = [
      task('a', { startDate: '2026-01-01', endDate: '2026-01-10' }), // 10 天 @100%
      task('b', { startDate: '2026-02-01', endDate: '2026-03-02' }), // 30 天 @0%
    ];
    expect(aggregateTrackProgress(members, (id) => (id === 'a' ? 100 : 0))).toBe(25);
  });

  it('空成员返回 0', () => {
    expect(aggregateTrackProgress([], () => 100)).toBe(0);
  });
});

describe('memberAtDate', () => {
  const members = [
    task('a', { trackId: 'tk', startDate: '2026-01-01', endDate: '2026-01-10' }),
    task('b', { trackId: 'tk', startDate: '2026-01-20', endDate: '2026-01-25' }),
  ];
  const byId = Object.fromEntries(members.map((t) => [t.id, t]));
  const track = buildTracks(members).tracks[0];

  it('命中成员区间（含端点）', () => {
    expect(memberAtDate(track, byId, '2026-01-05')).toBe('a');
    expect(memberAtDate(track, byId, '2026-01-10')).toBe('a');
    expect(memberAtDate(track, byId, '2026-01-20')).toBe('b');
  });

  it('落在间隙里返回 undefined', () => {
    expect(memberAtDate(track, byId, '2026-01-15')).toBeUndefined();
  });
});
