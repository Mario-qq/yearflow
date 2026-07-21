/**
 * 免打卡区间管理（SPEC 第六节，设置页）：出差/生病/假期一键豁免，
 * 期间不判缺卡不断 streak，时间轴以斜纹区呈现。行内编辑即存进 undo。
 */
import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { diffDays, fmtDay, toDay, todayStr } from '../lib/date';
import { goalColor } from '../lib/colors';
import { createExemption, deleteExemption, updateExemption } from '../store/actions';
import type { ExemptionPeriod } from '../types/domain';

const inputStyle: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-primary)',
  padding: '3px 6px',
};

export function ExemptionManager() {
  const exemptions = useStore((s) => s.exemptions);
  const goals = useStore((s) => s.goals);
  const [adding, setAdding] = useState(false);
  const today = todayStr();
  const currentYear = today.slice(0, 4);

  const goalList = useMemo(
    () =>
      Object.values(goals)
        .filter((g) => !g.deletedAt && !g.archived)
        .sort((a, b) => a.order - b.order),
    [goals],
  );
  const list = useMemo(
    () =>
      Object.values(exemptions)
        .filter((e) => !e.deletedAt)
        .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [exemptions],
  );

  // 按开始日期的年份分组（跨年区间归入开始年份），年份倒序
  const groups = useMemo(() => {
    const byYear = new Map<string, ExemptionPeriod[]>();
    for (const ex of list) {
      const year = ex.startDate.slice(0, 4);
      const arr = byYear.get(year);
      if (arr) arr.push(ex);
      else byYear.set(year, [ex]);
    }
    return [...byYear.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([year, items]) => ({
        year,
        items,
        days: items.reduce((sum, ex) => sum + diffDays(ex.endDate, ex.startDate) + 1, 0),
      }));
  }, [list]);

  // 折叠状态仅存组件内存：默认收起过去的年份，当年及未来展开
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isCollapsed = (year: string) => collapsed[year] ?? year < currentYear;
  const toggleYear = (year: string) =>
    setCollapsed((prev) => ({ ...prev, [year]: !isCollapsed(year) }));

  const toggleGoal = (id: string, exGoalIds: string[] | undefined, goalId: string) => {
    // 空/缺省 = 全部目标；点选目标 chip 在"全部"与具体集合之间切换
    const cur = new Set(exGoalIds && exGoalIds.length > 0 ? exGoalIds : goalList.map((g) => g.id));
    if (cur.has(goalId)) cur.delete(goalId);
    else cur.add(goalId);
    const next = [...cur];
    updateExemption(id, {
      goalIds: next.length === goalList.length ? undefined : next,
    });
  };

  const renderRow = (ex: ExemptionPeriod) => {
    const scoped = ex.goalIds && ex.goalIds.length > 0;
    return (
          <div
            key={ex.id}
            className="flex flex-col gap-2 border p-2.5"
            style={{ borderColor: 'var(--border-subtle)', borderRadius: 'var(--radius-md)' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={ex.startDate}
                onChange={(e) => e.target.value && updateExemption(ex.id, { startDate: e.target.value })}
                className="tnum"
                style={inputStyle}
                aria-label="开始日期"
              />
              <span style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>至</span>
              <input
                type="date"
                value={ex.endDate}
                min={ex.startDate}
                onChange={(e) => e.target.value && updateExemption(ex.id, { endDate: e.target.value })}
                className="tnum"
                style={inputStyle}
                aria-label="结束日期"
              />
              <input
                defaultValue={ex.reason ?? ''}
                key={`${ex.id}-${ex.reason ?? ''}`}
                placeholder="原因（如 出差）"
                onBlur={(e) => {
                  const reason = e.target.value.trim() || undefined;
                  if (reason !== ex.reason) updateExemption(ex.id, { reason });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                }}
                className="min-w-24 flex-1 outline-none"
                style={inputStyle}
              />
              {today >= ex.startDate && today <= ex.endDate && (
                <span
                  className="px-1.5 py-0.5"
                  style={{
                    fontSize: 'var(--font-11)',
                    color: 'var(--accent)',
                    background: 'var(--accent-soft)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  进行中
                </span>
              )}
              <button
                type="button"
                onClick={() => deleteExemption(ex.id)}
                className="cursor-pointer px-1.5"
                style={{ fontSize: 'var(--font-12)', color: 'var(--danger)' }}
              >
                删除
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
                {scoped ? '仅限' : '全部目标'}
              </span>
              {goalList.map((g) => {
                const active = !scoped || ex.goalIds!.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGoal(ex.id, ex.goalIds, g.id)}
                    className="cursor-pointer px-1.5 py-0.5 transition-colors"
                    style={{
                      fontSize: 'var(--font-11)',
                      border: `1px solid ${active ? goalColor(g.color) : 'var(--border-default)'}`,
                      borderRadius: 999,
                      background: active
                        ? `color-mix(in srgb, ${goalColor(g.color)} 12%, transparent)`
                        : 'transparent',
                      color: active ? 'var(--text-primary)' : 'var(--text-disabled)',
                    }}
                  >
                    {g.icon} {g.name}
                  </button>
                );
              })}
            </div>
          </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {list.length === 0 && (
        <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
          还没有免打卡区间。出差、生病、假期时添加，期间不判缺卡、不断 streak。
        </p>
      )}
      {groups.map((group) => {
        const open = !isCollapsed(group.year);
        return (
          <div key={group.year} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => toggleYear(group.year)}
              className="flex cursor-pointer items-center gap-2 py-0.5 text-left"
              style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}
            >
              <span style={{ width: 10, color: 'var(--text-tertiary)' }}>{open ? '▾' : '▸'}</span>
              <span className="font-medium">{group.year} 年</span>
              <span className="tnum" style={{ color: 'var(--text-tertiary)' }}>
                · {group.items.length} 段 · 共 {group.days} 天
              </span>
            </button>
            {open && group.items.map((ex) => renderRow(ex))}
          </div>
        );
      })}
      {adding ? (
        <AddRow
          onDone={(start, end, reason) => {
            createExemption(start, end, reason);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start cursor-pointer px-3 py-1"
          style={{
            fontSize: 'var(--font-13)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-panel)',
            color: 'var(--text-secondary)',
          }}
        >
          + 添加免打卡区间
        </button>
      )}
    </div>
  );
}

function AddRow({
  onDone,
  onCancel,
}: {
  onDone: (start: string, end: string, reason?: string) => void;
  onCancel: () => void;
}) {
  const today = todayStr();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(fmtDay(toDay(today).add(2, 'day')));
  const [reason, setReason] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={start}
        onChange={(e) => e.target.value && setStart(e.target.value)}
        className="tnum"
        style={inputStyle}
        aria-label="开始日期"
      />
      <span style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>至</span>
      <input
        type="date"
        value={end}
        min={start}
        onChange={(e) => e.target.value && setEnd(e.target.value)}
        className="tnum"
        style={inputStyle}
        aria-label="结束日期"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="原因（可选）"
        className="min-w-24 flex-1 outline-none"
        style={inputStyle}
      />
      <button
        type="button"
        onClick={() => onDone(start, end < start ? start : end, reason.trim() || undefined)}
        className="cursor-pointer px-3 py-1"
        style={{
          fontSize: 'var(--font-12)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--accent)',
          color: 'var(--text-on-accent)',
        }}
      >
        添加
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer px-2 py-1"
        style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
      >
        取消
      </button>
    </div>
  );
}
