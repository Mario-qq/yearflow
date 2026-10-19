/**
 * 两个挑选浮层：
 * - 挑要事（Ivy Lee：每天最多 3 件「今天必须做完」）：列出那天没做完的事项，点 ☆ 设为 / 取消要事；收尾面板里复用同一份列表。
 * - 年度计划显示哪些：甘特图当天该打卡的任务不一定都想在工作台看到。按目标勾（含以后的任务）或按任务勾；记在本机设置。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WorkItem } from '../types/domain';
import { isFocusOn, MAX_FOCUS } from '../lib/derive/desk';
import { setFocus } from '../store/deskActions';
import { useStore } from '../store/useStore';
import { goalColor } from '../lib/colors';
import { relDay } from './format';
import type { PlanRowData } from './usePlanRows';
import { useDeskUi } from './uiStore';
import { showToast } from '../lib/toast';
import { focusCandidates, setPlanHidden, toggleIn } from './pickModel';

/** 浮层夹在屏内：anchor 是左上角（alignRight = 右边对齐到 left） */
function useClamped(anchor: { left: number; top: number } | null, alignRight = false, dep?: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!anchor || !el) return setPos(null);
    const left = alignRight ? anchor.left - el.offsetWidth : anchor.left;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(anchor.top, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [anchor, alignRight, dep]);
  const style: React.CSSProperties = pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 };
  return { ref, style };
}

export function FocusList({ date, today, items }: { date: string; today: string; items: WorkItem[] }) {
  const list = focusCandidates(items, date, today);
  const picked = items.filter((i) => isFocusOn(i, date)).length;
  if (list.length === 0) return <div className="dk-empty">那天还没有排事项</div>;
  return (
    <div className="dk-fl">
      {list.map((i) => {
        const on = isFocusOn(i, date);
        return (
          <button
            key={i.id}
            type="button"
            className={`dk-fl-row${on ? ' on' : ''}`}
            aria-pressed={on}
            disabled={!on && picked >= MAX_FOCUS}
            onClick={() => {
              const over = setFocus([i.id], on ? null : date);
              if (over) showToast(`每天最多 ${MAX_FOCUS} 件要事，先移出一件`);
            }}
          >
            <span className="star" aria-hidden>
              {on ? '★' : '☆'}
            </span>
            <span className="t">
              {i.important && <i className="dk-imp" aria-label="重要" />}
              {i.title}
            </span>
            {i.date && i.date < today && <span className="m">拖了</span>}
          </button>
        );
      })}
    </div>
  );
}

export function FocusPicker({ today }: { today: string }) {
  const at = useDeskUi((s) => s.focusPicker);
  const workItems = useStore((s) => s.workItems);
  const items = useMemo(() => Object.values(workItems), [workItems]);
  const { ref, style } = useClamped(at, false, items.length);
  if (!at) return null;
  const picked = items.filter((i) => isFocusOn(i, at.date)).length;
  return (
    <div ref={ref} className="dk-pop dk-fp" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="dk-pop-h">
        <div>
          <b>挑{relDay(at.date, today)}最要紧的事</b>
          <small>只挑做完了这一天就算没白过的，最多 {MAX_FOCUS} 件</small>
        </div>
        <span className="dk-grow" />
        <span className="dk-fp-n tnum">
          {picked}/{MAX_FOCUS}
        </span>
      </div>
      <FocusList date={at.date} today={today} items={items} />
      <div className="dk-pop-foot">
        <span className="dk-ed-tip">也可以右键事项「设为要事」，或选中后按 F</span>
        <span className="dk-grow" />
        <button type="button" className="dk-btn primary" onClick={() => useDeskUi.getState().set({ focusPicker: null })}>
          好了
        </button>
      </div>
    </div>
  );
}

export function PlanPicker({ rows }: { rows: PlanRowData[] }) {
  const at = useDeskUi((s) => s.planPicker);
  const goals = useStore((s) => s.goals);
  const hiddenGoals = useStore((s) => s.settings.desk.planHiddenGoals) ?? [];
  const hiddenTasks = useStore((s) => s.settings.desk.planHiddenTasks) ?? [];
  const { ref, style } = useClamped(at, true);

  /** 今天有任务要打卡的目标在前（带今天的任务），其余目标只列目标一行 */
  const groups = useMemo(() => {
    const byGoal = new Map<string, PlanRowData[]>();
    for (const r of rows) byGoal.set(r.goalId, [...(byGoal.get(r.goalId) ?? []), r]);
    return Object.values(goals)
      .filter((g) => !g.deletedAt && !g.archived)
      .sort((a, b) => Number(byGoal.has(b.id)) - Number(byGoal.has(a.id)) || a.order - b.order)
      .map((g) => ({ goal: g, rows: byGoal.get(g.id) ?? [] }));
  }, [goals, rows]);

  if (!at) return null;
  return (
    <div ref={ref} className="dk-pop dk-pp" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="dk-pop-h">
        <div>
          <b>年度计划在工作台显示哪些</b>
          <small>只影响这里，不影响甘特图与打卡页；按目标勾掉的，以后的任务也不显示</small>
        </div>
      </div>
      <div className="dk-pp-list">
        {groups.map(({ goal, rows: rs }) => {
          const goalOn = !hiddenGoals.includes(goal.id);
          return (
            <div key={goal.id} className="dk-pp-g">
              <label className="dk-pp-row goal" style={{ '--c': goalColor(goal.color) } as React.CSSProperties}>
                <input type="checkbox" checked={goalOn} onChange={() => setPlanHidden({ goals: toggleIn(hiddenGoals, goal.id, !goalOn) })} />
                <i className="dot" />
                <span className="t">{goal.name}</span>
                {rs.length > 0 && <span className="m tnum">今天 {rs.length} 项</span>}
              </label>
              {goalOn &&
                rs.map((r) => {
                  const on = !hiddenTasks.includes(r.taskId);
                  return (
                    <label key={r.taskId} className="dk-pp-row task">
                      <input type="checkbox" checked={on} onChange={() => setPlanHidden({ tasks: toggleIn(hiddenTasks, r.taskId, !on) })} />
                      <span className="t">{r.taskName}</span>
                    </label>
                  );
                })}
            </div>
          );
        })}
      </div>
      <div className="dk-pop-foot">
        {(hiddenGoals.length > 0 || hiddenTasks.length > 0) && (
          <button type="button" className="dk-btn ghost" onClick={() => setPlanHidden({ goals: [], tasks: [] })}>
            全部显示
          </button>
        )}
        <span className="dk-grow" />
        <button type="button" className="dk-btn primary" onClick={() => useDeskUi.getState().set({ planPicker: null })}>
          好了
        </button>
      </div>
    </div>
  );
}
