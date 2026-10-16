/**
 * 月历：偶尔看全月、远期排期用。每格列前 3 件未完成 +「+N」，格子之间可以直接拖；
 * 过去的格只显示 ✓ 完成数；点「周 ›」跳回那一周。
 */
import { fmtDay, toDay } from '../lib/date';
import { addDays, weekMonday } from '../lib/derive/desk';
import { MONTH_CELL_ITEMS } from './constants';
import { isWeekendDate } from './format';
import { ItemRow } from './Rows';
import type { DayData } from './useDeskData';
import { useDeskUi } from './uiStore';
import { useStore } from '../store/useStore';

const HEAD = ['一', '二', '三', '四', '五', '六', '日'];

function goWeek(date: string) {
  useDeskUi.getState().set({ anchor: weekMonday(date) });
  useDeskUi.getState().setView('week');
}

export function MonthView({ anchor, today, dayOf }: { anchor: string; today: string; dayOf: (d: string) => DayData }) {
  const marks = useStore((s) => s.dayMarks);
  const a = toDay(anchor);
  const month = a.month();
  const start = weekMonday(fmtDay(a.startOf('month')));
  const lastWeekStart = weekMonday(fmtDay(a.endOf('month')));
  const weeks = (toDay(lastWeekStart).diff(toDay(start), 'day') / 7) | 0;
  const cells = Array.from({ length: (weeks + 1) * 7 }, (_, n) => addDays(start, n));

  return (
    <div className="dk-month">
      <div className="dk-mh">
        {HEAD.map((c) => (
          <span key={c}>周{c}</span>
        ))}
      </div>
      <div className="dk-mg">
        {cells.map((date) => {
          const d = dayOf(date);
          const out = toDay(date).month() !== month;
          const past = date < today;
          const open = [...d.day.rolled, ...d.day.open];
          const openOcc = d.occ.filter((o) => o.status === 'open').length;
          const more = open.length - Math.min(MONTH_CELL_ITEMS, open.length) + openOcc;
          const mark = marks[date];
          return (
            <div
              key={date}
              className={['dk-mc', out ? 'out' : '', isWeekendDate(date) ? 'weekend' : '', date === today ? 'today' : ''].join(' ')}
              data-day={date}
            >
              <div className="dk-mc-h">
                <span className="dk-mc-n tnum">{toDay(date).date() === 1 ? `${toDay(date).month() + 1}月1日` : toDay(date).date()}</span>
                {mark && <span className={`dk-mark ${mark.type}`}>{mark.type === 'off' ? '休' : '班'}</span>}
                <span className="dk-mc-c tnum">
                  {past ? (d.count.done ? `✓ ${d.count.done}` : '') : d.count.total - d.count.done ? `${d.count.total - d.count.done} 件` : ''}
                </span>
                <button type="button" className="dk-mc-go" title="打开这一周" onClick={() => goWeek(date)}>
                  周 ›
                </button>
              </div>
              {!past &&
                open.slice(0, MONTH_CELL_ITEMS).map((i) => <ItemRow key={i.id} item={i} today={today} rolled={date === today && i.date !== date} compact />)}
              {!past && more > 0 && (
                <button type="button" className="dk-mc-more" onClick={() => goWeek(date)}>
                  {open.length <= MONTH_CELL_ITEMS ? `${openOcc} 项例行` : `+${more} 件`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
