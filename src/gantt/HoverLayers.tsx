/**
 * hover 联动与十字定位的覆盖层（SPEC 4.3 / 4.5）。
 * 全部订阅 uiStore 细粒度字段：pointermove 高频更新只重渲这些小组件，
 * 不触碰 GanttView / 表头 / bar 层。均 pointer-events-none。
 */
import type { RowLayout } from './rowLayout';
import { useGanttUi } from './uiStore';
import { HEADER_H } from './constants';

/** 整行淡背景（LeftGrid 与时间轴 body 各放一份 → 横贯两侧） */
export function RowHoverOverlay({ layout }: { layout: RowLayout }) {
  const hoverRowId = useGanttUi((s) => s.hoverRowId);
  const row = hoverRowId ? layout.rowById[hoverRowId] : undefined;
  if (!row) return null;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0"
      style={{ top: row.top, height: row.height, background: 'var(--row-hover)' }}
    />
  );
}

/** 时间轴 body 的整列淡背景（十字的竖线） */
export function ColumnHoverOverlay({ dayWidth, height }: { dayWidth: number; height: number }) {
  const dayIdx = useGanttUi((s) => s.hoverDayIdx);
  if (dayIdx == null) return null;
  return (
    <div
      className="pointer-events-none absolute top-0"
      style={{ left: dayIdx * dayWidth, width: dayWidth, height, background: 'var(--row-hover)' }}
    />
  );
}

/** 表头对应日期单元格高亮（渲染于 TimelineHeader 内） */
export function HeaderDayHighlight({ dayWidth }: { dayWidth: number }) {
  const dayIdx = useGanttUi((s) => s.hoverDayIdx);
  if (dayIdx == null) return null;
  return (
    <div
      className="pointer-events-none absolute top-0"
      style={{ left: dayIdx * dayWidth, width: dayWidth, height: HEADER_H, background: 'var(--row-hover)' }}
    />
  );
}
