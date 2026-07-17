/**
 * 批量补卡对话框（SPEC 第六节）：日期范围 × 勾选目标 → 批量标 done/skipped。
 * 实时预览将补条数（dryRun），确认一条命令写入。
 */
import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { fmtDay, toDay, todayStr } from '../lib/date';
import { goalColor } from '../lib/colors';
import { batchCheckIn } from '../store/actions';
import { showToast } from '../lib/toast';

interface Props {
  open: boolean;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  fontSize: 'var(--font-13)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-primary)',
  padding: '4px 8px',
};

export function BackfillDialog({ open, onClose }: Props) {
  const goals = useStore((s) => s.goals);
  // 实时预览依赖最新数据：订阅触发重算即可
  useStore((s) => s.checkIns);

  const today = todayStr();
  const [startDate, setStartDate] = useState(() => fmtDay(toDay(today).subtract(6, 'day')));
  const [endDate, setEndDate] = useState(today);
  const [status, setStatus] = useState<'done' | 'skipped'>('done');
  const goalList = useMemo(
    () =>
      Object.values(goals)
        .filter((g) => !g.deletedAt && !g.archived)
        .sort((a, b) => a.order - b.order),
    [goals],
  );
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = 全选
  const selectedIds = useMemo(
    () => (selected ? goalList.filter((g) => selected.has(g.id)) : goalList).map((g) => g.id),
    [selected, goalList],
  );

  const previewCount = useMemo(() => {
    if (!open || startDate > endDate) return 0;
    return batchCheckIn({ startDate, endDate, goalIds: selectedIds, status }, true);
  }, [open, startDate, endDate, selectedIds, status]);

  if (!open) return null;

  const toggleGoal = (id: string) => {
    const next = new Set(selected ?? goalList.map((g) => g.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const submit = () => {
    const n = batchCheckIn({ startDate, endDate, goalIds: selectedIds, status });
    showToast(n > 0 ? `已补 ${n} 条打卡记录` : '所选范围没有可补的缺卡');
    if (n > 0) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.35)' }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        className="flex w-96 max-w-[calc(100vw-32px)] flex-col gap-3 border p-4"
        style={{
          borderColor: 'var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-raised)',
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="批量补卡"
      >
        <h2 className="font-medium" style={{ fontSize: 'var(--font-14)' }}>
          批量补卡
        </h2>

        <div className="flex items-center gap-2" style={{ fontSize: 'var(--font-13)' }}>
          <input
            type="date"
            value={startDate}
            max={today}
            onChange={(e) => e.target.value && setStartDate(e.target.value)}
            className="tnum flex-1"
            style={inputStyle}
            aria-label="开始日期"
          />
          <span style={{ color: 'var(--text-tertiary)' }}>至</span>
          <input
            type="date"
            value={endDate}
            max={today}
            onChange={(e) => e.target.value && setEndDate(e.target.value)}
            className="tnum flex-1"
            style={inputStyle}
            aria-label="结束日期"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {goalList.map((g) => {
            const active = selectedIds.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGoal(g.id)}
                className="flex cursor-pointer items-center gap-1.5 px-2 py-1 transition-colors"
                style={{
                  fontSize: 'var(--font-12)',
                  border: `1px solid ${active ? goalColor(g.color) : 'var(--border-default)'}`,
                  borderRadius: 999,
                  background: active
                    ? `color-mix(in srgb, ${goalColor(g.color)} 12%, transparent)`
                    : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}
              >
                <span aria-hidden>{g.icon}</span>
                {g.name}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2" style={{ fontSize: 'var(--font-13)' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>标记为</span>
          {(['done', 'skipped'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setStatus(v)}
              className="cursor-pointer px-3 py-1 transition-colors"
              style={{
                fontSize: 'var(--font-13)',
                border: `1px solid ${status === v ? 'var(--accent)' : 'var(--border-default)'}`,
                borderRadius: 'var(--radius-md)',
                background: status === v ? 'var(--accent-soft)' : 'transparent',
                color: status === v ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {v === 'done' ? '✓ 完成' : '— 跳过'}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="tnum" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            将补 {previewCount} 条缺卡记录（已有记录与休息中不覆盖）
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer px-3 py-1.5"
              style={{
                fontSize: 'var(--font-13)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                color: 'var(--text-secondary)',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={previewCount === 0}
              className="px-3 py-1.5"
              style={{
                fontSize: 'var(--font-13)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent)',
                color: 'var(--text-on-accent)',
                cursor: previewCount === 0 ? 'not-allowed' : 'pointer',
                opacity: previewCount === 0 ? 0.5 : 1,
              }}
            >
              补卡
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
