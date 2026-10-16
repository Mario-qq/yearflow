/**
 * 人物卡：点任何 @人（或今日脉搏里的人名）浮出 TA 的全部未完成跟进，周历里同时高亮 TA 的事项、其余淡化。
 * 「复制给 TA」生成一段可直接贴进聊天工具的话；「全部标为已说」一键完成。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { followupsByPerson } from '../lib/derive/desk';
import { markPersonSaid } from '../store/deskActions';
import { copyTextFor } from './commands';
import { showToast } from '../lib/toast';
import { personColor } from './constants';
import { toastUndo } from './format';
import { ItemRow } from './Rows';
import { useDeskUi } from './uiStore';
import type { WorkItem } from '../types/domain';

export function PersonCard({ items, today }: { items: WorkItem[]; today: string }) {
  const person = useDeskUi((s) => s.person);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const group = useMemo(() => (person ? followupsByPerson(items, today).find((g) => g.person === person.name) : undefined), [items, today, person]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!person || !el) return setPos(null);
    setPos({
      left: Math.max(8, Math.min(person.left - 20, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(person.top + 6, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [person, group?.items.length]);

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
