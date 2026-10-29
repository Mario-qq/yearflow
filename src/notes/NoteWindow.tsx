/**
 * 桌面版独立窗口里的便签（入口 src/note-main.tsx / note.html）：
 * · 贴纸（?id=…）：一张贴在桌面上的便签，直接改字；顶条可拖动、换色、回面板、取下。
 * · 速记框（?quick=1）：全局热键 Ctrl+Alt+N 唤起，回车记下一条。
 * 两者都不碰库：经 BroadcastChannel 让主窗执行（见 channel.ts 为什么）。
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { nanoid } from 'nanoid';
import type { Note, NoteColor } from '../types/domain';
import { desktop } from '../lib/desktop';
import { useFollowTheme } from '../lib/useFollowTheme';
import { noteTitle } from '../lib/derive/notes';
import { noteChannel, type ToMain, type ToSticky } from './channel';
import { NOTE_COLORS, NOTE_SAVE_DEBOUNCE_MS } from './constants';
import { NoteIcon } from './icons';
import './notes.css';

/** 主窗没回话时多久再问一次（主窗还在 hydrate / 刚从托盘拉起） */
const HELLO_RETRY_MS = 600;
/** 速记框等主窗回执的上限 */
const CREATE_TIMEOUT_MS = 2000;
/** 速记框「已记下」停留多久再收起 */
const QUICK_DONE_MS = 600;

export function NoteWindow() {
  useFollowTheme();
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  return id ? <StickyNote id={id} /> : <QuickCapture />;
}

/** 频道在 effect 里开、在 cleanup 里关（StrictMode 会假卸载一次，useMemo 开的频道会被关掉再也打不开） */
function useChannel(onMessage: (m: ToSticky) => void) {
  const ch = useRef<BroadcastChannel | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    const c = noteChannel();
    if (!c) return;
    c.onmessage = (e: MessageEvent<ToSticky>) => handler.current(e.data);
    ch.current = c;
    return () => {
      c.close();
      if (ch.current === c) ch.current = null;
    };
  }, []);
  return (m: ToMain) => ch.current?.postMessage(m);
}

function StickyNote({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [colors, setColors] = useState(false);
  const draftRef = useRef('');
  const baseRef = useRef<string | null>(null);
  const session = useRef(`sticky:${id}:${nanoid(6)}`);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ta = useRef<HTMLTextAreaElement>(null);

  const post = useChannel((m) => {
    if (m.t === 'gone' && m.id === id) void desktop()?.closeSelf();
    if (m.t === 'saved' && m.id === id) {
      if (m.conflict) setHint('别处也改过这条：另一版存成了冲突副本');
      else if (m.clipped) setHint('超出 20000 字的部分没有保存');
    }
    if (m.t !== 'note' || m.note.id !== id) return;
    setNote(m.note);
    // 我这边没有没存的字 ⇒ 跟上主窗；有 ⇒ 保存时主窗按 base 判冲突
    if (baseRef.current === null || draftRef.current === baseRef.current) {
      baseRef.current = m.note.body;
      draftRef.current = m.note.body;
      setDraft(m.note.body);
    }
  });

  // 问主窗要内容；主窗还没起来就隔一会儿再问
  useEffect(() => {
    if (note) return;
    post({ t: 'hello', id });
    const t = setInterval(() => post({ t: 'hello', id }), HELLO_RETRY_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, id]);

  useEffect(() => {
    document.title = note ? noteTitle(note.body) || '便签' : '便签';
  }, [note]);

  const flush = () => {
    clearTimeout(timer.current);
    if (baseRef.current === null || draftRef.current === baseRef.current) return;
    post({ t: 'save', id, body: draftRef.current, base: baseRef.current, session: session.current });
    baseRef.current = draftRef.current;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    // 失焦 = 一次编辑会话结束（撤销按会话合并）；关窗前也冲一次
    const onBlur = () => {
      flushRef.current();
      session.current = `sticky:${id}:${nanoid(6)}`;
    };
    const onHide = () => flushRef.current();
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onHide);
    };
  }, [id]);

  const change = (v: string) => {
    draftRef.current = v;
    setDraft(v);
    setHint(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), NOTE_SAVE_DEBOUNCE_MS);
  };

  return (
    <div className="nt-win nt-sticky" data-color={note?.color ?? 'default'}>
      <div className="nt-win-bar">
        <button type="button" className="nt-win-btn" title="颜色" onClick={() => setColors((v) => !v)}>
          <NoteIcon name="palette" />
        </button>
        <span className="nt-grow" />
        <button type="button" className="nt-win-btn" title="在便签面板里打开" onClick={() => (flush(), post({ t: 'open', id }))}>
          <NoteIcon name="note" />
        </button>
        <button type="button" className="nt-win-btn" title="从桌面取下（便签还在）" onClick={() => (flush(), void desktop()?.unstickNote(id))}>
          <NoteIcon name="close" />
        </button>
      </div>
      {colors && (
        <div className="nt-win-colors">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.label}
              type="button"
              className="nt-swatch"
              data-color={c.value ?? 'default'}
              aria-checked={(note?.color ?? null) === c.value}
              title={c.label}
              onClick={() => {
                post({ t: 'color', id, color: c.value as NoteColor | null });
                setColors(false);
              }}
            />
          ))}
        </div>
      )}
      {note ? (
        <textarea
          ref={ta}
          className="nt-win-text"
          value={draft}
          spellCheck={false}
          aria-label="便签内容"
          placeholder="写点什么…"
          onChange={(e) => change(e.target.value)}
        />
      ) : (
        <div className="nt-win-wait">正在连接主窗…</div>
      )}
      {hint && <div className="nt-win-hint">{hint}</div>}
    </div>
  );
}

function QuickCapture() {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const ta = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ req: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const post = useChannel((m) => {
    if (m.t !== 'created' || m.req !== pending.current?.req) return;
    clearTimeout(pending.current.timer);
    pending.current = null;
    if (!m.id) return setState('idle');
    setText('');
    setState('done');
    setTimeout(() => {
      setState('idle');
      void desktop()?.hideQuickNote();
    }, QUICK_DONE_MS);
  });

  useEffect(() => {
    const focus = () => {
      setState((s) => (s === 'done' ? 'idle' : s));
      ta.current?.focus();
    };
    focus();
    return desktop()?.onQuickNoteShown(focus);
  }, []);

  const save = () => {
    if (!text.trim() || pending.current) return;
    const req = nanoid(8);
    setState('saving');
    // 主窗没回执（卡住 / 没起来）⇒ 字留在框里，告诉人稍后再试
    pending.current = { req, timer: setTimeout(() => ((pending.current = null), setState('error')), CREATE_TIMEOUT_MS) };
    post({ t: 'create', body: text, req });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void desktop()?.hideQuickNote();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className="nt-win nt-quick">
      <div className="nt-win-bar">
        <NoteIcon name="note" />
        <b>速记</b>
        <span className="nt-grow" />
        <span className="nt-win-state">
          {state === 'saving' ? '正在记…' : state === 'done' ? '已记下' : state === 'error' ? '主窗没响应，字还在，稍后再按回车' : ''}
        </span>
      </div>
      <textarea
        ref={ta}
        className="nt-win-text"
        value={text}
        rows={2}
        placeholder="记下要记住的东西…"
        aria-label="速记内容"
        onChange={(e) => (setText(e.target.value), state === 'error' && setState('idle'))}
        onKeyDown={onKey}
      />
      <div className="nt-win-foot">回车记下 · Shift+回车换行 · Esc 收起</div>
    </div>
  );
}
