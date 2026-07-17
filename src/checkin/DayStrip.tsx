/**
 * 最近 7 天微型日历（SPEC 第五节）：每天一个完成率小环，点击切到那天补卡。
 */
import { memo } from 'react';
import { toDay } from '../lib/date';

const DOW_CN = ['日', '一', '二', '三', '四', '五', '六'];

export interface StripDay {
  date: string;
  /** 当日完成率 0-1；null = 无应打卡 */
  rate: number | null;
}

interface Props {
  days: StripDay[];
  selected: string;
  today: string;
  onSelect: (date: string) => void;
}

const R = 9;
const CIRC = 2 * Math.PI * R;

export const DayStrip = memo(function DayStrip({ days, selected, today, onSelect }: Props) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {days.map(({ date, rate }) => {
        const d = toDay(date);
        const isSelected = date === selected;
        const isToday = date === today;
        const pct = rate === null ? 0 : Math.min(1, rate);
        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelect(date)}
            className="flex min-h-11 min-w-11 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 transition-colors"
            style={{
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
              background: isSelected ? 'var(--accent-soft)' : 'transparent',
            }}
            title={date}
          >
            <span
              style={{
                fontSize: 'var(--font-11)',
                color: isToday ? 'var(--accent)' : 'var(--text-tertiary)',
              }}
            >
              {isToday ? '今' : DOW_CN[d.day()]}
            </span>
            <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
              <circle cx={12} cy={12} r={R} fill="none" stroke="var(--border-default)" strokeWidth={2} />
              {rate !== null && pct > 0 && (
                <circle
                  cx={12}
                  cy={12}
                  r={R}
                  fill="none"
                  stroke={pct >= 1 ? 'var(--success)' : 'var(--accent)'}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeDasharray={`${pct * CIRC} ${CIRC}`}
                  transform="rotate(-90 12 12)"
                />
              )}
              <text
                x={12}
                y={12}
                textAnchor="middle"
                dominantBaseline="central"
                className="tnum"
                style={{ fontSize: 9, fill: 'var(--text-secondary)' }}
              >
                {d.date()}
              </text>
            </svg>
          </button>
        );
      })}
    </div>
  );
});
