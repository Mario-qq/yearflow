/** 顶部控制条：年份步进 + 区间分段选择 */
import type { RangeKind } from '../lib/derive/annual';
import { RANGE_LABEL, RANGE_ORDER } from './format';

export function Controls({
  year,
  years,
  kind,
  onYear,
  onKind,
}: {
  year: number;
  /** 可选年份，降序 */
  years: number[];
  kind: RangeKind;
  onYear: (y: number) => void;
  onKind: (k: RangeKind) => void;
}) {
  const i = years.indexOf(year);
  const older = i >= 0 && i < years.length - 1 ? years[i + 1] : undefined;
  const newer = i > 0 ? years[i - 1] : undefined;

  return (
    <nav className="yr-controls" aria-label="年报区间">
      <div className="yr-year-step">
        <button type="button" disabled={older === undefined} onClick={() => older !== undefined && onYear(older)} aria-label="上一年">
          ‹
        </button>
        <span className="tnum">{year}</span>
        <button type="button" disabled={newer === undefined} onClick={() => newer !== undefined && onYear(newer)} aria-label="下一年">
          ›
        </button>
      </div>
      <div className="yr-seg" role="tablist">
        {RANGE_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            className={k === kind ? 'is-on' : undefined}
            onClick={() => onKind(k)}
          >
            {RANGE_LABEL[k]}
          </button>
        ))}
      </div>
    </nav>
  );
}
