/**
 * 工作台的三种行：事项（待办/跟进）、例行的一次、今天的年度计划（甘特任务）。
 * 交互：单击选择、双击标题改名、右键菜单、按住拖动（拖拽在 useDeskDrag 里统一接管，行只负责 data-key）。
 */
import { useState } from 'react';
import type { WorkItem } from '../types/domain';
import { effectiveUrgency, rolledDays, type RoutineOccurrence } from '../lib/derive/desk';
import { patchItem, toggleItem, toggleOccurrence } from '../store/deskActions';
import { useStore } from '../store/useStore';
import { goalColor } from '../lib/colors';
import { CHECK_ANIM_MS, personColor } from './constants';
import { isWeekendDate, md, relDay, weekdayCn } from './format';
import { itemKey, occKey } from './keys';
import { clickSelect } from './selection';
import { useDeskUi } from './uiStore';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 先播完打勾再落库：行在原位亮一下绿勾，然后才滑进「已完成」折叠 */
function useCheckAnim(run: () => void): [boolean, () => void] {
  const [checking, setChecking] = useState(false);
  const fire = () => {
    if (reducedMotion()) return run();
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      run();
    }, CHECK_ANIM_MS);
  };
  return [checking, fire];
}

function openRowMenu(e: React.MouseEvent, key: string, day?: string) {
  e.preventDefault();
  const ui = useDeskUi.getState();
  if (!ui.sel.has(key)) ui.set({ sel: new Set([key]), lastKey: key });
  ui.set({ menu: { kind: 'row', key, day, x: e.clientX, y: e.clientY } });
}

export function WhoChip({ item }: { item: WorkItem }) {
  if (!item.person) return null;
  return (
    <button
      type="button"
      className="dk-who"
      title={`${item.person} 的所有跟进`}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        useDeskUi.getState().set({ person: { name: item.person!, left: r.left, top: r.bottom }, personLit: item.person!, menu: null });
      }}
    >
      <span className="av" style={{ '--c': personColor(item.person) } as React.CSSProperties}>
        {item.person[0]}
      </span>
      {item.person}
      <span className="md">{item.mode === 'dispatch' ? '下发' : '告知'}</span>
    </button>
  );
}

interface ItemRowProps {
  item: WorkItem;
  today: string;
  /** 在今天这一列里显示的过期顺延事项 */
  rolled?: boolean;
  /** 只要勾选 + 标题（过去的日卡、月历格） */
  compact?: boolean;
  /** 在周末列里：不再标「生活」 */
  weekend?: boolean;
  /** 人物卡里：行尾写哪天 */
  showWhen?: boolean;
  /** 人物卡里的行不带 @人 */
  hideWho?: boolean;
}

export function ItemRow({ item, today, rolled, compact, weekend, showWhen, hideWho }: ItemRowProps) {
  const key = itemKey(item.id);
  const selected = useDeskUi((s) => s.sel.has(key));
  const personLit = useDeskUi((s) => s.personLit);
  const editing = useDeskUi((s) => s.editing === key);
  const goal = useStore((s) => (item.goalId ? s.goals[item.goalId] : undefined));
  const [checking, check] = useCheckAnim(() => toggleItem(item.id));

  const done = item.status === 'done' || checking;
  const dropped = item.status === 'dropped';
  const u = item.status === 'open' ? effectiveUrgency(item, today) : 'normal';
  const cls = ['dk-row', done ? 'done' : '', dropped ? 'skipped' : '', u === 'urgent' ? 'u2' : u === 'soon' ? 'u1' : '', selected ? 'sel' : ''];
  if (personLit) cls.push(item.person === personLit ? 'lit' : 'dim');

  const meta: React.ReactNode[] = [];
  if (dropped) meta.push(<span key="drop">不做了</span>);
  if (!compact) {
    if (item.kind === 'followup' && !hideWho) meta.push(<WhoChip key="who" item={item} />);
    if (hideWho && item.kind === 'followup') meta.push(<span key="mode">{item.mode === 'dispatch' ? '下发' : '告知'}</span>);
    if (goal) meta.push(<span key="g" className="gd" title={`#${goal.name}`} style={{ '--c': goalColor(goal.color) } as React.CSSProperties} />);
    if (item.scope === 'life' && !weekend) meta.push(<span key="life">生活</span>);
    if (item.dueDate && item.status === 'open') {
      const late = item.dueDate <= today;
      meta.push(
        <span key="due" className={`due ${late ? 'late' : ''}`}>
          {item.dueDate === today ? '今天截止' : item.dueDate < today ? '已过截止' : `${md(item.dueDate)} 截止`}
        </span>,
      );
    }
    const age = rolled ? rolledDays(item, today) : 0;
    if (age > 0) meta.push(<span key="age" className="age">拖了 {age} 天</span>);
    else if ((item.deferCount ?? 0) >= 2 && item.status === 'open') meta.push(<span key="defer" className="age">挪过 {item.deferCount} 次</span>);
    if (showWhen) meta.push(<span key="when" className="tnum">{item.date ? relDay(item.date, today) : '待处理'}</span>);
  }

  return (
    <div
      className={cls.join(' ')}
      data-key={key}
      title={item.note ? `${item.title}\n${item.note}` : item.title}
      onClick={(e) => clickSelect(e, key)}
      onContextMenu={(e) => openRowMenu(e, key)}
    >
      <button
        type="button"
        className="dk-chk"
        aria-label={dropped ? '恢复为未完成' : done ? '标为未完成' : '完成'}
        title={dropped ? '恢复为未完成' : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (item.status === 'open') check();
          else toggleItem(item.id);
        }}
      />
      <span
        className="dk-t"
        onDoubleClick={(e) => {
          e.stopPropagation();
          useDeskUi.getState().set({ editing: key });
        }}
      >
        {editing ? (
          <input
            autoFocus
            defaultValue={item.title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.currentTarget.value = item.title;
                e.currentTarget.blur();
              }
              e.stopPropagation();
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              useDeskUi.getState().set({ editing: null });
              if (v && v !== item.title) patchItem(item.id, { title: v }, `改名为「${v}」`);
            }}
          />
        ) : (
          item.title
        )}
      </span>
      {meta.length > 0 && <span className="dk-m">{meta}</span>}
    </div>
  );
}

export function RoutineRow({ occ, date, today }: { occ: RoutineOccurrence; date: string; today: string }) {
  const key = occKey(occ.routine.id, occ.origDate);
  const selected = useDeskUi((s) => s.sel.has(key));
  const personLit = useDeskUi((s) => s.personLit);
  const [checking, check] = useCheckAnim(() => toggleOccurrence(occ.routine.id, occ.origDate, date));
  const done = occ.status === 'done' || checking;
  const r = occ.routine;

  const meta: React.ReactNode[] = [];
  if (occ.makeup && !occ.movedIn) meta.push(<span key="mk" className="age">补做 · {weekdayCn(occ.origDate)}漏了</span>);
  else if (occ.movedIn) meta.push(<span key="mv">从{relDay(occ.origDate, today)}改来</span>);
  if (occ.status === 'skipped') meta.push(<span key="sk">跳过</span>);
  if (r.scope === 'life' && !isWeekendDate(date)) meta.push(<span key="life">生活</span>);
  if (r.time) meta.push(<span key="tm" className="tnum">{r.time}</span>);

  return (
    <div
      className={['dk-row routine', done ? 'done' : '', occ.status === 'skipped' ? 'skipped' : '', selected ? 'sel' : '', personLit ? 'dim' : ''].join(' ')}
      data-key={key}
      data-day={date}
      title={`例行：${r.title}${r.note ? `\n${r.note}` : ''}`}
      onClick={(e) => clickSelect(e, key)}
      onContextMenu={(e) => openRowMenu(e, key, date)}
    >
      <button
        type="button"
        className="dk-chk"
        aria-label={done ? '标为未做' : '完成'}
        onClick={(e) => {
          e.stopPropagation();
          if (occ.status === 'done') toggleOccurrence(r.id, occ.origDate, date);
          else check();
        }}
      />
      <span className="dk-t">{r.title}</span>
      {meta.length > 0 && <span className="dk-m">{meta}</span>}
    </div>
  );
}
