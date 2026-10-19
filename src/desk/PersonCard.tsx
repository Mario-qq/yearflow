/**
 * 人物卡：点任何 @人（或今日脉搏里的人名）浮出 TA 的全部未完成跟进，周历里同时高亮 TA 的事项、其余淡化。
 * 「复制给 TA」生成一段可直接贴进聊天工具的话；「全部标为已说」一键完成。
 * 建过人际档案的人，卡头下面多一段摘要（关系 · 上次联系 · 快到的日子 · 最新近况）+「记一笔」「打开档案」（开人际弹窗）。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { createPerson } from '../store/peopleActions';
import { agoLabel, interactionsOf, lastContactOf, LOVE_LABEL, RELATION_LABEL, upcomingDates } from '../lib/derive/people';
import { diffDays } from '../lib/date';
import { QuickLog } from '../people/QuickLog';
import { md } from './format';
// 档案摘要 / 记一笔的样式在人际页的样式表里（人际页是 lazy 的，工作台要自己引）
import '../people/people.css';
import { followupsByPerson } from '../lib/derive/desk';
import { markPersonSaid } from '../store/deskActions';
import { copyTextFor } from './commands';
import { showToast } from '../lib/toast';
import { personColor } from './constants';
import { toastUndo } from './format';
import { ItemRow } from './Rows';
import { useDeskUi } from './uiStore';
import type { WorkItem } from '../types/domain';

/** 档案摘要：没建档时给一个「建档」 */
function Profile({ name, items, today, onResize }: { name: string; items: WorkItem[]; today: string; onResize: () => void }) {
  const people = useStore((s) => s.people);
  const interactions = useStore((s) => s.interactions);
  const [logging, setLogging] = useState(false);
  const p = useMemo(() => Object.values(people).find((x) => x.name === name), [people, name]);
  const info = useMemo(() => {
    if (!p) return null;
    const list = Object.values(interactions);
    const last = lastContactOf(p, list, items);
    const over = Boolean(p.cadenceDays && diffDays(today, last ?? p.createdAt.slice(0, 10)) >= p.cadenceDays);
    const next = upcomingDates([p], today, 30)[0];
    const learned = interactionsOf(p.id, list).find((i) => i.learned)?.learned;
    return { last, over, next, learned };
  }, [p, interactions, items, today]);
  if (!p || !info) {
    return (
      <div className="pp-card">
        <div className="pp-card-line">
          <span>还没有 TA 的人际档案</span>
          <span className="dk-grow" />
          <button type="button" className="dk-ed-x" onClick={() => (createPerson(name, 'colleague'), toastUndo(`建了「${name}」的档案（关系默认同事）`))}>
            ＋ 建档
          </button>
        </div>
      </div>
    );
  }
  const { last, over, next, learned } = info;
  return (
    <div className="pp-card">
      <div className="pp-card-line tnum">
        <span>{RELATION_LABEL[p.relation]}</span>
        <span className={over ? 'over' : undefined}>
          上次联系 {agoLabel(last, today)}
          {over ? ' · 该联系了' : ''}
        </span>
        {next && (
          <span className={next.days <= 14 ? 'soon' : undefined}>
            {next.date.label} {next.days === 0 ? '就是今天' : `${md(next.on)} · ${next.days} 天`}
          </span>
        )}
        {p.loveLanguages?.[0] && <span>看重{LOVE_LABEL[p.loveLanguages[0]].name}</span>}
      </div>
      {learned && <div className="pp-card-learned">{learned}</div>}
      {logging && (
        <QuickLog
          personId={p.id}
          name={p.name}
          today={today}
          compact
          onDone={() => {
            setLogging(false);
            onResize();
          }}
        />
      )}
      <div className="pp-card-line">
        <button
          type="button"
          className="dk-ed-x"
          onClick={() => {
            setLogging((x) => !x);
            onResize();
          }}
        >
          {logging ? '收起' : '记一笔'}
        </button>
        <button
          type="button"
          className="dk-ed-x"
          onClick={() => useDeskUi.getState().set({ person: null, personLit: null, people: { id: p.id } })}
        >
          打开档案 →
        </button>
      </div>
    </div>
  );
}

export function PersonCard({ items, today }: { items: WorkItem[]; today: string }) {
  const person = useDeskUi((s) => s.person);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** 卡里内容变高（展开「记一笔」）后重新夹进屏内 */
  const [tick, setTick] = useState(0);
  const group = useMemo(() => (person ? followupsByPerson(items, today).find((g) => g.person === person.name) : undefined), [items, today, person]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!person || !el) return setPos(null);
    setPos({
      left: Math.max(8, Math.min(person.left - 20, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(person.top + 6, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [person, group?.items.length, tick]);

  if (!person) return null;
  const close = () => useDeskUi.getState().set({ person: null, personLit: null });
  const list = group?.items ?? [];

  return (
    <div ref={ref} className="dk-pop" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }} onClick={(e) => e.stopPropagation()}>
      <div className="dk-pop-h">
        <span className="dk-av" style={{ '--c': personColor(person.name) } as React.CSSProperties}>
          {person.name[0]}
        </span>
        <div>
          <b>{person.name}</b>
          <small className="tnum">{list.length ? `${list.length} 件要跟进 · 最久挂了 ${group!.oldestDays} 天 · 周历里已高亮` : '没有要跟进的事了'}</small>
        </div>
      </div>
      <Profile name={person.name} items={items} today={today} onResize={() => setTimeout(() => setTick((t) => t + 1), 0)} />
      {list.map((i) => (
        <ItemRow key={i.id} item={i} today={today} showWhen hideWho />
      ))}
      <div className="dk-pop-foot">
        <button
          type="button"
          className="dk-btn primary"
          disabled={!list.length}
          onClick={() => {
            void navigator.clipboard
              .writeText(copyTextFor(person.name, list))
              .then(() => showToast(`已复制 ${list.length} 件，贴进聊天即可`))
              .catch(() => showToast('复制失败：浏览器不允许访问剪贴板'));
          }}
        >
          复制给 TA
        </button>
        <button
          type="button"
          className="dk-btn"
          disabled={!list.length}
          onClick={() => {
            markPersonSaid(person.name);
            toastUndo(`${person.name} 的 ${list.length} 件跟进已标为已说`);
            close();
          }}
        >
          全部标为已说
        </button>
        <span className="dk-grow" />
        <button type="button" className="dk-btn ghost" onClick={close}>
          关闭
        </button>
      </div>
    </div>
  );
}
