/**
 * 一天一张卡：卡头 = 大号日期 + 星期 + 完成数 + 2px 进度线；卡身自上而下：
 * 今天：日常习惯胶囊（不算待办）→ 要事（Ivy Lee，最多 3 件）→ 工作区 → 生活区（淡色底，不写字）→ 年度计划（今天，可收起、可筛选）。学习卡在头部。
 * 做完的就留在原区里打勾显示（一眼看到这周做了什么），不再折叠；只有「不做了」收在卡底。
 * 工作/生活两区都是拖放目标：拖进另一区 = 顺带改范围（拖动中空区也会露出来）。
 */
import type { WorkItem, WorkScope } from '../types/domain';
import type { RoutineOccurrence } from '../lib/derive/desk';
import { useStore } from '../store/useStore';
import { MAX_FOCUS } from '../lib/derive/desk';
import { isWeekendDate, weekdayCn } from './format';
import { PlanRows } from './PlanSection';
import type { PlanRowData } from './usePlanRows';
import { ItemRow, RoutineRow } from './Rows';
import { HabitStrip } from './Habits';
import type { DayData } from './useDeskData';
import { useDeskUi } from './uiStore';

function toggleFold(date: string) {
  const ui = useDeskUi.getState();
  const next = new Set(ui.openFolds);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  ui.set({ openFolds: next });
}

/** 先放没做完的（顺延来的在最前），再放做完的（按完成时间） */
function zoneOf(scope: WorkScope, data: DayData, focusIds: Set<string>, past: boolean) {
  const { day, occ } = data;
  const mine = (i: WorkItem) => i.scope === scope && !focusIds.has(i.id);
  const mineOcc = (o: RoutineOccurrence) => o.routine.scope === scope;
  const open = past ? [] : [...day.rolled.filter(mine), ...day.open.filter(mine)];
  const openOcc = past ? [] : occ.filter((o) => mineOcc(o) && o.status === 'open');
  const done = day.done.filter(mine).sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? ''));
  const doneOcc = occ.filter((o) => mineOcc(o) && o.status === 'done');
  const skipped = past ? [] : occ.filter((o) => mineOcc(o) && o.status === 'skipped');
  return { open, openOcc, done, doneOcc, skipped, n: open.length + openOcc.length + done.length + doneOcc.length + skipped.length };
}

function Zone({ scope, z, date, today }: { scope: WorkScope; z: ReturnType<typeof zoneOf>; date: string; today: string }) {
  const past = date < today;
  return (
    <div className={`dk-zone ${scope}${z.n === 0 ? ' empty' : ''}`} data-zone={scope} data-day={date}>
      {z.open.map((i) => (
        <ItemRow key={i.id} item={i} today={today} rolled={i.date !== date} inZone />
      ))}
      {z.openOcc.map((o) => (
        <RoutineRow key={`${o.routine.id}@${o.origDate}`} occ={o} date={date} today={today} inZone />
      ))}
      {z.done.map((i) => (
        <ItemRow key={i.id} item={i} today={today} compact={past} inZone />
      ))}
      {z.doneOcc.map((o) => (
        <RoutineRow key={`${o.routine.id}@${o.origDate}`} occ={o} date={date} today={today} inZone />
      ))}
      {z.skipped.map((o) => (
        <RoutineRow key={`${o.routine.id}@${o.origDate}`} occ={o} date={date} today={today} inZone />
      ))}
    </div>
  );
}

function openQuickAdd(date: string) {
  useDeskUi.getState().set({ quickAdd: true, qaPreset: { date, scope: isWeekendDate(date) ? 'life' : undefined }, menu: null });
}

/** 收起的周末：一根窄条（日期 + 件数点），仍是拖放目标；点一下展开周末 */
function Rail({ data, today }: { data: DayData; today: string }) {
  const { date, count } = data;
  const left = date < today ? 0 : count.total - count.done;
  return (
    <button
      type="button"
      className={['dk-day rail', date < today ? 'past' : ''].join(' ')}
      data-day={date}
      title={`${weekdayCn(date)} ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}${left ? ` · ${left} 件没做` : ''}${count.done ? ` · 做完 ${count.done}` : ''}\n点击展开周末`}
      onClick={() => useDeskUi.getState().toggleWeekend()}
    >
      <span className="dk-dh-num tnum">{Number(date.slice(8, 10))}</span>
      <span className="dk-rail-wd">{weekdayCn(date).slice(1)}</span>
      {left > 0 && <span className="dk-rail-n tnum">{left}</span>}
      {left === 0 && count.done > 0 && <span className="dk-rail-ok" aria-hidden />}
    </button>
  );
}

export function DayCard({ data, today, plan, planHidden, rail }: { data: DayData; today: string; plan?: PlanRowData[]; planHidden?: number; rail?: boolean }) {
  const { date, day, occ, count, focus } = data;
  const mark = useStore((s) => s.dayMarks[date]);
  const droppedOpen = useDeskUi((s) => s.openFolds.has(date));
  const planFolded = useDeskUi((s) => s.planFolded);
  const togglePlanFold = useDeskUi((s) => s.togglePlanFold);
  if (rail) return <Rail data={data} today={today} />;

  const past = date < today;
  const isToday = date === today;
  const weekend = isWeekendDate(date);
  const pct = count.total ? Math.round((count.done / count.total) * 100) : 0;

  const focusIds = new Set(focus.map((i) => i.id));
  const work = zoneOf('work', data, focusIds, past);
  const life = zoneOf('life', data, focusIds, past);
  const openN = past ? day.open.length : 0;
  const missed = past ? occ.filter((o) => o.status === 'open' && (o.routine.rule.type === 'weekly' || o.routine.rule.type.startsWith('monthly'))) : [];
  const focusDone = focus.filter((i) => i.status === 'done').length;
  const canPickFocus = isToday && focus.length < MAX_FOCUS && day.rolled.length + day.open.length > focus.filter((i) => i.status === 'open').length;
  const empty = focus.length === 0 && work.n === 0 && life.n === 0 && day.dropped.length === 0 && openN === 0 && missed.length === 0 && !(isToday && plan?.length);

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
          {!past && (
            <button
              type="button"
              className="dk-dh-add"
              title="在这天新建"
              aria-label="在这天新建"
              onClick={(e) => {
                e.stopPropagation();
                openQuickAdd(date);
              }}
            >
              ＋
            </button>
          )}
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
      <div className="dk-db">
        {isToday && <HabitStrip today={today} />}
        {/* 今天及以后每天都有要事区（空的平时藏着，拖动中露出来当落点：拖进来 = 设为那天要事） */}
        {(focus.length > 0 || canPickFocus || !past) && (
          <div className={`dk-focus${focus.length > 0 || canPickFocus ? '' : ' empty'}`} data-zone-focus={date} data-day={past ? undefined : date}>
            <div className="dk-focus-h">
              <span>要事</span>
              {focus.length > 0 && (
                <span className="n tnum">
                  {focusDone}/{focus.length}
                </span>
              )}
              <span className="dk-grow" />
              {canPickFocus && (
                <button
                  type="button"
                  className="dk-focus-pick"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    useDeskUi.getState().set({ focusPicker: { date, left: r.left, top: r.bottom + 4 }, menu: null });
                  }}
                >
                  {focus.length ? '再挑' : `挑今天最要紧的 ${MAX_FOCUS} 件`}
                </button>
              )}
              {focus.length === 0 && <span className="dk-focus-hint">拖到这里设为要事</span>}
            </div>
            {focus.map((i) => (
              <ItemRow key={i.id} item={i} today={today} rolled={i.date !== date} inFocus compact={past} />
            ))}
          </div>
        )}
        <Zone scope="work" z={work} date={date} today={today} />
        <Zone scope="life" z={life} date={date} today={today} />
        {openN > 0 && <div className="dk-note">↻ {openN} 件没做完，挂到了今天</div>}
        {missed.length > 0 && <div className="dk-note">↻ {missed.map((o) => o.routine.title).join('、')} 漏了</div>}
        {day.dropped.length > 0 && (
          <>
            <button type="button" className="dk-fold tnum" onClick={() => toggleFold(date)}>
              不做了 {day.dropped.length} {droppedOpen ? '▾' : '▸'}
            </button>
            {droppedOpen && day.dropped.map((i) => <ItemRow key={i.id} item={i} today={today} compact={past} />)}
          </>
        )}
        {isToday && plan && (plan.length > 0 || (planHidden ?? 0) > 0) && (
          <div className="dk-plan">
            <div className="dk-sec">
              <button type="button" className="dk-sec-t" aria-expanded={!planFolded} onClick={togglePlanFold} title={planFolded ? '展开' : '收起'}>
                年度计划
                <span className="n tnum">
                  {plan.filter((p) => p.status === 'done' || p.status === 'skipped').length}/{plan.length}
                </span>
                <span className="caret">{planFolded ? '▸' : '▾'}</span>
              </button>
              <span className="dk-grow" />
              <button
                type="button"
                className="dk-sec-act tnum"
                title="选择哪些年度计划在这里显示"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  useDeskUi.getState().set({ planPicker: { left: r.right, top: r.bottom + 4 }, menu: null });
                }}
              >
                {planHidden ? `已隐藏 ${planHidden} · ` : ''}选择显示
              </button>
            </div>
            {!planFolded && <PlanRows rows={plan} today={today} />}
          </div>
        )}
        {empty && <div className="dk-empty">{past ? '—' : '空'}</div>}
      </div>
    </div>
  );
}
