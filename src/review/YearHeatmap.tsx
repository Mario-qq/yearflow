/**
 * GitHub 风格年度贡献热力图（SPEC 第七节）：全目标合计 + 单目标切换。
 * 日分值 = 各目标最强记录 done=1、partial=0.5 求和；色阶四档按当年最大值归一。
 */
import { memo, useMemo, useState } from 'react';
import type { CheckIn, Goal } from '../types/domain';
import { dailyActivityScores } from '../lib/derive';
import { goalColor, goalColorAlpha } from '../lib/colors';
import { eachDay, toDay, weekStartOf } from '../lib/date';

const CELL = 11;
const GAP = 2;
const LEVEL_ALPHA = [30, 55, 78, 100];
const DOW_LABEL: Record<number, string> = { 1: '一', 3: '三', 5: '五' };

interface Props {
  year: number;
  checkIns: CheckIn[];
  goals: Goal[];
  weekStartsOn: 0 | 1;
}

export const YearHeatmap = memo(function YearHeatmap({ year, checkIns, goals, weekStartsOn }: Props) {
  const [goalId, setGoalId] = useState<string | null>(null);

  const scores = useMemo(
    () => dailyActivityScores(checkIns, year, goalId ?? undefined),
    [checkIns, year, goalId],
  );
  const max = useMemo(() => Math.max(1, ...scores.values()), [scores]);

  const { cells, monthLabels, weeks } = useMemo(() => {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const firstWeek = weekStartOf(start, weekStartsOn);
    const out: { date: string; col: number; row: number; score: number }[] = [];
    const months: { col: number; label: string }[] = [];
    let lastMonth = '';
    let maxCol = 0;
    for (const date of eachDay(start, end)) {
      const ws = weekStartOf(date, weekStartsOn);
      const col = toDay(ws).diff(toDay(firstWeek), 'week');
      const row = (toDay(date).day() - weekStartsOn + 7) % 7;
      maxCol = col;
      const m = date.slice(0, 7);
      if (m !== lastMonth) {
        lastMonth = m;
        months.push({ col, label: `${Number(date.slice(5, 7))}月` });
      }
      out.push({ date, col, row, score: scores.get(date) ?? 0 });
    }
    return { cells: out, monthLabels: months, weeks: maxCol + 1 };
  }, [year, weekStartsOn, scores]);

  const color = goalId ? goals.find((g) => g.id === goalId)?.color : null;
  const fillFor = (score: number): string => {
    if (score <= 0) return 'var(--bg-subtle)';
    const level = Math.min(3, Math.ceil((score / max) * 4) - 1);
    return color ? goalColorAlpha(color, LEVEL_ALPHA[level]) : `color-mix(in srgb, var(--accent) ${LEVEL_ALPHA[level]}%, transparent)`;
  };

  const width = 20 + weeks * (CELL + GAP);
  const height = 16 + 7 * (CELL + GAP);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setGoalId(null)}
          className="cursor-pointer px-2 py-0.5 transition-colors"
          style={{
            fontSize: 'var(--font-12)',
            border: `1px solid ${goalId === null ? 'var(--accent)' : 'var(--border-default)'}`,
            borderRadius: 999,
            background: goalId === null ? 'var(--accent-soft)' : 'transparent',
            color: goalId === null ? 'var(--accent)' : 'var(--text-secondary)',
          }}
        >
          全部目标
        </button>
        {goals.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGoalId(g.id)}
            className="cursor-pointer px-2 py-0.5 transition-colors"
            style={{
              fontSize: 'var(--font-12)',
              border: `1px solid ${goalId === g.id ? goalColor(g.color) : 'var(--border-default)'}`,
              borderRadius: 999,
              background: goalId === g.id ? goalColorAlpha(g.color, 12) : 'transparent',
              color: goalId === g.id ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {g.icon} {g.name}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg width={width} height={height} aria-hidden className="block">
          {monthLabels.map(({ col, label }) => (
            <text
              key={label}
              x={20 + col * (CELL + GAP)}
              y={10}
              style={{ fontSize: 'var(--font-11)', fill: 'var(--text-tertiary)' }}
            >
              {label}
            </text>
          ))}
          {[1, 3, 5].map((dow) => {
            const row = (dow - weekStartsOn + 7) % 7;
            return (
              <text
                key={dow}
                x={0}
                y={16 + row * (CELL + GAP) + CELL - 2}
                style={{ fontSize: 9, fill: 'var(--text-tertiary)' }}
              >
                {DOW_LABEL[dow]}
              </text>
            );
          })}
          {cells.map(({ date, col, row, score }) => (
            <rect
              key={date}
              x={20 + col * (CELL + GAP)}
              y={16 + row * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              fill={fillFor(score)}
            >
              <title>{`${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 · ${score} 分`}</title>
            </rect>
          ))}
        </svg>
      </div>
    </div>
  );
});
