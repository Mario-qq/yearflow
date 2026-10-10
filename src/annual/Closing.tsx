/** 结尾：区间还在进行 ⇒ 还剩多少天；已走完 ⇒ 收笔 */
import type { CSSProperties } from 'react';
import type { AnnualIndex } from '../lib/derive/annual';
import { pctOf, RANGE_LABEL, rangeNoun } from './format';
import { useInView } from './hooks';

export function Closing({ idx, palette }: { idx: AnnualIndex; palette: string[] }) {
  const [ref, inView] = useInView<HTMLElement>();
  const { range, totalDays, elapsedDays } = idx;
  const left = totalDays - elapsedDays;
  const name = range.kind === 'full' ? `${range.year}` : `${range.year} ${RANGE_LABEL[range.kind]}`;
  const style = {
    '--c1': palette[0],
    '--c2': palette[1],
    '--c3': palette[2],
    '--elapsed': `${pctOf(elapsedDays / totalDays)}%`,
  } as CSSProperties;

  return (
    <footer ref={ref} className={`yr-closing${inView ? ' is-in' : ''}`} style={style}>
      {left > 0 ? (
        <>
          <p className="yr-closing-line">
            <span className="yr-closing-year tnum">{name}</span>，还剩 <b className="tnum">{left}</b> 天。
          </p>
          <p className="yr-closing-sub">剩下的，慢慢写。</p>
        </>
      ) : (
        <>
          <p className="yr-closing-line">
            <span className="yr-closing-year tnum">{name}</span>，写完了。
          </p>
          <p className="yr-closing-sub">谢谢{rangeNoun(range.kind)}一直在场的自己。</p>
        </>
      )}
      <div className="yr-closing-bar" aria-hidden>
        <span />
      </div>
    </footer>
  );
}
