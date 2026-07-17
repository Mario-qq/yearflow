/**
 * FS 依赖连线层（SPEC 4.4）：前置 bar 右缘 → 后继 bar 左缘的圆角折线。
 * - 中性灰；hover 相关任务（uiStore.hoverRowId ∈ 两端）→ 后继目标色
 * - 后继开始日 < 前置结束日 → 红色警示（不自动改期）
 * - 点击连线删除（进 undo，toast 提示）；折叠泳道中的任务不画
 * SVG 容器 pointer-events-none，仅 path 命中区（加粗透明描边）可点击。
 */
import { memo } from 'react';
import type { Goal, Task } from '../types/domain';
import type { RowLayout } from './rowLayout';
import { dateToX, type TimeScale } from './timeScale';
import { diffDays } from '../lib/date';
import { goalColor } from '../lib/colors';
import { removeDependency } from '../store/actions';
import { showToast } from '../lib/toast';
import { useGanttUi } from './uiStore';
import { BAR_H, BAR_TOP, DEP_ARROW, DEP_CORNER_R, DEP_STROKE_W } from './constants';

interface Edge {
  key: string;
  predId: string;
  succId: string;
  d: string;
  arrow: string;
  conflict: boolean;
  color: string;
}

/** 圆角折线路径：正向走中线，回绕（后继在前置左侧）走行间水平通道 */
function depPath(x1: number, y1: number, x2: number, y2: number): string {
  const r = DEP_CORNER_R;
  const dir = y2 > y1 ? 1 : -1;
  if (y1 === y2) return `M ${x1} ${y1} H ${x2}`;
  if (x2 >= x1 + r * 2 + 4) {
    // 正向：右行到中线 → 竖直 → 右行入端
    const xm = Math.max(x1 + r, Math.min((x1 + x2) / 2, x2 - r));
    return [
      `M ${x1} ${y1}`,
      `H ${xm - r}`,
      `Q ${xm} ${y1} ${xm} ${y1 + dir * r}`,
      `V ${y2 - dir * r}`,
      `Q ${xm} ${y2} ${xm + r} ${y2}`,
      `H ${x2}`,
    ].join(' ');
  }
  // 回绕：先右伸出 → 竖直走一段 → 左行 → 竖直到目标行 → 右行入端
  const xa = x1 + 10;
  const xb = x2 - 10;
  const ym = y1 + dir * (Math.abs(y2 - y1) / 2);
  return [
    `M ${x1} ${y1}`,
    `H ${xa - r}`,
    `Q ${xa} ${y1} ${xa} ${y1 + dir * r}`,
    `V ${ym - dir * r}`,
    `Q ${xa} ${ym} ${xa - r} ${ym}`,
    `H ${xb + r}`,
    `Q ${xb} ${ym} ${xb} ${ym + dir * r}`,
    `V ${y2 - dir * r}`,
    `Q ${xb} ${y2} ${xb + r} ${y2}`,
    `H ${x2}`,
  ].join(' ');
}

interface Props {
  layout: RowLayout;
  scale: TimeScale;
  tasks: Record<string, Task>;
  goals: Record<string, Goal>;
  width: number;
  height: number;
}

export const DependencyLayer = memo(function DependencyLayer({
  layout,
  scale,
  tasks,
  goals,
  width,
  height,
}: Props) {
  const hoverRowId = useGanttUi((s) => s.hoverRowId);

  const edges: Edge[] = [];
  for (const succ of Object.values(tasks)) {
    if (succ.deletedAt || !succ.dependsOn?.length) continue;
    const succRow = layout.rowById[succ.id];
    if (!succRow) continue; // 泳道折叠/被过滤
    for (const predId of succ.dependsOn) {
      const pred = tasks[predId];
      const predRow = layout.rowById[predId];
      if (!pred || pred.deletedAt || !predRow) continue;
      const x1 = dateToX(scale, pred.startDate) + (diffDays(pred.endDate, pred.startDate) + 1) * scale.dayWidth;
      const y1 = predRow.top + BAR_TOP + BAR_H / 2;
      const x2 = dateToX(scale, succ.startDate);
      const y2 = succRow.top + BAR_TOP + BAR_H / 2;
      const conflict = succ.startDate < pred.endDate;
      const hovered = hoverRowId === pred.id || hoverRowId === succ.id;
      const color = conflict
        ? 'var(--danger)'
        : hovered
          ? goalColor(goals[succ.goalId]?.color ?? 'goal-1')
          : 'var(--border-strong)';
      const tip = x2 - DEP_ARROW; // 箭头顶点留在 bar 左缘
      edges.push({
        key: `${predId}->${succ.id}`,
        predId,
        succId: succ.id,
        d: depPath(x1, y1, tip, y2),
        arrow: `M ${x2} ${y2} L ${tip} ${y2 - DEP_ARROW} L ${tip} ${y2 + DEP_ARROW} Z`,
        conflict,
        color,
      });
    }
  }

  if (edges.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      aria-hidden
      style={{ overflow: 'visible' }}
    >
      {edges.map((e) => (
        <g key={e.key}>
          {/* 命中区：加粗透明描边，可点删除 */}
          <path
            d={e.d}
            fill="none"
            stroke="transparent"
            strokeWidth={10}
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onClick={() => {
              removeDependency(e.succId, e.predId);
              showToast('已删除依赖连线（Ctrl+Z 撤销）');
            }}
          >
            <title>{e.conflict ? '日期冲突：后继开始早于前置结束（点击删除依赖）' : '点击删除依赖'}</title>
          </path>
          <path d={e.d} fill="none" stroke={e.color} strokeWidth={DEP_STROKE_W} />
          <path d={e.arrow} fill={e.color} />
        </g>
      ))}
    </svg>
  );
});
