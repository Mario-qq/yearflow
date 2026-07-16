import { describe, expect, it } from 'vitest';
import {
  buildExemptionCols,
  buildTicks,
  createTimeScale,
  dateToX,
  dayIndexOf,
  visibleDayRange,
  xToDate,
} from './timeScale';
import { ZOOM_DAY_WIDTH } from './constants';

describe('createTimeScale', () => {
  it('平年 365 天、闰年 366 天，totalWidth = 天数 × dayWidth', () => {
    const s26 = createTimeScale(2026, 28);
    expect(s26.daysInYear).toBe(365);
    expect(s26.totalWidth).toBe(365 * 28);
    const s24 = createTimeScale(2024, 2.5);
    expect(s24.daysInYear).toBe(366);
    expect(s24.totalWidth).toBe(915);
  });
});

describe('坐标换算', () => {
  const scale = createTimeScale(2026, 28);

  it('dateToX / dayIndexOf：1月1日为原点', () => {
    expect(dateToX(scale, '2026-01-01')).toBe(0);
    expect(dateToX(scale, '2026-01-02')).toBe(28);
    expect(dateToX(scale, '2026-03-01')).toBe((31 + 28) * 28);
    expect(dayIndexOf(scale, '2026-12-31')).toBe(364);
  });

  it('x↔date 往返：像素落在哪天就还原哪天', () => {
    expect(xToDate(scale, 0)).toBe('2026-01-01');
    expect(xToDate(scale, 27.9)).toBe('2026-01-01');
    expect(xToDate(scale, 28)).toBe('2026-01-02');
    // 越界 clamp 到年内
    expect(xToDate(scale, -50)).toBe('2026-01-01');
    expect(xToDate(scale, 1e9)).toBe('2026-12-31');
  });

  it('分数 dayWidth（连续缩放）下换算仍一致', () => {
    const s = createTimeScale(2026, 13.7);
    for (const date of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      expect(xToDate(s, dateToX(s, date))).toBe(date);
    }
  });

  it('visibleDayRange 闭区间且 clamp', () => {
    expect(visibleDayRange(scale, 0, 28 * 3)).toEqual([0, 3]);
    expect(visibleDayRange(scale, -100, 1e9)).toEqual([0, 364]);
  });
});

describe('buildTicks — 表头单元格', () => {
  it('年视图：上层整年一格，下层 12 个月，Q1-Q4 标注齐全', () => {
    const scale = createTimeScale(2026, ZOOM_DAY_WIDTH.year);
    const t = buildTicks(scale, 'year', 0, 364, 1, '2026-07-16');
    expect(t.upperCells).toHaveLength(1);
    expect(t.upperCells[0].label).toBe('2026');
    expect(t.lowerCells).toHaveLength(12);
    expect(t.lowerCells[0]).toMatchObject({ x: 0, width: 31 * 2.5, label: '1月' });
    expect(t.quarterMarks.map((q) => q.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(t.quarterMarks[2].x).toBe(dateToX(scale, '2026-07-01'));
    // 年视图无周末底纹
    expect(t.weekendCols).toHaveLength(0);
  });

  it('季视图：上层月名，下层 ISO 周号（跨年周 clamp 到年内）', () => {
    const scale = createTimeScale(2026, ZOOM_DAY_WIDTH.quarter);
    const t = buildTicks(scale, 'quarter', 0, 364, 1, '2026-07-16');
    expect(t.upperCells[0].label).toBe('1月');
    // 2026-01-01 是周四，属 ISO W01（周一 2025-12-29 起），首格在年内被裁到 4 天
    expect(t.lowerCells[0].label).toBe('W01');
    expect(t.lowerCells[0].x).toBe(0);
    expect(t.lowerCells[0].width).toBe(4 * 8);
    expect(t.lowerCells[1]).toMatchObject({ label: 'W02', x: 4 * 8, width: 7 * 8 });
    // 年末：12-31 是周四，最后一周 W53 起于 12-28，裁到 4 天
    const last = t.lowerCells[t.lowerCells.length - 1];
    expect(last.label).toBe('W53');
    expect(last.width).toBe(4 * 8);
  });

  it('月视图：上层「2026年3月」，下层每日 + 今天/周末标记', () => {
    const scale = createTimeScale(2026, ZOOM_DAY_WIDTH.month);
    const mar1 = dayIndexOf(scale, '2026-03-01');
    const t = buildTicks(scale, 'month', mar1, mar1 + 30, 1, '2026-03-15');
    expect(t.upperCells.map((c) => c.label)).toEqual(['2026年3月']);
    expect(t.lowerCells).toHaveLength(31);
    const today = t.lowerCells.find((c) => c.isToday);
    expect(today).toMatchObject({ label: '15', weekday: '日', isWeekend: true });
    expect(t.lowerCells[0]).toMatchObject({ label: '1', weekday: '日' });
  });
});

describe('buildTicks — 网格线与周末', () => {
  const weekScale = createTimeScale(2026, ZOOM_DAY_WIDTH.week);

  it('线层级：日<周<月<季，边界取最高层级', () => {
    const t = buildTicks(weekScale, 'week', 0, 100, 1, '2026-07-16');
    const at = (date: string) => t.gridLines.find((l) => l.x === dateToX(weekScale, date));
    expect(at('2026-01-05')?.level).toBe('week'); // 周一
    expect(at('2026-02-01')?.level).toBe('month');
    expect(at('2026-04-01')?.level).toBe('quarter');
    expect(at('2026-01-02')?.level).toBe('day');
    // x=0（1月1日）不画线（年起点）
    expect(at('2026-01-01')).toBeUndefined();
  });

  it('weekStartsOn=0 时周线落在周日', () => {
    const t = buildTicks(weekScale, 'week', 0, 30, 0, '2026-07-16');
    const jan4 = t.gridLines.find((l) => l.x === dateToX(weekScale, '2026-01-04')); // 周日
    expect(jan4?.level).toBe('week');
  });

  it('周末列相邻合并（周六+周日 = 一个 2 天宽 rect）', () => {
    const t = buildTicks(weekScale, 'week', 0, 13, 1, '2026-07-16');
    // 1/3(六)+1/4(日)、1/10+1/11 → 两个合并列
    expect(t.weekendCols).toHaveLength(2);
    expect(t.weekendCols[0]).toMatchObject({ x: dateToX(weekScale, '2026-01-03'), width: 2 * 56 });
  });

  it('年视图只画周及以上层级的线', () => {
    const scale = createTimeScale(2026, ZOOM_DAY_WIDTH.year);
    const t = buildTicks(scale, 'year', 0, 364, 1, '2026-07-16');
    expect(t.gridLines.some((l) => l.level === 'day')).toBe(false);
    expect(t.gridLines.filter((l) => l.level === 'quarter')).toHaveLength(3); // 4/1、7/1、10/1
  });
});

describe('buildExemptionCols', () => {
  const scale = createTimeScale(2026, 28);
  const ex = (id: string, startDate: string, endDate: string, reason?: string) => ({
    id,
    startDate,
    endDate,
    reason,
    updatedAt: '',
  });

  it('生成整列并携带 reason；越界 clamp；可视范围外剔除', () => {
    const cols = buildExemptionCols(
      scale,
      [ex('a', '2026-10-01', '2026-10-07', '国庆假期'), ex('b', '2025-12-25', '2026-01-02')],
      0,
      364,
    );
    expect(cols).toHaveLength(2);
    expect(cols[0]).toMatchObject({
      x: dateToX(scale, '2026-10-01'),
      width: 7 * 28,
      reason: '国庆假期',
    });
    expect(cols[1]).toMatchObject({ x: 0, width: 2 * 28 }); // 跨年头部 clamp
    // 可视范围外
    expect(buildExemptionCols(scale, [ex('a', '2026-10-01', '2026-10-07')], 0, 30)).toHaveLength(0);
  });

  it('软删除的区间不渲染', () => {
    const del = { ...ex('a', '2026-10-01', '2026-10-07'), deletedAt: 'x' };
    expect(buildExemptionCols(scale, [del], 0, 364)).toHaveLength(0);
  });
});
