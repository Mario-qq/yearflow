/**
 * 右下角悬浮新建：平时是一颗小按钮（N），展开成一张输入卡。
 * 一句话里写的标签照常解析（写法在按钮悬停提示里）；下面一排可以直接点选：工作/生活 · 紧急度 · 重要 · 要事 · 哪天。
 * 点选的优先于一句话里解析出来的；创建后清空，回到「跟着一句话走」。从日卡「＋」打开时预填那天（周末预填生活）。
 */
import { useMemo, useState } from 'react';
import type { Urgency, WorkScope } from '../types/domain';
import { parseQuickAdd } from '../lib/desk/parseQuickAdd';
import { addDays, isFocusOn, MAX_FOCUS } from '../lib/derive/desk';
import { createFromQuickAdd } from '../store/deskActions';
import { useStore } from '../store/useStore';
import { isWeekendDate, md, relDay, toastUndo } from './format';
import { useDeskUi } from './uiStore';

const SYNTAX_HINT = '新建（N）\n也可以一句话写完：!! 紧急 · ! 尽快 · * 重要 · @人 · 今天/周三/下周一/10.20 · 截止周五 · #目标 · 每周三/工作日/每月5号（可带 9:00）· ~生活 · 待处理';

interface Pick {
  scope?: WorkScope;
  urgency?: Urgency;
  important?: boolean;
  focus?: boolean;
  /** null = 待处理 */
  date?: string | null;
}

const URGENCY: [Urgency, string][] = [
  ['urgent', '紧急'],
  ['soon', '尽快'],
  ['normal', '普通'],
];

/** 点选按钮不抢输入框的焦点（点完还能接着打字、回车创建） */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function QuickAdd({ today }: { today: string }) {
  const open = useDeskUi((s) => s.quickAdd);
  const preset = useDeskUi((s) => s.qaPreset);
  const goals = useStore((s) => s.goals);
  const workItems = useStore((s) => s.workItems);
  const [text, setText] = useState('');
  const [pick, setPick] = useState<Pick>({});
  const goalList = useMemo(() => Object.values(goals).filter((g) => !g.archived).map((g) => ({ id: g.id, name: g.name })), [goals]);
  const parsed = parseQuickAdd(text, { today, goals: goalList });
  const typed = text.trim().length > 0;

  // 有效值：点选 > 一句话里写了的 > 日卡预填 > 默认
  const wroteDate = /今天|明天|后天|周[一二三四五六日天]|\d{1,2}[./-]\d{1,2}|\d{1,2}月\d{1,2}|待处理/.test(text);
  const wroteScope = /[~～](生活|工作)/.test(text);
  const isRoutine = parsed.kind === 'routine';
  const date = pick.date !== undefined ? pick.date : !wroteDate && preset ? preset.date : parsed.date;
  const scope: WorkScope = pick.scope ?? (wroteScope || isRoutine ? parsed.scope : (preset?.scope ?? (date && isWeekendDate(date) ? 'life' : 'work')));
  const urgency = pick.urgency ?? parsed.urgency;
  const important = pick.important ?? Boolean(parsed.important);
  const focusFull = date ? Object.values(workItems).filter((i) => isFocusOn(i, date)).length >= MAX_FOCUS : true;
  const focus = Boolean(pick.focus) && !isRoutine && Boolean(date) && !focusFull;

  const close = () => {
    useDeskUi.getState().set({ quickAdd: false, qaPreset: null });
    setPick({});
  };

  const submit = () => {
    if (!typed) return close();
    if (!parsed.title) return;
    const r = { ...parsed, scope, urgency, important, date: isRoutine ? null : date };
    createFromQuickAdd(r, focus);
    toastUndo(r.kind === 'routine' ? `已建例行：${r.title}（${r.ruleLabel}）` : `已加到${r.date ? relDay(r.date, today) : '待处理'}：${r.title}${focus ? '（要事）' : ''}`);
    setText('');
    setPick({});
  };

  if (!open) {
    return (
      <button
        type="button"
        className="dk-fab"
        title={SYNTAX_HINT}
        onClick={(e) => {
          e.stopPropagation();
          useDeskUi.getState().set({ quickAdd: true, menu: null });
        }}
      >
        <span className="plus">＋</span>新建<kbd>N</kbd>
      </button>
    );
  }

  const chips: React.ReactNode[] = [];
  if (typed) {
    const kind = isRoutine ? `例行 · ${parsed.ruleLabel}` : parsed.kind === 'followup' ? (parsed.mode === 'dispatch' ? '跟进 · 待下发' : '跟进 · 待告知') : '待办';
    chips.push(<span key="k" className="dk-chip k">{kind}</span>);
    if (parsed.person) chips.push(<span key="p" className="dk-chip">@{parsed.person}</span>);
    if (parsed.time) chips.push(<span key="tm" className="dk-chip tnum">{parsed.time}</span>);
    if (parsed.dueDate) chips.push(<span key="due" className="dk-chip">截止 {md(parsed.dueDate)}</span>);
    if (parsed.goalId) chips.push(<span key="g" className="dk-chip">#{goals[parsed.goalId]?.name}</span>);
    if (parsed.unknownGoal) chips.push(<span key="ug" className="dk-chip warn">没有叫「{parsed.unknownGoal}」的目标</span>);
  }

  const tomorrow = addDays(today, 1);
  const dateOpts: [string | null, string][] = [
    [today, '今天'],
    [tomorrow, '明天'],
    [null, '待处理'],
  ];
  const customDate = date && date !== today && date !== tomorrow;

  return (
    <div className="dk-qa" onClick={(e) => e.stopPropagation()}>
      <input
        className="dk-qa-in"
        autoFocus
        value={text}
        placeholder={preset ? `在${relDay(preset.date, today)}加一件事，回车创建` : '写一句话，回车创建'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          if (e.key === 'Escape') close();
        }}
      />
      {chips.length > 0 && <div className="dk-qa-prev">{chips}</div>}
      <div className="dk-qa-opts">
        <div className="dk-seg scope" role="radiogroup" aria-label="工作或生活">
          {(['work', 'life'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} className={`${s}${scope === s ? ' on' : ''}`} onMouseDown={keepFocus} onClick={() => setPick((p) => ({ ...p, scope: s }))}>
              {s === 'work' ? '工作' : '生活'}
            </button>
          ))}
        </div>
        {!isRoutine && (
          <>
            <div className="dk-seg" role="radiogroup" aria-label="紧急度">
              {URGENCY.map(([u, label]) => (
                <button key={u} type="button" role="radio" aria-checked={urgency === u} className={`${u}${urgency === u ? ' on' : ''}`} onMouseDown={keepFocus} onClick={() => setPick((p) => ({ ...p, urgency: u }))}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className={`dk-tog imp${important ? ' on' : ''}`} aria-pressed={important} title="重要：同紧急度里排在前面（写 * 也行）" onMouseDown={keepFocus} onClick={() => setPick((p) => ({ ...p, important: !important }))}>
              <i className="dk-imp" aria-hidden />
              重要
            </button>
            <button
              type="button"
              className={`dk-tog fo${focus ? ' on' : ''}`}
              aria-pressed={focus}
              disabled={!date || (focusFull && !focus)}
              title={!date ? '待处理的事不能当要事' : focusFull ? `${relDay(date, today)}已有 ${MAX_FOCUS} 件要事` : `设为${relDay(date, today)}的要事`}
              onMouseDown={keepFocus}
              onClick={() => setPick((p) => ({ ...p, focus: !focus }))}
            >
              ◎ 要事
            </button>
          </>
        )}
      </div>
      {!isRoutine && (
        <div className="dk-qa-opts">
          <div className="dk-seg" role="radiogroup" aria-label="哪天做">
            {dateOpts.map(([d, label]) => (
              <button key={label} type="button" role="radio" aria-checked={date === d} className={date === d ? 'on' : ''} onMouseDown={keepFocus} onClick={() => setPick((p) => ({ ...p, date: d }))}>
                {label}
              </button>
            ))}
          </div>
          <label className={`dk-qa-date${customDate ? ' on' : ''}`}>
            <span className="tnum">{customDate ? `${relDay(date, today)} ${md(date)}` : '挑日子'}</span>
            <input type="date" aria-label="挑日子" value={date ?? ''} onChange={(e) => e.target.value && setPick((p) => ({ ...p, date: e.target.value }))} />
          </label>
        </div>
      )}
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
