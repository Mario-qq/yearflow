/**
 * 人际 /people（docs/PEOPLE_SPEC.md）：把「情商」拆成可执行的流程 —— 给在意的人建档（爱的地图），
 * 定联系节奏（Personal CRM），聊完记一笔，重要日子提前 14 天倒推准备（爱的语言 + 点子池）。
 * 左栏：需要关注（该联系 / 快到的日子）+ 全部人；右栏：选中那个人的档案。选中的人记在 ?p= 上。
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Person, Relation } from '../types/domain';
import { useStore } from '../store/useStore';
import { useToday } from '../desk/useDeskData';
import { createPerson } from '../store/peopleActions';
import { agoLabel, contactStates, dateTitle, lastContactOf, RELATION_LABEL, upcomingDates } from '../lib/derive/people';
import { personColor } from '../desk/constants';
import { toastUndo } from '../desk/format';
import { PersonDetail } from '../people/PersonDetail';
import { usePrepGeneration } from '../people/usePreps';
import '../desk/desk.css';
import '../people/people.css';

const RELATION_ORDER: Relation[] = ['partner', 'family', 'friend', 'boss', 'colleague', 'other'];

function Method() {
  return (
    <div className="pp-method">
      <b>三件小事，把关系照顾好</b>
      <ol>
        <li>
          <b>定节奏</b>：给在意的人设「多久联系一次」，到点工作台会提醒你，不用靠记性。
        </li>
        <li>
          <b>记一笔</b>：聊完 10 秒记下 TA 的近况和提到想要的东西。下次见面先问一句「上次说的 X 怎么样了」—— 被记得是最好的礼物。
        </li>
        <li>
          <b>提前准备</b>：生日、纪念日提前 14 天在工作台排好「想礼物 → 定下来 → 写几句话」，按 TA 的「爱的语言」挑心意。
        </li>
      </ol>
    </div>
  );
}

export default function PeoplePage() {
  const today = useToday();
  usePrepGeneration(today);
  const people = useStore((s) => s.people);
  const interactions = useStore((s) => s.interactions);
  const workItems = useStore((s) => s.workItems);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');

  const list = useMemo(() => Object.values(people).filter((p) => !p.deletedAt), [people]);
  const items = useMemo(() => Object.values(workItems), [workItems]);
  const inter = useMemo(() => Object.values(interactions), [interactions]);
  const due = useMemo(() => contactStates(list, inter, items, today).filter((c) => c.over >= 0), [list, inter, items, today]);
  const soon = useMemo(() => upcomingDates(list, today, 30), [list, today]);
  /** 需要关注：一人一行，快到的日子在前，再接该联系的（同一个人两样都有就并在一行） */
  const attn = useMemo(() => {
    const m = new Map<string, { person: Person; date?: (typeof soon)[number]; contact?: (typeof due)[number] }>();
    for (const u of soon) if (!m.has(u.person.id)) m.set(u.person.id, { person: u.person, date: u });
    for (const c of due) m.set(c.person.id, { ...(m.get(c.person.id) ?? { person: c.person }), contact: c });
    return [...m.values()];
  }, [soon, due]);
  /** @人 跟进里出现过、还没建档的名字（一键建档） */
  const orphans = useMemo(() => {
    const names = new Set(list.map((p) => p.name));
    const n = new Map<string, number>();
    for (const w of items) if (!w.deletedAt && w.person && !names.has(w.person)) n.set(w.person, (n.get(w.person) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [list, items]);

  const selId = params.get('p');
  const sel = selId ? people[selId] : undefined;
  const select = (id: string | null) => setParams(id ? { p: id } : {}, { replace: true });

  const groups = useMemo(() => {
    const kw = q.trim();
    const shown = kw ? list.filter((p) => p.name.includes(kw) || p.notes?.includes(kw) || p.likes?.includes(kw)) : list;
    return RELATION_ORDER.map((r) => ({ r, people: shown.filter((p) => p.relation === r).sort((a, b) => a.order - b.order) })).filter((g) => g.people.length);
  }, [list, q]);

  const add = (name: string, relation: Relation = 'friend') => {
    if (!name.trim()) return;
    const id = createPerson(name, relation);
    setNewName('');
    select(id);
    toastUndo(`建了「${name.trim()}」的档案`);
  };

  const row = (p: Person, extra?: React.ReactNode) => (
    <button key={p.id} type="button" className={`pp-row${p.id === selId ? ' on' : ''}`} onClick={() => select(p.id)}>
      <span className="dk-av" style={{ '--c': personColor(p.name) } as React.CSSProperties}>
        {p.name[0]}
      </span>
      <span className="pp-row-n">{p.name}</span>
      <span className="pp-row-m tnum">{extra ?? agoLabel(lastContactOf(p, inter, items), today)}</span>
    </button>
  );

  return (
    <div className="dk pp">
      <aside className="pp-side">
        <div className="pp-side-h">
          <b>人际</b>
          <span className="tnum">{list.length} 人</span>
        </div>
        <div className="pp-new">
          <input
            className="dk-in"
            aria-label="新建档案"
            placeholder="＋ 名字，回车建档"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add(newName)}
          />
        </div>
        {list.length > 3 && <input className="dk-in pp-search" aria-label="搜索" placeholder="搜名字、喜好、背景" value={q} onChange={(e) => setQ(e.target.value)} />}

        {(due.length > 0 || soon.length > 0) && !q && (
          <div className="pp-group attn">
            <div className="pp-group-h">需要关注</div>
            {attn.map(({ person, date, contact }) =>
              row(
                person,
                <>
                  {date && <span className={date.days <= 14 ? 'soon' : ''}>{date.days === 0 ? `今天${date.date.label}` : `${date.date.label} ${date.days} 天`}</span>}
                  {date && contact && ' · '}
                  {contact && <span className="over">{contact.last ? `${contact.days} 天没联系` : '还没联系过'}</span>}
                </>,
              ),
            )}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.r} className="pp-group">
            <div className="pp-group-h">{RELATION_LABEL[g.r]}</div>
            {g.people.map((p) => row(p))}
          </div>
        ))}

        {orphans.length > 0 && !q && (
          <div className="pp-group">
            <div className="pp-group-h">工作台 @人 里还没建档的</div>
            <div className="pp-orphans">
              {orphans.slice(0, 12).map((n) => (
                <button key={n} type="button" className="pp-chip" onClick={() => add(n, 'colleague')} title="建档（关系默认同事，可改）">
                  ＋ {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <main className="pp-main">
        {sel ? (
          <PersonDetail key={sel.id} person={sel} today={today} onDeleted={() => select(null)} />
        ) : (
          <div className="pp-welcome">
            <Method />
            {soon.length > 0 && (
              <div className="pp-soon">
                <div className="pp-group-h">30 天内的日子</div>
                {soon.map((u) => (
                  <button key={`${u.person.id}-${u.date.id}`} type="button" className="pp-soon-row" onClick={() => select(u.person.id)}>
                    <span className="tnum">{u.days === 0 ? '今天' : `${u.days} 天后`}</span>
                    <span>{dateTitle(u)}</span>
                  </button>
                ))}
              </div>
            )}
            {!list.length && <div className="pp-empty">先在左上角写一个名字回车，从最在意的那个人开始。</div>}
          </div>
        )}
      </main>
    </div>
  );
}
