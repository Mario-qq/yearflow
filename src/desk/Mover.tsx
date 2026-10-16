/**
 * 「挪到…」小月历：拖动任何一行时浮在右下角（新建按钮上方），选中后按 D /「挪到…」时挂在按钮旁。
 * 从本周一起 5 周，每格 = 日期 + 已排件数的小点（红点 = 紧急），过去的日子不可落；底部一条「放进待处理」。
 * 拖动模式下的悬停高亮与顶部提示由 useDeskDrag 直接改 DOM（60fps，不走 React 重绘）。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { addDays, weekMonday } from '../lib/derive/desk';
import { moveKeys } from '../store/deskActions';
import { MOVER_W, MOVER_WEEKS } from './constants';
import { isWeekendDate, md, toastMove, weekdayCn } from './format';
import { parseKeys } from './keys';
import type { DayData } from './useDeskData';
import { useDeskUi } from './uiStore';

const HEAD = ['一', '二', '三', '四', '五', '六', '日'];
const EDGE = 8;

export function Mover({ today, dayOf }: { today: string; dayOf: (d: string) => DayData }) {
  const mover = useDeskUi((s) => s.mover);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!mover || !el) return setPos(null);
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (mover.anchor) {
      left = mover.anchor.left;
      top = mover.anchor.top - h - 10;
      if (top < EDGE) top = mover.anchor.bottom + 10;
    } else {
      const stage = document.querySelector('.dk-stage')?.getBoundingClientRect();
      left = (stage?.right ?? window.innerWidth) - MOVER_W - 20;
      top = (stage?.bottom ?? window.innerHeight) - h - 70; // 新建按钮上方
    }
    setPos({
      left: Math.max(EDGE, Math.min(left, window.innerWidth - MOVER_W - EDGE)),
      top: Math.max(EDGE, Math.min(top, window.innerHeight - h - EDGE)),
    });
  }, [mover]);

  if (!mover) return null;
  const monday = weekMonday(today);
  const pick = (to: string | null) => {
    if (mover.mode !== 'click') return;
    const r = moveKeys(parseKeys(mover.keys), to);
    useDeskUi.getState().set({ mover: null, sel: new Set() });
    toastMove(to, today, r);
  };

  const cells: React.ReactNode[] = [<span key="corner" />, ...HEAD.map((c) => <span key={c} className="hd">{c}</span>)];
  for (let w = 0; w < MOVER_WEEKS; w++) {
    const wkStart = addDays(monday, w * 7);
    cells.push(
      <span key={`wl${w}`} className="wl tnum">
        {w === 0 ? '本周' : w === 1 ? '下周' : md(wkStart)}
      </span>,
    );
    for (let n = 0; n < 7; n++) {
      const date = addDays(wkStart, n);
      const past = date < today;
      const d = past ? null : dayOf(date);
      const open = d ? d.count.total - d.count.done : 0;
      cells.push(
        <button
          key={date}
          type="button"
          className={['dk-mvd', isWeekendDate(date) ? 'we' : '', past ? 'past' : '', date === today ? 'today' : ''].join(' ')}
          data-mv={date}
          title={`${md(date)} ${weekdayCn(date)} · 已排 ${open} 件`}
          onClick={() => pick(date)}
        >
          <span className="tnum">{Number(date.slice(8, 10))}</span>
          <span className="ld">
            {Array.from({ length: Math.min(4, open) }, (_, x) => (
              <i key={x} className={d && x < d.hot ? 'hot' : ''} />
            ))}
          </span>
        </button>,
      );
    }
  }

  return (
    <div
      ref={ref}
      className="dk-mover"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dk-mv-h">
        <b>{mover.mode === 'drag' ? '挪到哪天？' : `把 ${mover.keys.length} 件挪到…`}</b>
        <span>{mover.mode === 'drag' ? '松手即排上 · Esc 取消' : '点一天 · Esc 取消'}</span>
      </div>
      <div className="dk-mv-target" data-mv-tip>
        {' '}
      </div>
      <div className="dk-mv-grid">{cells}</div>
      <button type="button" className="dk-mv-zone" data-mv-pending onClick={() => pick(null)}>
        放进待处理
      </button>
    </div>
  );
}
