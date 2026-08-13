/**
 * 年报顶部条（规格 §4.1）：年份下拉 · 区间切换 · 「统计截至 X 月 X 日」标注。
 * 导出长图 / 打印按钮是 Y3 的范围，这里不放占位按钮（宁可没有，不要假的）。
 */
import type { RangeKind } from '../lib/derive/annual';
import { RANGE_LABEL, RANGE_ORDER } from './format';

interface Props {
  year: number;
  kind: RangeKind;
  /** 有数据的年份 ∪ 当年，降序 */
  years: number[];
  /** range.clipped && 区间已开始时给出 YYYY-MM-DD，否则 undefined */
  clippedEnd?: string;
  onYear: (year: number) => void;
  onKind: (kind: RangeKind) => void;
}

export function AnnualTopBar({ year, kind, years, clippedEnd, onYear, onKind }: Props) {
  return (
    <div
      className="sticky top-0 z-10 flex flex-col gap-1.5 border-b pb-3"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
    >
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <h1 className="font-semibold" style={{ fontSize: 'var(--font-20)' }}>
          年报
        </h1>

        <label className="flex items-center gap-1">
          <span className="sr-only">选择年份</span>
          <select
            value={year}
            onChange={(e) => onYear(Number(e.target.value))}
            className="tnum cursor-pointer px-2 py-1"
            style={{
              fontSize: 'var(--font-13)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-panel)',
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y} 年
              </option>
            ))}
          </select>
        </label>

        <div
          className="flex overflow-hidden border"
          style={{ borderColor: 'var(--border-default)', borderRadius: 'var(--radius-md)' }}
        >
          {RANGE_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKind(k)}
              className="cursor-pointer px-2.5 py-1"
              aria-pressed={kind === k}
              style={{
                fontSize: 'var(--font-13)',
                background: kind === k ? 'var(--accent-soft)' : 'transparent',
                color: kind === k ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
        </div>

        {/*
          规格 §4.1：缺了这行，「全年完成率 62%」会被读成「这一年只做到 62%」，
          而真相是年还没过完。这是可信度问题，不是装饰。
        */}
        {clippedEnd && (
          <span
            className="tnum ml-auto"
            style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
          >
            统计截至 {Number(clippedEnd.slice(5, 7))} 月 {Number(clippedEnd.slice(8, 10))} 日
          </span>
        )}
      </div>
      <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
        往下滚，读完这一年。月度数字去复盘页；这里只说复盘页说不了的。
      </p>
    </div>
  );
}
