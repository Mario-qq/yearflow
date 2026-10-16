/**
 * 一天一张卡：卡头 = 大号日期 + 星期 + 完成数 + 2px 进度线；卡身按天的位置分三种：
 * 过去 = 已完成前几条 +「↻ 没做完的挂到了今天」；今天 = 年度计划 / 例行 / 事项（含顺延）；以后 = 例行 / 事项。
 */
import { useStore } from '../store/useStore';
import { PAST_DONE_PREVIEW } from './constants';
import { isWeekendDate, weekdayCn } from './format';
import { PlanRows } from './PlanSection';
import type { PlanRowData } from './usePlanRows';
import { ItemRow, RoutineRow } from './Rows';
import type { DayData } from './useDeskData';
import { useDeskUi } from './uiStore';

function Sec({ title, n, children }: { title: string; n: string | number; children: React.ReactNode }) {
  return (
    <>
      <div className="dk-sec">
        {title}
        <span className="n tnum">{n}</span>
      </div>
      {children}
    </>
  );
}

function toggleFold(date: string) {
  const ui = useDeskUi.getState();
  const next = new Set(ui.openFolds);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  ui.set({ openFolds: next });
}

export function DayCard({ data, today, plan }: { data: DayData; today: string; plan?: PlanRowData[] }) {
  const { date, day, occ, count } = data;
  const mark = useStore((s) => s.dayMarks[date]);
  const folded = !useDeskUi((s) => s.openFolds.has(date));
  const past = date < today;
  const isToday = date === today;
  const weekend = isWeekendDate(date);
  const pct = count.total ? Math.round((count.done / count.total) * 100) : 0;

  let body: React.ReactNode;
  if (past) {
    const doneOcc = occ.filter((o) => o.status === 'done');
    const shown = folded ? day.done.slice(0, PAST_DONE_PREVIEW) : day.done;
    const hidden = folded ? day.done.length - shown.length + doneOcc.length : 0;
    const openN = day.open.length;
    const missed = occ.filter((o) => o.status === 'open' && (o.routine.rule.type === 'weekly' || o.routine.rule.type.startsWith('monthly')));
    body = (
      <>
        {!folded && doneOcc.map((o) => <RoutineRow key={`${o.routine.id}@${o.origDate}`} occ={o} date={date} today={today} />)}
        {shown.map((i) => (
          <ItemRow key={i.id} item={i} today={today} compact />
        ))}
        {hidden > 0 && (
          <button type="button" className="dk-fold tnum" onClick={() => toggleFold(date)}>
            还有 {hidden} 件已完成
          </button>
        )}
        {!folded && day.done.length + doneOcc.length > PAST_DONE_PREVIEW && (
          <button type="button" className="dk-fold" onClick={() => toggleFold(date)}>
            收起
          </button>
        )}
        {openN > 0 && <div className="dk-note">↻ {openN} 件没做完，挂到了今天</div>}
        {missed.length > 0 && <div className="dk-note">↻ {missed.map((o) => o.routine.title).join('、')} 漏了</div>}
        {shown.length === 0 && hidden === 0 && openN === 0 && missed.length === 0 && <div className="dk-empty">—</div>}
      </>
    );
  } else {
    const openOcc = isToday ? occ : occ.filter((o) => o.status !== 'done');
    const doneOccHidden = occ.length - openOcc.length;
    const items = [...day.rolled, ...day.open];
    body = (
      <>
        {isToday && plan && plan.length > 0 && (
          <Sec title="年度计划" n={`${plan.filter((p) => p.status === 'done' || p.status === 'skipped').length}/${plan.length}`}>
            <PlanRows rows={plan} today={today} />
          </Sec>
        )}
        {occ.length > 0 && (
          <Sec title="例行" n={`${occ.filter((o) => o.status === 'done').length}/${occ.length}`}>
            {openOcc.map((o) => (
              <RoutineRow key={`${o.routine.id}@${o.origDate}`} occ={o} date={date} today={today} />
            ))}
            {doneOccHidden > 0 && <div className="dk-empty">已做完 {doneOccHidden} 项</div>}
          </Sec>
        )}
        {(items.length > 0 || day.done.length > 0) && (
          <Sec title="事项" n={items.length}>
            {day.rolled.map((i) => (
              <ItemRow key={i.id} item={i} today={today} rolled />
            ))}
            {day.open.map((i) => (
              <ItemRow key={i.id} item={i} today={today} weekend={weekend} />
            ))}
            {day.done.length > 0 && (
              <button type="button" className="dk-fold tnum" onClick={() => toggleFold(date)}>
                已完成 {day.done.length} {folded ? '▸' : '▾'}
              </button>
            )}
            {!folded && day.done.map((i) => <ItemRow key={i.id} item={i} today={today} weekend={weekend} />)}
          </Sec>
        )}
        {occ.length === 0 && items.length === 0 && day.done.length === 0 && !(isToday && plan?.length) && <div className="dk-empty">空</div>}
      </>
    );
  }

  return (
    <div className={['dk-day', weekend ? 'weekend' : '', past ? 'past' : '', isToday ? 'today' : ''].join(' ')} data-day={date}>
      <div className="dk-dh">
        <div className="dk-dh-top">
          <span className="dk-dh-num tnum">{Number(date.slice(8, 10))}</span>
          <span className="dk-dh-wd">
            {isToday ? '今天 · ' : ''}
            {weekdayCn(date)}
          </span>
          {mark && <span className={`dk-mark ${mark.type}`}>{mark.type === 'off' ? '休' : '班'}</span>}
          <span className="dk-dh-cnt tnum">{past ? (count.done ? `${count.done} 完成` : '') : count.total ? `${count.done}/${count.total}` : ''}</span>
          <button
            type="button"
            className="dk-dh-menu"
            title="这天的批量操作"
            aria-label="这天的批量操作"
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              useDeskUi.getState().set({ menu: { kind: 'day', date, x: r.right - 210, y: r.bottom + 4 } });
            }}
          >
            ⋯
          </button>
        </div>
        <div className="dk-dh-prog">
          <i style={{ width: `${past && count.done ? 100 : pct}%` }} />
        </div>
      </div>
      <div className="dk-db">{body}</div>
    </div>
  );
}
