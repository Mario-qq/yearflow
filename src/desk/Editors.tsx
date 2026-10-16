/**
 * 编辑卡：事项（标题、备注、待办/跟进与对象、紧急度、排期、截止、目标、范围）与例行（标题、规则、时间、范围、起始日、备注）。
 * 行右键「编辑…」、选中一件按 Enter、例行列表点一行打开；新建例行也用它。
 * 草稿在卡内，「保存」一次落库 = 一条撤销记录；Esc / 点外面 = 放弃。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Routine, RoutineRule, Urgency, WorkItem, WorkScope } from '../types/domain';
import { useStore } from '../store/useStore';
import { createRoutine, editItem, patchRoutine } from '../store/deskActions';
import { ruleLabel } from '../lib/derive/desk';
import { relDay, md, toastUndo } from './format';
import { useDeskUi } from './uiStore';

const close = () => useDeskUi.getState().set({ editor: null });

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="dk-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="dk-ed-f">
      <span className="dk-ed-k">{k}</span>
      <div className="dk-ed-v">{children}</div>
    </div>
  );
}

/** 编辑卡内的按键：不让工作台快捷键（N/I/W/M/数字…）抢走；Esc 放弃；Ctrl+Enter 保存（单行框里 Enter 也保存） */
function edKeys(save: () => void) {
  return (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.ctrlKey || e.metaKey || (e.target as HTMLElement).tagName === 'INPUT')) {
      e.preventDefault();
      save();
    }
  };
}

const URGENCY_OPTS: [Urgency, string][] = [
  ['urgent', '紧急'],
  ['soon', '尽快'],
  ['normal', '普通'],
];
const SCOPE_OPTS: [WorkScope, string][] = [
  ['work', '工作'],
  ['life', '生活'],
];

// ── 事项 ─────────────────────────────────────────────────────────────────

function ItemEditor({ item, today }: { item: WorkItem; today: string }) {
  const goals = useStore((s) => s.goals);
  const workItems = useStore((s) => s.workItems);
  const [d, setD] = useState<WorkItem>(item);
  const set = (patch: Partial<WorkItem>) => setD((x) => ({ ...x, ...patch }));

  /** 对象自动补全：按历史出现次数排 */
  const people = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of Object.values(workItems)) if (!i.deletedAt && i.person) n.set(i.person, (n.get(i.person) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [workItems]);
  const goalList = Object.values(goals)
    .filter((g) => !g.deletedAt && (!g.archived || g.id === item.goalId))
    .sort((a, b) => a.order - b.order);

  const save = () => {
    const patch: Partial<WorkItem> = {
      title: d.title,
      note: d.note?.trim() || undefined,
      kind: d.kind,
      person: d.kind === 'followup' ? d.person?.trim() || undefined : undefined,
      mode: d.kind === 'followup' ? (d.mode ?? 'inform') : undefined,
      urgency: d.urgency,
      date: d.date || undefined,
      dueDate: d.dueDate || undefined,
      goalId: d.goalId || undefined,
      scope: d.scope,
    };
    const changed = editItem(item.id, patch);
    close();
    if (changed) {
      const lostPerson = d.kind === 'followup' && !d.person?.trim();
      toastUndo(lostPerson ? '已保存（没写对象，按待办存）' : `已保存「${d.title.trim() || item.title}」`);
    }
  };
  const keys = edKeys(save);

  return (
    <div className="dk-ed-b" onKeyDown={keys}>
      <input className="dk-in dk-ed-title" autoFocus value={d.title} aria-label="标题" onChange={(e) => set({ title: e.target.value })} />
      <Field k="类型">
        <Seg
          label="类型"
          value={d.kind}
          options={[
            ['todo', '待办'],
            ['followup', '跟进'],
          ]}
          onChange={(kind) => set({ kind })}
        />
        {d.kind === 'followup' && (
          <>
            <input className="dk-in" list="dk-people" placeholder="对象" aria-label="跟进对象" value={d.person ?? ''} onChange={(e) => set({ person: e.target.value })} style={{ width: 92 }} />
            <datalist id="dk-people">
              {people.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <Seg
              label="告知或下发"
              value={d.mode ?? 'inform'}
              options={[
                ['inform', '告知'],
                ['dispatch', '下发'],
              ]}
              onChange={(mode) => set({ mode })}
            />
          </>
        )}
      </Field>
      <Field k="紧急度">
        <Seg label="紧急度" value={d.urgency} options={URGENCY_OPTS} onChange={(urgency) => set({ urgency })} />
      </Field>
      <Field k="哪天做">
        <input type="date" className="dk-in tnum" aria-label="排期日" value={d.date ?? ''} onChange={(e) => set({ date: e.target.value || undefined })} />
        {d.date ? (
          <>
            <span className="dk-ed-tip">{relDay(d.date, today)}</span>
            <button type="button" className="dk-ed-x" onClick={() => set({ date: undefined })}>
              放进待处理
            </button>
          </>
        ) : (
          <span className="dk-ed-tip">待处理（还没排日子）</span>
        )}
      </Field>
      <Field k="截止">
        <input type="date" className="dk-in tnum" aria-label="截止日" value={d.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || undefined })} />
        {d.dueDate && (
          <button type="button" className="dk-ed-x" onClick={() => set({ dueDate: undefined })}>
            清除
          </button>
        )}
        {d.dueDate && d.date && d.date > d.dueDate && <span className="dk-ed-tip warn">排在截止日 {md(d.dueDate)} 之后</span>}
      </Field>
      <Field k="目标">
        <select className="dk-in" aria-label="关联目标" value={d.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value || undefined })}>
          <option value="">不关联</option>
          {goalList.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <span className="dk-ed-tip">只作标签，不计入甘特进度</span>
      </Field>
      <Field k="范围">
        <Seg label="范围" value={d.scope} options={SCOPE_OPTS} onChange={(scope) => set({ scope })} />
      </Field>
      <textarea className="dk-in dk-ed-note" rows={3} placeholder="备注（可选）" aria-label="备注" value={d.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
      <div className="dk-ed-foot">
        <span className="dk-ed-tip">
          <kbd>Ctrl</kbd>+<kbd>↵</kbd> 保存 · <kbd>Esc</kbd> 放弃
        </span>
        <span className="dk-grow" />
        <button type="button" className="dk-btn ghost" onClick={close}>
          取消
        </button>
        <button type="button" className="dk-btn primary" onClick={save}>
          保存
        </button>
      </div>
    </div>
  );
}

// ── 例行 ─────────────────────────────────────────────────────────────────

type RuleType = RoutineRule['type'];
const RULE_OPTS: [RuleType, string][] = [
  ['daily', '每天'],
  ['workday', '工作日'],
  ['weekly', '每周'],
  ['monthlyDay', '每月几号'],
  ['monthlyNth', '每月第几个'],
];
/** 周一在前 */
const WEEK: [number, string][] = [
  [1, '一'],
  [2, '二'],
  [3, '三'],
  [4, '四'],
  [5, '五'],
  [6, '六'],
  [0, '日'],
];

/** 切换规则类型时给一个合理的默认参数（尽量沿用今天的星期/日期） */
function defaultRule(type: RuleType, today: string): RoutineRule {
  const d = new Date(`${today}T00:00:00`);
  switch (type) {
    case 'daily':
      return { type };
    case 'workday':
      return { type };
    case 'weekly':
      return { type, daysOfWeek: [d.getDay()] };
    case 'monthlyDay':
      return { type, monthDay: d.getDate() };
    case 'monthlyNth':
      return { type, nth: Math.ceil(d.getDate() / 7) > 4 ? -1 : Math.ceil(d.getDate() / 7), weekday: d.getDay() };
  }
}

interface RoutineDraft {
  title: string;
  note?: string;
  scope: WorkScope;
  rule: RoutineRule;
  time?: string;
  startDate: string;
}

function RoutineEditor({ routine, today }: { routine?: Routine; today: string }) {
  const [d, setD] = useState<RoutineDraft>(() =>
    routine
      ? { title: routine.title, note: routine.note, scope: routine.scope, rule: routine.rule, time: routine.time, startDate: routine.startDate }
      : { title: '', scope: 'work', rule: { type: 'workday' }, startDate: today },
  );
  const set = (patch: Partial<RoutineDraft>) => setD((x) => ({ ...x, ...patch }));
  const r = d.rule;
  const invalid = !d.title.trim() || (r.type === 'weekly' && r.daysOfWeek.length === 0);

  const save = () => {
    if (invalid) return;
    const title = d.title.trim();
    const note = d.note?.trim() || undefined;
    if (routine) {
      patchRoutine(routine.id, { title, note, scope: d.scope, rule: d.rule, time: d.time || undefined, startDate: d.startDate }, `编辑例行「${title}」`);
      toastUndo(`已保存例行「${title}」`);
    } else {
      createRoutine({ title, note, scope: d.scope, rule: d.rule, time: d.time, startDate: d.startDate });
      toastUndo(`已建例行：${title}（${ruleLabel(d.rule)}）`);
    }
    close();
  };
  const keys = edKeys(save);

  return (
    <div className="dk-ed-b" onKeyDown={keys}>
      <input className="dk-in dk-ed-title" autoFocus value={d.title} placeholder="例行要做什么，如「提交周报」" aria-label="例行标题" onChange={(e) => set({ title: e.target.value })} />
      <Field k="规则">
        <Seg label="规则" value={r.type} options={RULE_OPTS} onChange={(t) => set({ rule: defaultRule(t, today) })} />
      </Field>
      {r.type === 'weekly' && (
        <Field k="星期">
          <div className="dk-ed-days">
            {WEEK.map(([dow, name]) => {
              const on = r.daysOfWeek.includes(dow);
              return (
                <button
                  key={dow}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'on' : ''}
                  onClick={() => set({ rule: { type: 'weekly', daysOfWeek: on ? r.daysOfWeek.filter((x) => x !== dow) : [...r.daysOfWeek, dow].sort() } })}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      {r.type === 'monthlyDay' && (
        <Field k="几号">
          <select className="dk-in tnum" aria-label="每月几号" value={r.monthDay} onChange={(e) => set({ rule: { type: 'monthlyDay', monthDay: Number(e.target.value) } })}>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1} 号
              </option>
            ))}
            <option value={-1}>最后一天</option>
          </select>
          {r.monthDay >= 29 && <span className="dk-ed-tip">小月没有这天时落在月末</span>}
        </Field>
      )}
      {r.type === 'monthlyNth' && (
        <Field k="第几个">
          <select className="dk-in" aria-label="第几个" value={r.nth} onChange={(e) => set({ rule: { ...r, nth: Number(e.target.value) } })}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                第 {n} 个
              </option>
            ))}
            <option value={-1}>最后一个</option>
          </select>
          <select className="dk-in" aria-label="周几" value={r.weekday} onChange={(e) => set({ rule: { ...r, weekday: Number(e.target.value) } })}>
            {WEEK.map(([dow, name]) => (
              <option key={dow} value={dow}>
                周{name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field k="时间">
        <input type="time" className="dk-in tnum" aria-label="时间点" value={d.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} />
        {d.time ? (
          <button type="button" className="dk-ed-x" onClick={() => set({ time: undefined })}>
            清除
          </button>
        ) : (
          <span className="dk-ed-tip">可选，只用于排序</span>
        )}
      </Field>
      <Field k="范围">
        <Seg label="范围" value={d.scope} options={SCOPE_OPTS} onChange={(scope) => set({ scope })} />
        <span className="dk-ed-tip">{d.scope === 'work' ? '只在工作日出现（遵守休/班标记）' : '每天都按规则出现'}</span>
      </Field>
      <Field k="开始">
        <input type="date" className="dk-in tnum" aria-label="从哪天开始" value={d.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} />
      </Field>
      <textarea className="dk-in dk-ed-note" rows={2} placeholder="备注（可选）" aria-label="备注" value={d.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
      <div className="dk-ed-foot">
        <span className="dk-ed-tip">{ruleLabel(d.rule)}{d.time ? ` ${d.time}` : ''}</span>
        <span className="dk-grow" />
        <button type="button" className="dk-btn ghost" onClick={close}>
          取消
        </button>
        <button type="button" className="dk-btn primary" disabled={invalid} onClick={save}>
          {routine ? '保存' : '建例行'}
        </button>
      </div>
    </div>
  );
}

// ── 浮层 ─────────────────────────────────────────────────────────────────

export function DeskEditorPop({ today }: { today: string }) {
  const ed = useDeskUi((s) => s.editor);
  const item = useStore((s) => (ed?.kind === 'item' ? s.workItems[ed.id] : undefined));
  const routine = useStore((s) => (ed?.kind === 'routine' && ed.id ? s.routines[ed.id] : undefined));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!ed || !el) return setPos(null);
    setPos({
      left: Math.max(8, Math.min(ed.left, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(ed.top + 4, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [ed]);

  if (!ed) return null;
  if (ed.kind === 'item' && !item) return null;
  return (
    <div
      ref={ref}
      className="dk-pop dk-ed"
      role="dialog"
      aria-label={ed.kind === 'item' ? '编辑事项' : routine ? '编辑例行' : '新建例行'}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dk-pop-h">
        <b>{ed.kind === 'item' ? '编辑事项' : routine ? '编辑例行' : '新建例行'}</b>
        {ed.kind === 'routine' && routine && <small>做过的记录都保留</small>}
      </div>
      {ed.kind === 'item' && item ? <ItemEditor key={item.id} item={item} today={today} /> : <RoutineEditor key={ed.id ?? 'new'} routine={routine} today={today} />}
    </div>
  );
}
