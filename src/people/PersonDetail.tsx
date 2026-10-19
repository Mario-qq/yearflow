/**
 * 人物档案右栏：抬头（名字 / 关系 / 联系节奏 / 上次联系）→ 记一笔 → 两栏：
 * 左 = 近况与互动时间线；右 = 重要日子、爱的语言、喜好 / 避开 / 背景、送礼点子池、待跟进的 @人 事项。
 * 文本框失焦保存（一次保存 = 一条撤销）。
 */
import { useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import type { LoveLanguage, Person, PersonDate, Relation } from '../types/domain';
import { useStore } from '../store/useStore';
import { addIdea, deleteInteraction, deletePerson, patchPerson, removeIdea, toggleIdeaUsed } from '../store/peopleActions';
import { agoLabel, interactionsOf, KIND_LABEL, lastContactOf, LOVE_LABEL, nextOccurrence, nthLabel, RELATION_LABEL } from '../lib/derive/people';
import { lunarLabel } from '../lib/lunar';
import { diffDays } from '../lib/date';
import { personColor } from '../desk/constants';
import { md, toastUndo } from '../desk/format';
import { showToast } from '../lib/toast';
import { QuickLog } from './QuickLog';

const CADENCES: [number, string][] = [
  [0, '不提醒'],
  [7, '每周'],
  [14, '每两周'],
  [30, '每月'],
  [60, '每两个月'],
  [90, '每季度'],
  [180, '每半年'],
];
const RELATIONS = Object.keys(RELATION_LABEL) as Relation[];
const LOVES = Object.keys(LOVE_LABEL) as LoveLanguage[];

/** 失焦才保存的文本框：避免每敲一个字进一次撤销栈 */
function BlurText({ value, onSave, label, placeholder, rows = 2 }: { value?: string; onSave: (v: string) => void; label: string; placeholder: string; rows?: number }) {
  const [v, setV] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setV(value ?? '');
  }
  return (
    <label className="pp-field">
      <span>{label}</span>
      <textarea
        className="dk-in pp-text"
        rows={rows}
        aria-label={label}
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() !== (value ?? '').trim() && onSave(v)}
      />
    </label>
  );
}

function Sec({ title, hint, children, act }: { title: string; hint?: string; children: React.ReactNode; act?: React.ReactNode }) {
  return (
    <section className="pp-sec">
      <div className="pp-sec-h">
        <span>{title}</span>
        {hint && <small>{hint}</small>}
        <span className="dk-grow" />
        {act}
      </div>
      {children}
    </section>
  );
}

function dateLabel(d: PersonDate): string {
  return d.lunar ? `农历${lunarLabel(d.month, d.day)}` : `${d.month} 月 ${d.day} 日`;
}

function DateEditor({ onAdd }: { onAdd: (d: PersonDate) => void }) {
  const [d, setD] = useState<PersonDate>({ id: '', label: '生日', month: 1, day: 1 });
  const set = (p: Partial<PersonDate>) => setD((x) => ({ ...x, ...p }));
  const maxDay = d.lunar ? 30 : 31;
  return (
    <div className="pp-dadd">
      <input className="dk-in" style={{ width: 92 }} aria-label="什么日子" list="pp-date-labels" value={d.label} onChange={(e) => set({ label: e.target.value })} />
      <datalist id="pp-date-labels">
        {['生日', '结婚纪念日', '恋爱纪念日', '认识的日子', '入职纪念日'].map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <div className="dk-seg" role="radiogroup" aria-label="公历或农历">
        <button type="button" role="radio" aria-checked={!d.lunar} className={!d.lunar ? 'on' : ''} onClick={() => set({ lunar: undefined })}>
          公历
        </button>
        <button type="button" role="radio" aria-checked={Boolean(d.lunar)} className={d.lunar ? 'on' : ''} onClick={() => set({ lunar: true, day: Math.min(d.day, 30) })}>
          农历
        </button>
      </div>
      <select className="dk-in" aria-label="月" value={d.month} onChange={(e) => set({ month: Number(e.target.value) })}>
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i} value={i + 1}>
            {d.lunar ? lunarLabel(i + 1, 1).slice(0, -2) : `${i + 1} 月`}
          </option>
        ))}
      </select>
      <select className="dk-in" aria-label="日" value={d.day} onChange={(e) => set({ day: Number(e.target.value) })}>
        {Array.from({ length: maxDay }, (_, i) => (
          <option key={i} value={i + 1}>
            {d.lunar ? lunarLabel(1, i + 1).slice(2) : `${i + 1} 日`}
          </option>
        ))}
      </select>
      <input
        className="dk-in tnum"
        style={{ width: 70 }}
        aria-label="起始年（可选）"
        placeholder="哪年(可选)"
        inputMode="numeric"
        value={d.year ?? ''}
        onChange={(e) => set({ year: /^\d{4}$/.test(e.target.value) ? Number(e.target.value) : e.target.value ? d.year : undefined })}
      />
      <button type="button" className="dk-btn" disabled={!d.label.trim()} onClick={() => onAdd({ ...d, id: nanoid(8), label: d.label.trim() })}>
        添加
      </button>
    </div>
  );
}

export function PersonDetail({ person: p, today, onDeleted }: { person: Person; today: string; onDeleted: () => void }) {
  const interactions = useStore((s) => s.interactions);
  const workItems = useStore((s) => s.workItems);
  const [name, setName] = useState(p.name);
  const [prevName, setPrevName] = useState(p.name);
  if (prevName !== p.name) {
    setPrevName(p.name);
    setName(p.name);
  }
  const [adding, setAdding] = useState(false);
  const [idea, setIdea] = useState('');

  const items = useMemo(() => Object.values(workItems), [workItems]);
  const timeline = useMemo(() => interactionsOf(p.id, Object.values(interactions)), [p.id, interactions]);
  const last = lastContactOf(p, timeline, items);
  const followups = items.filter((w) => w.person === p.name && w.status === 'open' && !w.deletedAt);
  const learned = timeline.filter((i) => i.learned);
  const custom = p.cadenceDays && !CADENCES.some(([n]) => n === p.cadenceDays);
  const overDays = p.cadenceDays && last ? diffDays(today, last) - p.cadenceDays : null;

  const saveName = () => {
    if (name.trim() === p.name) return;
    if (!patchPerson(p.id, { name }, `改名为「${name.trim()}」`)) {
      showToast(name.trim() ? `已经有叫「${name.trim()}」的档案了` : '名字不能为空');
      setName(p.name);
    } else toastUndo(`改名为「${name.trim()}」（没做完的 @人 跟进一起改了）`);
  };
  const dates = [...(p.dates ?? [])].map((d) => ({ d, on: nextOccurrence(d, today) })).sort((a, b) => (a.on ?? '9').localeCompare(b.on ?? '9'));

  return (
    <div className="pp-detail">
      <header className="pp-head">
        <span className="dk-av pp-av" style={{ '--c': personColor(p.name) } as React.CSSProperties}>
          {p.name[0]}
        </span>
        <div className="pp-head-main">
          <input className="pp-name" aria-label="名字" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <div className="pp-head-meta">
            <select className="dk-in" aria-label="关系" value={p.relation} onChange={(e) => patchPerson(p.id, { relation: e.target.value as Relation })}>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {RELATION_LABEL[r]}
                </option>
              ))}
            </select>
            <span className="pp-k">联系节奏</span>
            <select
              className="dk-in"
              aria-label="联系节奏"
              value={p.cadenceDays ?? 0}
              onChange={(e) => patchPerson(p.id, { cadenceDays: Number(e.target.value) || undefined })}
            >
              {CADENCES.map(([n, l]) => (
                <option key={n} value={n}>
                  {l}
                </option>
              ))}
              {custom && <option value={p.cadenceDays}>每 {p.cadenceDays} 天</option>}
            </select>
            <span className={`pp-last tnum${overDays !== null && overDays >= 0 ? ' over' : ''}`}>
              上次联系：{agoLabel(last, today)}
              {overDays !== null && overDays >= 0 ? ` · 该联系了` : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="dk-btn ghost pp-del"
          onClick={() => {
            deletePerson(p.id);
            toastUndo(`删除了「${p.name}」的档案`);
            onDeleted();
          }}
        >
          删除档案
        </button>
      </header>

      <QuickLog key={p.id} personId={p.id} name={p.name} today={today} />

      <div className="pp-cols">
        <div className="pp-col">
          <Sec title="近况" hint="记一笔时「新知道的事」都在这里">
            {learned.length ? (
              <ul className="pp-learned">
                {learned.slice(0, 8).map((i) => (
                  <li key={i.id}>
                    <span>{i.learned}</span>
                    <small className="tnum">{md(i.date)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="pp-empty">还没记过。下次聊天留意 TA 最近在忙什么、在意什么</div>
            )}
          </Sec>
          <Sec title="互动记录" hint={timeline.length ? `${timeline.length} 次` : undefined}>
            {timeline.length ? (
              <ul className="pp-timeline">
                {timeline.slice(0, 30).map((i) => (
                  <li key={i.id}>
                    <span className="pp-tl-d tnum">{md(i.date)}</span>
                    <span className="pp-tl-k">{KIND_LABEL[i.kind]}</span>
                    <span className="pp-tl-t">{i.note || (i.learned ? '' : '联系了一次')}</span>
                    <button
                      type="button"
                      className="pp-x"
                      title="删除这条"
                      aria-label="删除这条"
                      onClick={() => {
                        deleteInteraction(i.id);
                        toastUndo('删除了一条互动记录');
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="pp-empty">还没有记录</div>
            )}
          </Sec>
        </div>

        <div className="pp-col">
          <Sec
            title="重要日子"
            hint="提前 14 天在工作台排好准备"
            act={
              <button type="button" className="dk-ed-x" onClick={() => setAdding((x) => !x)}>
                {adding ? '收起' : '＋ 添加'}
              </button>
            }
          >
            {adding && (
              <DateEditor
                onAdd={(d) => {
                  patchPerson(p.id, { dates: [...(p.dates ?? []), d] }, `给「${p.name}」加了${d.label}`);
                  setAdding(false);
                }}
              />
            )}
            {dates.length ? (
              <ul className="pp-dates">
                {dates.map(({ d, on }) => {
                  const days = on ? diffDays(on, today) : null;
                  return (
                    <li key={d.id}>
                      <span className="pp-d-l">{d.label}</span>
                      <span className="pp-d-v tnum">{dateLabel(d)}</span>
                      <span className={`pp-d-n tnum${days !== null && days <= 14 ? ' soon' : ''}`}>
                        {days === null ? '' : days === 0 ? '今天' : `${md(on!)} · 还有 ${days} 天`}
                        {on && d.year && nthLabel(d.label, Number(on.slice(0, 4)) - d.year) ? ` · ${nthLabel(d.label, Number(on.slice(0, 4)) - d.year)}` : ''}
                      </span>
                      <label className="pp-d-prep" title="提前 14 / 7 / 1 天在工作台生成准备待办">
                        <input
                          type="checkbox"
                          checked={!d.noPrep}
                          onChange={() => patchPerson(p.id, { dates: (p.dates ?? []).map((x) => (x.id === d.id ? { ...x, noPrep: x.noPrep ? undefined : true } : x)) })}
                        />
                        提前准备
                      </label>
                      <button
                        type="button"
                        className="pp-x"
                        aria-label={`删除${d.label}`}
                        onClick={() => {
                          patchPerson(p.id, { dates: (p.dates ?? []).filter((x) => x.id !== d.id) }, `删除「${p.name}」的${d.label}`);
                          toastUndo(`删除了${d.label}`);
                        }}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              !adding && <div className="pp-empty">生日、纪念日。支持农历</div>
            )}
          </Sec>

          <Sec title="爱的语言" hint="TA 最在意哪种心意（可多选，第一个最重要）">
            <div className="pp-loves">
              {LOVES.map((l) => {
                const on = p.loveLanguages?.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    className={on ? 'on' : ''}
                    aria-pressed={on}
                    title={LOVE_LABEL[l].tip}
                    onClick={() => patchPerson(p.id, { loveLanguages: on ? p.loveLanguages!.filter((x) => x !== l) : [...(p.loveLanguages ?? []), l] })}
                  >
                    {LOVE_LABEL[l].name}
                  </button>
                );
              })}
            </div>
            {p.loveLanguages?.[0] && <div className="pp-tip">想表达心意时：{LOVE_LABEL[p.loveLanguages[0]].tip}</div>}
          </Sec>

          <Sec title="喜好与避开">
            <BlurText label="喜欢" placeholder="吃的、颜色、牌子、爱好…" value={p.likes} onSave={(v) => patchPerson(p.id, { likes: v })} />
            <BlurText label="避开" placeholder="忌口、过敏、不爱聊的话题…" value={p.dislikes} onSave={(v) => patchPerson(p.id, { dislikes: v })} />
            <BlurText label="背景" placeholder="家里情况、工作、在意的事" value={p.notes} rows={3} onSave={(v) => patchPerson(p.id, { notes: v })} />
          </Sec>

          <Sec title="送礼点子池" hint="TA 随口提过想要的，马上记下">
            <div className="pp-idea-add">
              <input
                className="dk-in"
                aria-label="新点子"
                placeholder="比如：提过想去看海 / 耳机坏了"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && idea.trim()) {
                    addIdea(p.id, idea, today);
                    setIdea('');
                  }
                }}
              />
              <button
                type="button"
                className="dk-btn"
                disabled={!idea.trim()}
                onClick={() => {
                  addIdea(p.id, idea, today);
                  setIdea('');
                }}
              >
                记下
              </button>
            </div>
            {(p.ideas ?? []).length > 0 && (
              <ul className="pp-ideas">
                {[...(p.ideas ?? [])]
                  .sort((a, b) => Number(Boolean(a.used)) - Number(Boolean(b.used)) || b.at.localeCompare(a.at))
                  .map((i) => (
                    <li key={i.id} className={i.used ? 'used' : ''}>
                      <button type="button" className="pp-idea-ck" aria-pressed={Boolean(i.used)} title={i.used ? '标为没用过' : '用掉了'} onClick={() => toggleIdeaUsed(p.id, i.id, today)}>
                        {i.used ? '✓' : ''}
                      </button>
                      <span>{i.text}</span>
                      <small className="tnum">{i.used ? `${md(i.used)} 用了` : md(i.at)}</small>
                      <button type="button" className="pp-x" aria-label="删除点子" onClick={() => removeIdea(p.id, i.id)}>
                        ×
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </Sec>

          {followups.length > 0 && (
            <Sec title="要跟 TA 说的" hint="工作台 @人 跟进">
              <ul className="pp-fu">
                {followups.map((w) => (
                  <li key={w.id}>
                    <span>{w.title}</span>
                    <small className="tnum">{w.date ? md(w.date) : '待处理'}</small>
                  </li>
                ))}
              </ul>
            </Sec>
          )}
        </div>
      </div>
    </div>
  );
}
