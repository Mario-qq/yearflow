/**
 * 右下角悬浮新建：平时是一颗小按钮（N），展开成一张输入卡，下方实时显示解析出的标签，回车创建、Esc 收起。
 * 界面上不放写法示例（负责人要求），写法只在按钮的悬停提示里。
 */
import { useMemo, useState } from 'react';
import { parseQuickAdd } from '../lib/desk/parseQuickAdd';
import { createFromQuickAdd } from '../store/deskActions';
import { useStore } from '../store/useStore';
import { md, relDay, toastUndo } from './format';
import { useDeskUi } from './uiStore';

const SYNTAX_HINT = '新建（N）\n!! 紧急 · ! 尽快 · @人 · 今天/周三/下周一/10.20 · 截止周五 · #目标 · 每周三/工作日/每月5号（可带 9:00）· ~生活 · 待处理';

export function QuickAdd({ today }: { today: string }) {
  const open = useDeskUi((s) => s.quickAdd);
  const goals = useStore((s) => s.goals);
  const [text, setText] = useState('');
  const goalList = useMemo(() => Object.values(goals).filter((g) => !g.archived).map((g) => ({ id: g.id, name: g.name })), [goals]);
  const parsed = text.trim() ? parseQuickAdd(text, { today, goals: goalList }) : null;

  const close = () => useDeskUi.getState().set({ quickAdd: false });

  const submit = () => {
    if (!parsed) return close();
    if (!parsed.title) return;
    createFromQuickAdd(parsed);
    toastUndo(
      parsed.kind === 'routine'
        ? `已建例行：${parsed.title}（${parsed.ruleLabel}）`
        : `已加到${parsed.date ? relDay(parsed.date, today) : '待处理'}：${parsed.title}`,
    );
    setText('');
  };

  if (!open) {
    return (
      <button type="button" className="dk-fab" title={SYNTAX_HINT} onClick={() => useDeskUi.getState().set({ quickAdd: true, menu: null })}>
        <span className="plus">＋</span>新建<kbd>N</kbd>
      </button>
    );
  }

  const chips: React.ReactNode[] = [];
  if (parsed) {
    const kind = parsed.kind === 'routine' ? `例行 · ${parsed.ruleLabel}` : parsed.kind === 'followup' ? (parsed.mode === 'dispatch' ? '跟进 · 待下发' : '跟进 · 待告知') : '待办';
    chips.push(<span key="k" className="dk-chip k">{kind}</span>);
    if (parsed.person) chips.push(<span key="p" className="dk-chip">@{parsed.person}</span>);
    if (parsed.urgency !== 'normal') chips.push(<span key="u" className={`dk-chip ${parsed.urgency === 'urgent' ? 'u2' : 'u1'}`}>{parsed.urgency === 'urgent' ? '紧急' : '尽快'}</span>);
    if (parsed.kind !== 'routine') chips.push(<span key="d" className="dk-chip">{parsed.date ? `${relDay(parsed.date, today)} ${md(parsed.date)}` : '待处理'}</span>);
    if (parsed.time) chips.push(<span key="tm" className="dk-chip tnum">{parsed.time}</span>);
    if (parsed.dueDate) chips.push(<span key="due" className="dk-chip">截止 {md(parsed.dueDate)}</span>);
    if (parsed.goalId) chips.push(<span key="g" className="dk-chip">#{goals[parsed.goalId]?.name}</span>);
    if (parsed.unknownGoal) chips.push(<span key="ug" className="dk-chip warn">没有叫「{parsed.unknownGoal}」的目标</span>);
    if (parsed.scope === 'life') chips.push(<span key="s" className="dk-chip">生活</span>);
  }

  return (
    <div className="dk-qa" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={text}
        placeholder="写一句话，回车创建"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          if (e.key === 'Escape') close();
        }}
      />
      <div className="dk-qa-prev">{chips}</div>
      <div className="dk-qa-foot">
        <span>
          <kbd>↵</kbd> 创建
        </span>
        <span>
          <kbd>Esc</kbd> 收起
        </span>
      </div>
    </div>
  );
}
