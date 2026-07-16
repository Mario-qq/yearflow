/**
 * 时间轴单一坐标系（纯函数，vitest 覆盖）。
 * 表头、网格、bar、点阵、mini-map、拖拽吸附全部只认这一份换算，禁止另起炉灶。
 *
 * 坐标定义：timeline x（px）以 yearInView 的 1 月 1 日 00:00 为原点；
 * 第 i 天占据 [i*dayWidth, (i+1)*dayWidth)。
 * bar 语义锁定：endDate 含当日 → width = (diffDays(end, start) + 1) * dayWidth。
 */
import type { ExemptionPeriod, GanttZoom } from '../types/domain';
import { dayjs, diffDays, fmtDay, toDay, type Dayjs } from '../lib/date';

export interface TimeScale {
  year: number;
  yearStart: string; // YYYY-01-01
  yearEnd: string; // YYYY-12-31
  daysInYear: number; // 365 / 366
  dayWidth: number; // px/天，连续值
  totalWidth: number; // daysInYear * dayWidth
}

export function createTimeScale(year: number, dayWidth: number): TimeScale {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const daysInYear = diffDays(yearEnd, yearStart) + 1;
  return { year, yearStart, yearEnd, daysInYear, dayWidth, totalWidth: daysInYear * dayWidth };
}

/** 日序号（相对 1 月 1 日，可为负/越界，调用方自行 clamp） */
export function dayIndexOf(scale: TimeScale, date: string): number {
  return diffDays(date, scale.yearStart);
}

export function dateToX(scale: TimeScale, date: string): number {
  return dayIndexOf(scale, date) * scale.dayWidth;
}

/** x → 当天日期（clamp 到年内） */
export function xToDate(scale: TimeScale, x: number): string {
  const idx = clampDayIndex(scale, Math.floor(x / scale.dayWidth));
  return fmtDay(toDay(scale.yearStart).add(idx, 'day'));
}

export function clampDayIndex(scale: TimeScale, idx: number): number {
  return Math.max(0, Math.min(scale.daysInYear - 1, idx));
}

/** 可视 px 范围 → 可视日序号闭区间 */
export function visibleDayRange(scale: TimeScale, xStart: number, xEnd: number): [number, number] {
  return [
    clampDayIndex(scale, Math.floor(xStart / scale.dayWidth)),
    clampDayIndex(scale, Math.ceil(xEnd / scale.dayWidth)),
  ];
}

// ── 刻度生成 ─────────────────────────────────────────────────────────────

export interface HeaderCell {
  key: string;
  x: number;
  width: number;
  label: string;
  /** 下层日单元格：今天（主色圆底）/ 周末（文字弱化） */
  isToday?: boolean;
  isWeekend?: boolean;
  /** 月/周视图日单元格的星期缩写（"一"…"日"） */
  weekday?: string;
}

export type GridLineLevel = 'day' | 'week' | 'month' | 'quarter';

export interface GridLine {
  x: number;
  level: GridLineLevel;
}

export interface ShadeCol {
  key: string;
  x: number;
  width: number;
}

export interface QuarterMark {
  x: number;
  label: string; // Q1…Q4
}

export interface Ticks {
  upperCells: HeaderCell[];
  lowerCells: HeaderCell[];
  gridLines: GridLine[];
  weekendCols: ShadeCol[];
  quarterMarks: QuarterMark[];
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

function isWeekend(d: Dayjs): boolean {
  const dow = d.day();
  return dow === 0 || dow === 6;
}

/** 每档垂直网格线的最低层级（低于它的不画，避免过密） */
const MIN_LINE_LEVEL: Record<GanttZoom, GridLineLevel> = {
  year: 'week',
  quarter: 'week',
  month: 'day',
  week: 'day',
};

const LINE_RANK: Record<GridLineLevel, number> = { day: 0, week: 1, month: 2, quarter: 3 };

/** 某天起点边界的线层级（取该边界能代表的最高层级） */
export function boundaryLevel(d: Dayjs, weekStartsOn: 0 | 1): GridLineLevel {
  const isMonthStart = d.date() === 1;
  if (isMonthStart && [0, 3, 6, 9].includes(d.month())) return 'quarter';
  if (isMonthStart) return 'month';
  if (d.day() === weekStartsOn) return 'week';
  return 'day';
}

/**
 * 生成可视范围内的全部刻度（表头单元格 / 网格线 / 周末列 / 季度标注）。
 * visStartIdx/visEndIdx 为日序号闭区间（已 clamp）；单元格按完整几何生成（部分可见也给全宽）。
 */
export function buildTicks(
  scale: TimeScale,
  zoom: GanttZoom,
  visStartIdx: number,
  visEndIdx: number,
  weekStartsOn: 0 | 1,
  today: string,
): Ticks {
  const { dayWidth } = scale;
  const start = toDay(scale.yearStart);
  const gridLines: GridLine[] = [];
  const weekendCols: ShadeCol[] = [];
  const minRank = LINE_RANK[MIN_LINE_LEVEL[zoom]];

  // 网格线 + 周末列（周末相邻天合并成一个 rect，年视图不渲染周末底纹）
  let weekendRun: ShadeCol | null = null;
  for (let i = visStartIdx; i <= visEndIdx; i++) {
    const d = start.add(i, 'day');
    if (i > 0) {
      const level = boundaryLevel(d, weekStartsOn);
      if (LINE_RANK[level] >= minRank) gridLines.push({ x: i * dayWidth, level });
    }
    if (zoom !== 'year' && isWeekend(d)) {
      if (weekendRun && weekendRun.x + weekendRun.width === i * dayWidth) {
        weekendRun.width += dayWidth;
      } else {
        weekendRun = { key: `we-${i}`, x: i * dayWidth, width: dayWidth };
        weekendCols.push(weekendRun);
      }
    }
  }

  // 表头单元格
  const upperCells: HeaderCell[] = [];
  const lowerCells: HeaderCell[] = [];
  const visStart = start.add(visStartIdx, 'day');
  const visEnd = start.add(visEndIdx, 'day');

  const pushMonthCells = (cells: HeaderCell[], withYear: boolean) => {
    let m = visStart.startOf('month');
    while (!m.isAfter(visEnd)) {
      const monthStartIdx = Math.max(0, dayIndexOf(scale, fmtDay(m)));
      const monthEnd = m.endOf('month');
      const monthEndIdx = Math.min(scale.daysInYear - 1, dayIndexOf(scale, fmtDay(monthEnd)));
      cells.push({
        key: `m-${m.format('YYYY-MM')}`,
        x: monthStartIdx * dayWidth,
        width: (monthEndIdx - monthStartIdx + 1) * dayWidth,
        label: withYear ? `${m.year()}年${m.month() + 1}月` : `${m.month() + 1}月`,
      });
      m = m.add(1, 'month');
    }
  };

  if (zoom === 'year') {
    // 上层：整年一格「2026」；季度以 quarterMarks 标注在季线右侧
    upperCells.push({ key: `y-${scale.year}`, x: 0, width: scale.totalWidth, label: String(scale.year) });
    pushMonthCells(lowerCells, false);
  } else if (zoom === 'quarter') {
    // 上层：月；下层：ISO 周号
    pushMonthCells(upperCells, false);
    let w = visStart.startOf('isoWeek');
    while (!w.isAfter(visEnd)) {
      const wStartIdx = dayIndexOf(scale, fmtDay(w));
      const from = Math.max(0, wStartIdx);
      const to = Math.min(scale.daysInYear - 1, wStartIdx + 6);
      lowerCells.push({
        key: `w-${fmtDay(w)}`,
        x: from * dayWidth,
        width: (to - from + 1) * dayWidth,
        label: `W${String(w.isoWeek()).padStart(2, '0')}`,
      });
      w = w.add(1, 'week');
    }
  } else {
    // 月/周视图：上层「2026年3月」；下层每日「日期+星期」
    pushMonthCells(upperCells, true);
    for (let i = visStartIdx; i <= visEndIdx; i++) {
      const d = start.add(i, 'day');
      const dateStr = fmtDay(d);
      lowerCells.push({
        key: `d-${dateStr}`,
        x: i * dayWidth,
        width: dayWidth,
        label: String(d.date()),
        weekday: WEEKDAY_ZH[d.day()],
        isToday: dateStr === today,
        isWeekend: isWeekend(d),
      });
    }
  }

  // 季度标注（年/季视图；月/周视图月名已足够，避免与上层文字打架）
  const quarterMarks: QuarterMark[] = [];
  if (zoom === 'year' || zoom === 'quarter') {
    for (let q = 0; q < 4; q++) {
      const qStart = dayjs(new Date(scale.year, q * 3, 1));
      const idx = dayIndexOf(scale, fmtDay(qStart));
      if (idx > visEndIdx || idx + 92 < visStartIdx) continue;
      quarterMarks.push({ x: idx * dayWidth, label: `Q${q + 1}` });
    }
  }

  return { upperCells, lowerCells, gridLines, weekendCols, quarterMarks };
}

/** 免打卡区间 → 整列斜纹（clamp 到年内并按可视范围裁剪） */
export function buildExemptionCols(
  scale: TimeScale,
  exemptions: ExemptionPeriod[],
  visStartIdx: number,
  visEndIdx: number,
): (ShadeCol & { reason?: string })[] {
  const cols: (ShadeCol & { reason?: string })[] = [];
  for (const ex of exemptions) {
    if (ex.deletedAt) continue;
    const from = Math.max(dayIndexOf(scale, ex.startDate), 0);
    const to = Math.min(dayIndexOf(scale, ex.endDate), scale.daysInYear - 1);
    if (to < from || to < visStartIdx || from > visEndIdx) continue;
    cols.push({
      key: `ex-${ex.id}`,
      x: from * scale.dayWidth,
      width: (to - from + 1) * scale.dayWidth,
      reason: ex.reason,
    });
  }
  return cols;
}
