/**
 * 「记一笔」：聊完 10 秒记下和谁、怎么联系的、聊了什么、新知道的事（进 TA 的近况）。
 * 人际页顶上的大号版和工作台人物卡里的紧凑版共用。
 */
import { useState } from 'react';
import type { InteractionKind } from '../types/domain';
import { logInteraction } from '../store/peopleActions';
import { KIND_LABEL } from '../lib/derive/people';
import { toastUndo } from '../desk/format';

const KINDS = Object.keys(KIND_LABEL) as InteractionKind[];

export function QuickLog({ personId, name, today, compact, onDone }: { personId: string; name: string; today: string; compact?: boolean; onDone?: () => void }) {
  const [kind, setKind] = useState<InteractionKind>('chat');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [learned, setLearned] = useState('');
  const empty = !note.trim() && !learned.trim();

  const save = () => {
    logInteraction({ personId, date, kind, note, learned });
    toastUndo(`记下了：和${name}${KIND_LABEL[kind]}${learned.trim() ? '（新知道的事已进近况）' : ''}`);
    setNote('');
    setLearned('');
    setDate(today);
    onDone?.();
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT')) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className={`pp-log${compact ? ' compact' : ''}`} onKeyDown={keys}>
      <div className="pp-log-top">
        <div className="dk-seg" role="radiogroup" aria-label="怎么联系的">
          {KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {!compact && <input type="date" className="dk-in tnum" aria-label="哪天" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />}
      </div>
      <input className="dk-in" aria-label="聊了什么" placeholder={`和${name}聊了什么 / 做了什么`} value={note} onChange={(e) => setNote(e.target.value)} />
      <input
        className="dk-in"
        aria-label="新知道的事"
        placeholder="新知道的事：近况、在意的、提到想要的…（会进 TA 的近况）"
        value={learned}
        onChange={(e) => setLearned(e.target.value)}
      />
      <div className="pp-log-foot">
        {!compact && <span className="pp-tip">没话题时问问 TA 的家人 · 工作 · 爱好 · 打算（FORD）</span>}
        <span className="dk-grow" />
        <button type="button" className="dk-btn primary" onClick={save} title="只点也行：记一次联系">
          {empty ? '记一次联系' : '记一笔'}
        </button>
      </div>
    </div>
  );
}
