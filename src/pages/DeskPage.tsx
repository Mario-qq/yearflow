/**
 * 个人主工作台 /desk（DESK_SPEC，版式以 docs/desk/w0-prototype.html v2 为准）。
 * 电脑宽度才有；手机打开直接回打卡页（负责人：手机端不显示工作台）。
 */
import { useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { fmtDay, toDay } from '../lib/date';
import { addDays, pendingItems, weekMonday } from '../lib/derive/desk';
import { useIsMobile } from '../lib/useIsMobile';
import { DeskHero } from '../desk/DeskHero';
import { DeskMenus } from '../desk/DeskMenus';
import { md } from '../desk/format';
import { MonthView } from '../desk/MonthView';
import { Mover } from '../desk/Mover';
import { PendingDrawer } from '../desk/PendingDrawer';
import { PersonCard } from '../desk/PersonCard';
import { usePlanRows } from '../desk/usePlanRows';
import { QuickAdd } from '../desk/QuickAdd';
import { SelectionBar } from '../desk/SelectionBar';
import { closeOverlays, useDeskUi } from '../desk/uiStore';
import { useDeskData } from '../desk/useDeskData';
import { useDeskDrag } from '../desk/useDeskDrag';
import { useDeskKeys } from '../desk/useDeskKeys';
import { WeekBoard } from '../desk/WeekBoard';
import '../desk/desk.css';

export default function DeskPage() {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const { today, items, dayOf } = useDeskData();
  const plan = usePlanRows(today);
  const view = useDeskUi((s) => s.view);
  const anchor = useDeskUi((s) => s.anchor) ?? today;
  const drawer = useDeskUi((s) => s.drawer);
  const dragging = useDeskUi((s) => s.dragging);
  const pendingN = pendingItems(items, today).length;

  const monday = weekMonday(anchor);
  const step = useCallback(
    (n: number) => {
      const ui = useDeskUi.getState();
      const a = ui.anchor ?? today;
      ui.set({ anchor: ui.view === 'week' ? addDays(weekMonday(a), 7 * n) : fmtDay(toDay(a).startOf('month').add(n, 'month')) });
    },
    [today],
  );
  const goToday = useCallback(() => useDeskUi.getState().set({ anchor: null }), []);

  useDeskDrag(rootRef, today);
  useDeskKeys(today, step, goToday);

  if (isMobile) return <Navigate to="/checkin" replace />;

  const thisWeek = monday === weekMonday(today);
  const label =
    view === 'week'
      ? `${thisWeek ? '本周 · ' : ''}${md(monday)}–${md(addDays(monday, 6))}`
      : `${toDay(anchor).year()} 年 ${toDay(anchor).month() + 1} 月`;

  return (
    <div
      ref={rootRef}
      className={`dk${dragging ? ' dragging' : ''}`}
      onClick={(e) => {
        // 点浮层以外的任何地方先收起浮层（菜单、小月历、人物卡、新建卡）；
        // 点的是空白（不是行、按钮、选中条、抽屉）且没有浮层可收时，取消选择
        const t = e.target as Element;
        if (t.closest('.dk-menu, .dk-pop, .dk-mover, .dk-qa, .dk-selbar')) return;
        const ui = useDeskUi.getState();
        const hadOverlay = Boolean(ui.menu || ui.mover || ui.person || ui.quickAdd);
        if (hadOverlay) closeOverlays();
        if (!hadOverlay && ui.sel.size && !t.closest('.dk-row, button, input, .dk-drawer')) ui.set({ sel: new Set() });
      }}
    >
      <DeskHero today={today} items={items} dayOf={dayOf} plan={plan} />

      <div className="dk-bar">
        <button type="button" className="dk-arrow" title="上一段（←）" aria-label="上一段" onClick={() => step(-1)}>
          ‹
        </button>
        <span className="dk-label tnum">{label}</span>
        <button type="button" className="dk-arrow" title="下一段（→）" aria-label="下一段" onClick={() => step(1)}>
          ›
        </button>
        <button type="button" className="dk-btn ghost" onClick={goToday}>
          今天 <kbd>T</kbd>
        </button>
        <div className="dk-seg" role="tablist" style={{ marginLeft: 4 }}>
          <button type="button" className={view === 'week' ? 'on' : ''} title="周（W）" onClick={() => useDeskUi.getState().setView('week')}>
            周
          </button>
          <button type="button" className={view === 'month' ? 'on' : ''} title="月（M）" onClick={() => useDeskUi.getState().setView('month')}>
            月
          </button>
        </div>
        <span className="dk-grow" />
        <button type="button" className="dk-btn" title="没排日子的事（I）" onClick={() => useDeskUi.getState().set({ drawer: !drawer })}>
          待处理 {pendingN > 0 && <span className="dk-badge tnum">{pendingN}</span>}
        </button>
      </div>

      <div className="dk-stage">
        {view === 'week' ? (
          <WeekBoard monday={monday} today={today} dayOf={dayOf} plan={plan} />
        ) : (
          <MonthView anchor={anchor} today={today} dayOf={dayOf} />
        )}
        <QuickAdd today={today} />
        <PendingDrawer items={items} today={today} />
      </div>

      <Mover today={today} dayOf={dayOf} />
      <SelectionBar today={today} />
      <DeskMenus today={today} dayOf={dayOf} />
      <PersonCard items={items} today={today} />
    </div>
  );
}
