/**
 * 个人主工作台 /desk（DESK_SPEC，版式以 docs/desk/w0-prototype.html v2 为准）。
 * 电脑宽度才有；手机打开直接回打卡页（负责人：手机端不显示工作台）。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
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
import { OVERLAY_KEYS, useDeskUi } from '../desk/uiStore';
import { FocusPicker, PlanPicker } from '../desk/Pickers';
import { usePlanVisibility } from '../desk/pickModel';
import { ShutdownSheet } from '../desk/Shutdown';
import { useDeskData } from '../desk/useDeskData';
import { useDeskDrag } from '../desk/useDeskDrag';
import { useDeskKeys } from '../desk/useDeskKeys';
import { WeekBoard } from '../desk/WeekBoard';
import { useStudy } from '../desk/study';
import { StudySetupPop } from '../desk/StudySetup';
import { DeskEditorPop } from '../desk/Editors';
import { usePrepGeneration } from '../people/usePreps';
import { useStore } from '../store/useStore';
import { contactStates, DATE_SOON_DAYS, upcomingDates } from '../lib/derive/people';
import { HabitStrip } from '../desk/Habits';
import '../desk/desk.css';

// 人际弹窗低频：lazy 分包，点「人际」才拉
const PeopleModal = lazy(() => import('../people/PeopleModal'));

export default function DeskPage() {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const { today, items, dayOf } = useDeskData();
  const dueRows = usePlanRows(today);
  // 负责人可以选哪些年度计划在工作台显示（本机设置）
  const { visible: allPlan, hidden: planHidden } = usePlanVisibility(dueRows);
  const study = useStudy(today);
  // 重要日子进了 14 天窗口 ⇒ 倒推生成准备待办（人际 · PEOPLE_SPEC）
  usePrepGeneration(today);
  // 学习卡正在推荐/计时的那个任务不在「年度计划」里重复出现（学过之后它回到年度计划，显示已打卡）
  const hideTask = study.running?.taskId ?? (study.studied || !study.dueToday ? undefined : study.pick?.taskId);
  const plan = useMemo(() => (hideTask ? allPlan.filter((p) => p.taskId !== hideTask) : allPlan), [allPlan, hideTask]);
  const hideWeekend = useDeskUi((s) => s.hideWeekend);
  // 点空白收浮层：只收「这次点击之前就开着」的那些 —— 否则点「新建」「@人」这类打开浮层的按钮，
  // 冒泡上来会把刚打开的浮层当成旧的又关掉（「点新建没反应」就是这么来的）
  const overlaysAtClick = useRef<Partial<Record<(typeof OVERLAY_KEYS)[number], unknown>>>({});
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    // 桌面版收尾通知点进来：/desk?shutdown=1
    if (params.get('shutdown') !== '1') return;
    useDeskUi.getState().set({ shutdown: true });
    setParams({}, { replace: true });
  }, [params, setParams]);
  const view = useDeskUi((s) => s.view);
  const anchor = useDeskUi((s) => s.anchor) ?? today;
  const drawer = useDeskUi((s) => s.drawer);
  const dragging = useDeskUi((s) => s.dragging);
  const pendingN = pendingItems(items, today).length;
  const peopleOpen = useDeskUi((s) => s.people !== null);
  const people = useStore((s) => s.people);
  const interactions = useStore((s) => s.interactions);
  /** 「人际」角标：14 天内的重要日子 + 超了联系节奏的人（同一个人只算一次） */
  const peopleAttn = useMemo(() => {
    const list = Object.values(people);
    const ids = new Set(upcomingDates(list, today, DATE_SOON_DAYS).map((u) => u.person.id));
    for (const c of contactStates(list, Object.values(interactions), items, today)) if (c.over >= 0) ids.add(c.person.id);
    return ids.size;
  }, [people, interactions, items, today]);

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
      onClickCapture={() => {
        const ui = useDeskUi.getState();
        overlaysAtClick.current = Object.fromEntries(OVERLAY_KEYS.map((k) => [k, ui[k]]));
      }}
      onClick={(e) => {
        // 点浮层以外的地方先收起浮层（菜单、小月历、人物卡、新建卡、挑选浮层）；
        // 点的是空白（不是行、按钮、选中条、抽屉）且没有浮层可收时，取消选择
        const t = e.target as Element;
        if (t.closest('.dk-menu, .dk-pop, .dk-mover, .dk-qa, .dk-selbar, .dk-modal')) return;
        const ui = useDeskUi.getState();
        // 编辑卡开着时点外面不收：里面可能有没保存的字（只认 Esc / 取消 / 保存）
        if (ui.editor) return;
        const before = overlaysAtClick.current;
        const patch: Record<string, unknown> = {};
        for (const k of OVERLAY_KEYS) if (before[k] && ui[k] === before[k]) patch[k] = k === 'quickAdd' ? false : null;
        if ('person' in patch) patch.personLit = null;
        if ('quickAdd' in patch) patch.qaPreset = null;
        const hadOverlay = Object.keys(patch).length > 0;
        if (hadOverlay) ui.set(patch);
        if (!hadOverlay && ui.sel.size && !t.closest('.dk-row, button, input, .dk-drawer')) ui.set({ sel: new Set() });
      }}
    >
      <DeskHero today={today} items={items} dayOf={dayOf} study={study} />

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
        {view === 'week' && (
          <button
            type="button"
            className={`dk-btn ghost dk-wk${hideWeekend ? '' : ' on'}`}
            aria-pressed={!hideWeekend}
            title={hideWeekend ? '展开周六、周日' : '把周六、周日收成窄条，给工作日腾地方'}
            onClick={() => useDeskUi.getState().toggleWeekend()}
          >
            <span className="dk-wk-ic" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
              <i className="we" />
              <i className="we" />
            </span>
            {hideWeekend ? '展开周末' : '收起周末'}
          </button>
        )}
        <span className="dk-grow" />
        <button
          type="button"
          className="dk-btn ghost dk-people-btn"
          title={peopleAttn ? `人际：${peopleAttn} 个人需要关注（快到的日子 / 该联系了）` : '人际：人物档案、记一笔、重要日子'}
          onClick={() => useDeskUi.getState().set({ people: { id: null }, menu: null, person: null, personLit: null })}
        >
          人际 {peopleAttn > 0 && <span className="dk-badge soft tnum">{peopleAttn}</span>}
        </button>
        <button type="button" className="dk-btn" title="下班前：回顾今天、安排没做完的、挑明天的要事" onClick={() => useDeskUi.getState().set({ shutdown: true })}>
          收尾今天
        </button>
        <button type="button" className="dk-btn" title="没排日子的事（I）" onClick={() => useDeskUi.getState().set({ drawer: !drawer, drawerTab: 'pending' })}>
          待处理 {pendingN > 0 && <span className="dk-badge tnum">{pendingN}</span>}
        </button>
      </div>

      <div className="dk-stage">
        {view === 'week' ? (
          <WeekBoard monday={monday} today={today} dayOf={dayOf} plan={plan} planHidden={planHidden} />
        ) : (
          <MonthView anchor={anchor} today={today} dayOf={dayOf} />
        )}
        <QuickAdd today={today} />
        <PendingDrawer items={items} today={today} />
      </div>
      {/* 日常习惯：周历最下方一条（负责人：不放日卡里） */}
      <HabitStrip today={today} />

      <Mover today={today} dayOf={dayOf} />
      <SelectionBar today={today} />
      <DeskMenus today={today} dayOf={dayOf} />
      <PersonCard items={items} today={today} />
      <StudySetupPop />
      <DeskEditorPop today={today} />
      <FocusPicker today={today} />
      <PlanPicker rows={dueRows} />
      <ShutdownSheet today={today} dayOf={dayOf} plan={allPlan} />
      {peopleOpen && (
        <Suspense fallback={null}>
          <PeopleModal today={today} />
        </Suspense>
      )}
    </div>
  );
}
