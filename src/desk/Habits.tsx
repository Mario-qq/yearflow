/**
 * 日常习惯（DESK_SPEC §十二）：今天那列最上面一排小胶囊 + 编辑卡 + 抽屉「习惯」页。
 * 不是待办：不进完成数、不顺延、不能拖。点胶囊 = 打卡（要做的）/ 记一次破戒（要忍住的），右键更多。
 */
import { useMemo, useState } from 'react';
import type { Habit } from '../types/domain';
import { useStore } from '../store/useStore';
import { createHabit, deleteHabit, saveHabit, setHabitPaused, type HabitDraft } from '../store/habitActions';
import { openHabitEditor, tapHabit } from './habitCommands';
import { habitBadge, habitHint, habitViews, type HabitDay, type HabitView } from '../lib/derive/habits';
import { toastUndo } from './format';
import { useDeskUi } from './uiStore';

const WEEK: [number, string][] = [
  [1, '一'],
  [2, '二'],
  [3, '三'],
  [4, '四'],
  [5, '五'],
  [6, '六'],
  [0, '日'],
];
const ICONS = ['🦷', '🧊', '💧', '🚶', '🧘', '😴', '📵', '🍎', '🏃', '📖', '🙏', '🌿'];
const DOT: Record<HabitDay, string> = { done: '●', kept: '●', open: '○', missed: '×', slip: '×', off: '·' };

/** 胶囊悬停说明：锚点 · 为什么 · 最近两周 */
function tip(v: HabitView): string {
  const h = v.habit;
  const lines = [`${h.icon ? h.icon + ' ' : ''}${h.title}${h.kind === 'avoid' ? '（要忍住）' : ''} · ${habitHint(v)}`];
  if (h.cue) lines.push(h.kind === 'do' ? `什么时候：${h.cue}` : `容易破的时候：${h.cue}`);
  if (h.why) lines.push(`为什么：${h.why}`);
  lines.push(`最近两周：${v.last14.map((s) => DOT[s]).join('')}`);
  lines.push(h.kind === 'do' ? '点一下 = 做了（再点撤销）· 右键更多' : '点一下 = 今天破了一次（再点撤销）· 右键更多');
  return lines.join('\n');
}

function Chip({ v, today }: { v: HabitView; today: string }) {
  const h = v.habit;
  const cls = ['dk-hb', h.kind, v.state, v.broke && v.state !== 'done' ? `b${v.broke}` : ''].join(' ');
  const badge = habitBadge(v);
  return (
    <button
      type="button"
      className={cls}
      title={tip(v)}
      aria-pressed={v.state === 'done' || v.state === 'slip'}
      onClick={(e) => {
        e.stopPropagation();
        if (v.state !== 'off') tapHabit(h, today);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        useDeskUi.getState().set({ menu: { kind: 'habit', id: h.id, x: e.clientX, y: e.clientY } });
      }}
    >
      <span className="ic" aria-hidden>
        {v.state === 'done' ? '✓' : h.icon || (h.kind === 'avoid' ? '⊘' : '○')}
      </span>
      <span className="t">{h.title}</span>
      {badge && <span className="h tnum">{badge}</span>}
    </button>
  );
}

/** 今天那列最上面的一排习惯 */
export function HabitStrip({ today }: { today: string }) {
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.habitLogs);
  const views = useMemo(() => habitViews(Object.values(habits), logs, today), [habits, logs, today]);
  const add = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openHabitEditor(null, r.left, r.bottom);
  };
  if (!views.length)
    return (
      <div className="dk-habits">
        <button type="button" className="dk-hb-add empty" onClick={add} title="冲牙、不吃热食这类天天要做 / 要忍住的事：不当待办，只在这里提醒">
          ＋ 日常习惯
        </button>
      </div>
    );
  return (
    <div className="dk-habits" aria-label="日常习惯">
      {views.map((v) => (
        <Chip key={v.habit.id} v={v} today={today} />
      ))}
      <button type="button" className="dk-hb-add" onClick={add} title="加一个日常习惯" aria-label="加一个日常习惯">
        ＋
      </button>
    </div>
  );
}

// ── 编辑卡 ─────────────────────────────────────────────────────────────

const close = () => useDeskUi.getState().set({ editor: null });

export function HabitEditor({ habit, today }: { habit?: Habit; today: string }) {
  const [d, setD] = useState<HabitDraft>(() =>
    habit
      ? { ...habit }
      : { title: '', kind: 'do', startDate: today },
  );
  const set = (patch: Partial<HabitDraft>) => setD((x) => ({ ...x, ...patch }));
  const days = d.daysOfWeek?.length ? d.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const invalid = !d.title.trim() || days.length === 0;

  const save = () => {
    if (invalid) return;
    const draft = { ...d, daysOfWeek: days.length === 7 ? undefined : days };
    if (habit) {
      saveHabit(habit.id, draft);
      toastUndo(`已保存「${d.title.trim()}」`);
    } else {
      createHabit(draft);
      toastUndo(`加了习惯「${d.title.trim()}」，在今天最上面`);
    }
    close();
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT')) {
      e.preventDefault();
      save();
    }
  };
  const avoid = d.kind === 'avoid';

  return (
    <div className="dk-ed-b" onKeyDown={keys}>
      <div className="dk-hb-name">
        <input className="dk-in dk-hb-icon" aria-label="图标" placeholder="🙂" value={d.icon ?? ''} onChange={(e) => set({ icon: e.target.value })} />
        <input className="dk-in dk-ed-title" autoFocus placeholder={avoid ? '比如：不吃热食' : '比如：冲牙'} aria-label="习惯名" value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div className="dk-hb-icons">
        {ICONS.map((ic) => (
          <button key={ic} type="button" className={d.icon === ic ? 'on' : ''} onClick={() => set({ icon: d.icon === ic ? undefined : ic })}>
            {ic}
          </button>
        ))}
      </div>
      <div className="dk-ed-f">
        <span className="dk-ed-k">类型</span>
        <div className="dk-ed-v">
          <div className="dk-seg" role="radiogroup" aria-label="类型">
            {(
              [
                ['do', '要做的'],
                ['avoid', '要忍住的'],
              ] as const
            ).map(([k, text]) => (
              <button key={k} type="button" role="radio" aria-checked={d.kind === k} className={d.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>
                {text}
              </button>
            ))}
          </div>
          <span className="dk-ed-tip">{avoid ? '默认算守住，破了才点一下' : '做了点一下打勾'}</span>
        </div>
      </div>
      <div className="dk-ed-f">
        <span className="dk-ed-k">{avoid ? '难的时候' : '挂在'}</span>
        <div className="dk-ed-v">
          <input
            className="dk-in wide"
            aria-label={avoid ? '容易破的场景' : '锚点'}
            placeholder={avoid ? '吃饭时、点外卖时…' : '刷完牙后、午饭后…（挂在已有动作后面最容易坚持）'}
            value={d.cue ?? ''}
            onChange={(e) => set({ cue: e.target.value })}
          />
        </div>
      </div>
      <div className="dk-ed-f">
        <span className="dk-ed-k">哪几天</span>
        <div className="dk-ed-v">
          <div className="dk-ed-days">
            {WEEK.map(([dow, name]) => {
              const on = days.includes(dow);
              return (
                <button
                  key={dow}
                  type="button"
                  className={on ? 'on' : ''}
                  aria-pressed={on}
                  onClick={() => set({ daysOfWeek: on ? days.filter((x) => x !== dow) : [...days, dow] })}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <span className="dk-ed-tip">{days.length === 7 ? '每天' : days.length ? '' : '至少选一天'}</span>
        </div>
      </div>
      <div className="dk-ed-f">
        <span className="dk-ed-k">提醒</span>
        <div className="dk-ed-v">
          <input type="time" className="dk-in tnum" aria-label="提醒时间" value={d.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} />
          <span className="dk-ed-tip">{d.time ? (avoid ? '到点提醒自己忍住（没破才提醒）' : '到点还没打就发一次通知（桌面版）') : '可选'}</span>
        </div>
      </div>
      <div className="dk-ed-f">
        <span className="dk-ed-k">为什么</span>
        <div className="dk-ed-v">
          <input className="dk-in wide" aria-label="为什么" placeholder="想坚持时看一眼：牙龈出血、胃不舒服…" value={d.why ?? ''} onChange={(e) => set({ why: e.target.value })} />
        </div>
      </div>
      <div className="dk-ed-f">
        <span className="dk-ed-k">开始</span>
        <div className="dk-ed-v">
          <input type="date" className="dk-in tnum" aria-label="从哪天开始" value={d.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} />
        </div>
      </div>
      <div className="dk-ed-foot">
        <span className="dk-ed-tip">不进待办、不顺延；断一天没关系，别连着断两天</span>
        <span className="dk-grow" />
        <button type="button" className="dk-btn ghost" onClick={close}>
          取消
        </button>
        <button type="button" className="dk-btn primary" disabled={invalid} onClick={save}>
          {habit ? '保存' : '加习惯'}
        </button>
      </div>
    </div>
  );
}

// ── 抽屉「习惯」页 ──────────────────────────────────────────────────────

export function HabitList() {
  const habits = useStore((s) => s.habits);
  const list = useMemo(
    () =>
      Object.values(habits)
        .filter((h) => !h.deletedAt)
        .sort((a, b) => Number(Boolean(a.paused)) - Number(Boolean(b.paused)) || a.order - b.order),
    [habits],
  );
  const open = (e: React.MouseEvent, id: string | null) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openHabitEditor(id, r.left - 400, r.top);
  };
  return (
    <>
      <div className="dk-dr-tip">天天要做 / 要忍住的小事。显示在今天那列最上面，不算待办。点一行编辑。</div>
      <div className="dk-dr-act">
        <button type="button" className="dk-btn" onClick={(e) => open(e, null)}>
          ＋ 新习惯
        </button>
      </div>
      <div className="dk-dr-b">
        {list.length ? (
          list.map((h) => (
            <div key={h.id} className={`dk-rl${h.paused ? ' paused' : ''}`} onClick={(e) => open(e, h.id)} title={h.why ? `为什么：${h.why}` : h.title}>
              <div className="dk-rl-main">
                <span className="dk-rl-t">
                  {h.icon ? `${h.icon} ` : ''}
                  {h.title}
                </span>
                <span className="dk-rl-m tnum">
                  {h.kind === 'do' ? '要做' : '要忍住'}
                  {h.cue ? ` · ${h.cue}` : ''}
                  {h.time ? ` · ${h.time} 提醒` : ''}
                  {h.paused ? ' · 已暂停' : ''}
                </span>
              </div>
              <button
                type="button"
                className="dk-rl-b"
                onClick={(e) => {
                  e.stopPropagation();
                  setHabitPaused(h.id, !h.paused);
                  toastUndo(h.paused ? `已恢复「${h.title}」` : `已暂停「${h.title}」`);
                }}
              >
                {h.paused ? '恢复' : '暂停'}
              </button>
              <button
                type="button"
                className="dk-rl-b danger"
                title="删除这个习惯（打卡记录保留）"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteHabit(h.id);
                  toastUndo(`删除习惯「${h.title}」`);
                }}
              >
                删除
              </button>
            </div>
          ))
        ) : (
          <div className="dk-empty">还没有习惯。比如「刷完牙后冲牙」「不吃热食」</div>
        )}
      </div>
    </>
  );
}
