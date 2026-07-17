/**
 * 双层时间轴表头（SPEC 4.2）：HTML div 绝对定位 + 裁剪渲染，与网格共用 buildTicks 刻度。
 * 年：上层「2026」+ Q1-Q4 标注 / 下层月份名
 * 季：上层月份 / 下层 ISO 周号
 * 月周：上层「2026年3月」/ 下层每日「日期+星期」，今天加主色圆底
 * 另渲染免打卡 reason 标注与今日线的「今」标签（表头 sticky，标签随之常驻顶部）。
 */
import { memo } from 'react';
import type { GanttZoom } from '../types/domain';
import type { HeaderCell, ShadeCol, Ticks } from './timeScale';
import { HeaderDayHighlight } from './HoverLayers';
import { HEADER_H, HEADER_LAYER_H, TODAY_BADGE_D } from './constants';

interface Props {
  width: number;
  zoom: GanttZoom;
  ticks: Ticks;
  exemptionCols: (ShadeCol & { reason?: string })[];
  todayX: number | null;
  /** 左栏当前宽（sticky 月份标签钉扎位置） */
  leftW: number;
  /** 十字定位的列高亮需要日宽 */
  dayWidth: number;
}

/** 单元格几何取整：相邻单元格边缘共享同一像素，避免缝隙 */
function cellRect(c: HeaderCell) {
  const left = Math.round(c.x);
  return { left, width: Math.round(c.x + c.width) - left };
}

function DayCell({ cell, wide }: { cell: HeaderCell; wide: boolean }) {
  const { left, width } = cellRect(cell);
  const numColor = cell.isToday
    ? 'var(--text-on-accent)'
    : cell.isWeekend
      ? 'var(--text-tertiary)'
      : 'var(--text-secondary)';
  const badge: React.CSSProperties = cell.isToday
    ? {
        width: TODAY_BADGE_D,
        height: TODAY_BADGE_D,
        lineHeight: `${TODAY_BADGE_D}px`,
        borderRadius: '50%',
        background: 'var(--accent)',
        textAlign: 'center',
      }
    : { lineHeight: '1.1' };
  return (
    <div
      className={`absolute flex items-center justify-center ${wide ? 'flex-row gap-1' : 'flex-col'}`}
      style={{
        left,
        width,
        top: HEADER_LAYER_H,
        height: HEADER_LAYER_H,
        borderLeft: left === 0 ? 'none' : '1px solid var(--border-subtle)',
        background: cell.isWeekend ? 'var(--weekend-tint)' : 'transparent',
      }}
    >
      <span className="tnum" style={{ fontSize: 'var(--font-11)', color: numColor, ...badge }}>
        {cell.label}
      </span>
      <span style={{ fontSize: 'var(--font-11)', lineHeight: '1.1', color: 'var(--text-tertiary)' }}>
        {cell.weekday}
      </span>
    </div>
  );
}

export const TimelineHeader = memo(function TimelineHeader({
  width,
  zoom,
  ticks,
  exemptionCols,
  todayX,
  leftW,
  dayWidth,
}: Props) {
  const isDayLevel = zoom === 'month' || zoom === 'week';
  return (
    <div
      className="relative"
      style={{
        width,
        height: HEADER_H,
        flexShrink: 0,
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      {/* 十字定位：hover 日列在表头的高亮（先渲染，垫在单元格文字之下） */}
      <HeaderDayHighlight dayWidth={dayWidth} />

      {/* 上层 */}
      {ticks.upperCells.map((c) => {
        const { left, width: w } = cellRect(c);
        return (
          <div
            key={c.key}
            // 不能加 overflow-hidden：会让 cell 成为 sticky 标签的滚动参照，钉扎失效；
            // sticky 本身不会把标签移出 cell，无需裁剪
            className="absolute"
            style={{
              left,
              width: w,
              top: 0,
              height: HEADER_LAYER_H,
              borderLeft: left === 0 ? 'none' : '1px solid var(--border-default)',
              padding: '5px 0',
            }}
          >
            <span
              className="tnum inline-block whitespace-nowrap"
              style={{
                position: 'sticky',
                left: leftW + 8,
                marginLeft: 8,
                fontSize: 'var(--font-12)',
                fontWeight: 500,
                color: 'var(--text-secondary)',
              }}
            >
              {c.label}
            </span>
          </div>
        );
      })}
      {ticks.quarterMarks.map((q) => (
        <span
          key={q.label}
          className="absolute tnum"
          style={{
            left: Math.round(q.x) + 6,
            top: 6,
            fontSize: 'var(--font-11)',
            color: 'var(--text-tertiary)',
          }}
        >
          {q.label}
        </span>
      ))}

      {/* 下层 */}
      {isDayLevel
        ? ticks.lowerCells.map((c) => <DayCell key={c.key} cell={c} wide={zoom === 'week'} />)
        : ticks.lowerCells.map((c) => {
            const { left, width: w } = cellRect(c);
            return (
              <div
                key={c.key}
                className="absolute flex items-center justify-center overflow-hidden"
                style={{
                  left,
                  width: w,
                  top: HEADER_LAYER_H,
                  height: HEADER_LAYER_H,
                  borderLeft:
                    left === 0
                      ? 'none'
                      : `1px solid var(--border-${zoom === 'year' ? 'default' : 'subtle'})`,
                }}
              >
                <span
                  className="tnum whitespace-nowrap"
                  style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
                >
                  {c.label}
                </span>
              </div>
            );
          })}

      {/* 免打卡区间 reason 标注（表头顶部） */}
      {exemptionCols.map(
        (c) =>
          c.reason &&
          c.width >= 48 && (
            <span
              key={c.key}
              className="absolute overflow-hidden text-ellipsis whitespace-nowrap"
              style={{
                left: Math.round(c.x) + 4,
                maxWidth: c.width - 8,
                top: 5,
                zIndex: 1,
                fontSize: 'var(--font-11)',
                color: 'var(--text-tertiary)',
                background: 'var(--bg-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0 4px',
              }}
            >
              {c.reason}
            </span>
          ),
      )}

      {/* 今日线顶端「今」标签（表头 sticky → 常驻可见） */}
      {todayX != null && (
        <span
          className="absolute text-center"
          style={{
            left: Math.round(todayX) - 9,
            width: 18,
            bottom: 2,
            zIndex: 2,
            fontSize: 'var(--font-11)',
            lineHeight: '15px',
            color: 'var(--text-on-accent)',
            background: 'var(--danger)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          今
        </span>
      )}
    </div>
  );
});
