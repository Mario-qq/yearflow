/**
 * 年报顶部条（规格 §4.1）：年份下拉 · 区间切换 · 「统计截至 X 月 X 日」标注
 * · 导出长图 · 打印。
 *
 * 整条挂 `data-annual-noprint`：打印时它连同 App 顶栏一起消失（纸上点不了），
 * 页面标题由 YearReportPage 的打印专用行接管。
 * 导出/打印按钮 <768px 隐藏 —— v1 桌面优先，不打磨也不假装可用（规格 §5.3）。
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
  /** 导出长图；空态下由页面传 undefined ⇒ 不渲染按钮 */
  onExport?: () => void;
  onPrint?: () => void;
  exporting?: boolean;
}

const ACTION_STYLE = {
  fontSize: 'var(--font-12)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
} as const;

export function AnnualTopBar({
  year,
  kind,
  years,
  clippedEnd,
  onYear,
  onKind,
  onExport,
  onPrint,
  exporting,
}: Props) {
  return (
    <div
      className="sticky top-0 z-10 flex flex-col gap-1.5 border-b pb-3"
      data-annual-noprint
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

        <div className={`flex items-center gap-2 max-md:hidden${clippedEnd ? '' : ' ml-auto'}`}>
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              className="cursor-pointer px-2.5 py-1"
              style={{ ...ACTION_STYLE, opacity: exporting ? 0.6 : 1 }}
              title="把整页导出成一张 900px 宽的长图 PNG"
            >
              {exporting ? '导出中…' : '导出长图'}
            </button>
          )}
          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="cursor-pointer px-2.5 py-1"
              style={ACTION_STYLE}
              title="打印（自动转浅色、按 beat 分页）"
            >
              打印
            </button>
          )}
        </div>
      </div>
      {/*
        这行是一次性引导，不是数据。整条顶部条是 sticky ⇒ 它会永久占掉屏高：
        375×812 上连年份带区间已经吃掉约 150px，再加两行说明就把首屏挤没了。
        窄屏隐藏（规格 §5.3 桌面优先）。
      */}
      <p
        className="max-md:hidden"
        style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
      >
        往下滚，读完这一年。月度数字去复盘页；这里只说复盘页说不了的。
      </p>
    </div>
  );
}
