/**
 * FS 依赖连线层（SPEC 4.4）：前置 bar 右缘 → 后继 bar 左缘的圆角折线。
 * - 中性灰；hover 相关任务（uiStore.hoverRowId ∈ 两端）→ 后继目标色
 * - 后继开始日 < 前置结束日 → 红色警示（不自动改期）
 * - 点击连线删除（进 undo，toast 提示）；折叠泳道中的任务不画
 * SVG 容器 pointer-events-none，仅 path 命中区（加粗透明描边）可点击。
 */
import { memo } from 'react';
import type { Goal, Task } from '../types/domain';
import type { TrackIndex } from '../lib/derive';
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
  /** 这条可见连线代表的真实依赖条数（>1 = 端点上浮到折叠轨道后收拢的） */
  merged: number;
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
  trackIndex: TrackIndex;
  width: number;
  height: number;
}

/** 端点几何：任务自身可见就用它的 bar；被折叠进轨道则上浮到轨道行的包络条 */
interface Anchor {
  /** 用于判定「两端是否落到同一个可见对象上」 */
  id: string;
  x: number;
  y: number;
  /** 端点所代表的结束日 / 开始日（冲突判定用轨道包络而非成员自身） */
  date: string;
}

export const DependencyLayer = memo(function DependencyLayer({
  layout,
  scale,
  tasks,
  goals,
  trackIndex,
  width,
  height,
}: Props) {
  const hoverRowId = useGanttUi((s) => s.hoverRowId);

  const anchorOf = (task: Task, side: 'pred' | 'succ'): Anchor | null => {
    const own = layout.rowById[task.id];
    if (own) {
      const date = side === 'pred' ? task.endDate : task.startDate;
      const x =
        side === 'pred'
          ? dateToX(scale, task.startDate) + (diffDays(task.endDate, task.startDate) + 1) * scale.dayWidth
          : dateToX(scale, task.startDate);
      return { id: task.id, x, y: own.top + BAR_TOP + BAR_H / 2, date };
    }
    // 任务行不可见：可能是被折叠进轨道，端点上浮到轨道包络条，否则丢弃这条边
    const trackId = trackIndex.trackIdByTask[task.id];
    const row = trackId ? layout.trackRowByTrackId[trackId] : undefined;
    const track = trackId ? trackIndex.byId[trackId] : undefined;
    if (!row || !track) return null;
    const date = side === 'pred' ? track.endDate : track.startDate;
    const x =
      side === 'pred'
        ? dateToX(scale, track.startDate) + (diffDays(track.endDate, track.startDate) + 1) * scale.dayWidth
        : dateToX(scale, track.startDate);
    return { id: row.id, x, y: row.top + row.height / 2, date };
  };

  const edges: Edge[] = [];
  const byKey = new Map<string, Edge>();
  for (const succ of Object.values(tasks)) {
    if (succ.deletedAt || !succ.dependsOn?.length) continue;
    for (const predId of succ.dependsOn) {
      const pred = tasks[predId];
      if (!pred || pred.deletedAt) continue;
      const a = anchorOf(pred, 'pred');
      const b = anchorOf(succ, 'succ');
      if (!a || !b) continue; // 泳道折叠 / 被过滤
      if (a.id === b.id) continue; // 同一条折叠轨道内部：由包络条的连续性表达，不画线
      const key = `${a.id}->${b.id}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.merged += 1;
        continue;
      }
      const conflict = b.date < a.date;
      const hovered = hoverRowId === a.id || hoverRowId === b.id;
      const color = conflict
        ? 'var(--danger)'
        : hovered
          ? goalColor(goals[succ.goalId]?.color ?? 'goal-1')
          : 'var(--border-strong)';
      const tip = b.x - DEP_ARROW; // 箭头顶点留在 bar 左缘
      const edge: Edge = {
        key,
        predId,
        succId: succ.id,
        d: depPath(a.x, a.y, tip, b.y),
        arrow: `M ${b.x} ${b.y} L ${tip} ${b.y - DEP_ARROW} L ${tip} ${b.y + DEP_ARROW} Z`,
        conflict,
        color,
        merged: 1,
      };
      byKey.set(key, edge);
      edges.push(edge);
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
              if (e.merged > 1) {
                // 端点上浮后多条依赖收拢成一条线，删哪条不明确 —— 让用户展开轨道后逐条删
                showToast(`这条线代表 ${e.merged} 条依赖，请展开轨道后逐条删除`);
                return;
              }
              removeDependency(e.succId, e.predId);
              showToast('已删除依赖连线（Ctrl+Z 撤销）');
            }}
          >
            <title>
              {e.merged > 1
                ? `代表 ${e.merged} 条依赖（展开轨道后可逐条删除）`
                : e.conflict
                  ? '日期冲突：后继开始早于前置结束（点击删除依赖）'
                  : '点击删除依赖'}
            </title>
          </path>
          <path d={e.d} fill="none" stroke={e.color} strokeWidth={DEP_STROKE_W} />
          <path d={e.arrow} fill={e.color} />
        </g>
      ))}
    </svg>
  );
});
