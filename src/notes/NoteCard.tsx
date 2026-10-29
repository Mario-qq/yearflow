/**
 * 便签卡片：预览态（清单可点、标签可点、网址可开）+ 编辑态（自适应高度输入框，防抖自动保存）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Note, NoteColor } from '../types/domain';
import { checklistProgress, parseChecklist, segmentLine, type NoteView } from '../lib/derive/notes';
import {
  convertNoteToTodo,
  purgeNotes,
  restoreNote,
  saveNoteBody,
  setNoteArchived,
  setNoteColor,
  setNoteLocalOnly,
  toggleNoteCheck,
  toggleNotePin,
  trashNote,
} from '../store/noteActions';
import { useStore } from '../store/useStore';
import { flushNow } from '../store/persist';
import { showToast } from '../lib/toast';
import { desktop } from '../lib/desktop';
import { useStuckNotes } from './bridge';
import { NOTE_COLORS, NOTE_PREVIEW_LINES, NOTE_SAVE_DEBOUNCE_MS } from './constants';
import { relTime } from './format';
import { NoteIcon } from './icons';
import { editNote, registerFlusher, useNotesUi } from './uiStore';

const undoToast = (text: string) =>
  showToast(text, {
    label: '撤销',
    run: () => {
      const label = useStore.getState().undo();
      if (label) showToast(`已撤销：${label}`);
    },
  });

const CHECK_LINE = /^(\s*)[-*] \[( |x|X)\] ?(.*)$/;

interface Props {
  note: Note;
  view: NoteView;
  editing: boolean;
  onTag: (tag: string) => void;
}

export function NoteCard({ note, view, editing, onTag }: Props) {
  const [menu, setMenu] = useState<'color' | 'todo' | null>(null);
  const progress = checklistProgress(note.body);
  const conflictOrigin = useStore((s) => (note.conflictOf ? s.notes[note.conflictOf] : undefined));
  const stuck = useStuckNotes((s) => s.ids.includes(note.id));
  const d = desktop();

  const open = (e: MouseEvent) => {
    if (view === 'trash' || editing) return;
    if ((e.target as HTMLElement).closest('button, a, input, .nt-menu')) return;
    editNote(note.id);
  };

  return (
    <article
      className={`nt-card${editing ? ' is-editing' : ''}`}
      data-color={note.color ?? 'default'}
      data-note-id={note.id}
      onClick={open}
      onMouseLeave={() => setMenu(null)}
    >
      {(note.conflictOf || note.localOnly || note.convertedTo?.length || stuck) && (
        <div className="nt-flags">
          {stuck && <span className="nt-flag">贴在桌面</span>}
          {note.conflictOf && (
            <span className="nt-flag is-warn" title="同步时两边都改过：这是另一边的版本，合并完删掉即可">
              冲突副本{conflictOrigin ? '' : '（原便签已不在）'}
            </span>
          )}
          {note.localOnly && <span className="nt-flag">仅本机</span>}
          {note.convertedTo?.length ? <span className="nt-flag">已转待办 {note.convertedTo.length}</span> : null}
        </div>
      )}
      {editing ? <NoteEditor note={note} /> : <NotePreview note={note} onTag={onTag} canCheck={view !== 'trash'} />}
      <footer className="nt-foot">
        <span className="nt-time tabular-nums">
          {progress && (
            <span className="nt-progress">
              {progress.done}/{progress.total}
            </span>
          )}
          {relTime(view === 'trash' ? note.trashedAt! : note.editedAt)}
          {view === 'trash' && ' 删除'}
        </span>
        <span className="nt-acts">
          {view === 'trash' ? (
            <>
              <button type="button" className="nt-act" title="恢复" onClick={() => restoreNote(note.id)}>
                <NoteIcon name="restore" />
              </button>
              <button type="button" className="nt-act is-danger" title="永久删除" onClick={() => purgeNotes([note.id]) && undoToast('已永久删除')}>
                <NoteIcon name="trash" />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="nt-act" title="颜色" aria-expanded={menu === 'color'} onClick={() => setMenu(menu === 'color' ? null : 'color')}>
                <NoteIcon name="palette" />
              </button>
              {view === 'active' && (
                <button type="button" className={`nt-act${note.pinnedAt ? ' is-on' : ''}`} title={note.pinnedAt ? '取消置顶' : '置顶'} onClick={() => toggleNotePin(note.id)}>
                  <NoteIcon name="pin" />
                </button>
              )}
              <button type="button" className="nt-act" title="转成待办（进工作台「待处理」）" onClick={() => onConvertClick(note, setMenu)}>
                <NoteIcon name="todo" />
              </button>
              {d && view === 'active' && (
                <button
                  type="button"
                  className={`nt-act${stuck ? ' is-on' : ''}`}
                  title={stuck ? '从桌面取下' : '贴到桌面（置顶小窗，可直接改）'}
                  onClick={() => {
                    if (editing) editNote(null);
                    void (stuck ? d.unstickNote(note.id) : d.stickNote(note.id));
                  }}
                >
                  <NoteIcon name="desk" />
                </button>
              )}
              <button
                type="button"
                className={`nt-act${note.localOnly ? ' is-on' : ''}`}
                title={note.localOnly ? '仅本机：不上云（点一下恢复云同步）' : '设为仅本机：不上云，其他设备上会消失'}
                onClick={() => setNoteLocalOnly(note.id, !note.localOnly)}
              >
                <NoteIcon name="lock" />
              </button>
              <button
                type="button"
                className="nt-act"
                title={view === 'archive' ? '取消归档' : '归档'}
                onClick={() => {
                  if (editing) editNote(null);
                  setNoteArchived(note.id, view !== 'archive');
                  undoToast(view === 'archive' ? '已放回便签' : '已归档');
                }}
              >
                <NoteIcon name="archive" />
              </button>
              <button
                type="button"
                className="nt-act is-danger"
                title="删除（进回收站）"
                onClick={() => {
                  if (editing) editNote(null);
                  trashNote(note.id);
                  undoToast('已移到回收站');
                }}
              >
                <NoteIcon name="trash" />
              </button>
            </>
          )}
        </span>
        {menu === 'color' && (
          <div className="nt-menu nt-colors glass-float float-in" role="menu">
            {NOTE_COLORS.map((c) => (
              <button
                key={c.label}
                type="button"
                role="menuitemradio"
                aria-checked={(note.color ?? null) === c.value}
                className="nt-swatch"
                data-color={c.value ?? 'default'}
                title={c.label}
                onClick={() => {
                  setNoteColor(note.id, c.value as NoteColor | null);
                  setMenu(null);
                }}
              />
            ))}
          </div>
        )}
        {menu === 'todo' && <TodoMenu note={note} onDone={() => setMenu(null)} />}
      </footer>
    </article>
  );
}

/** 有没勾的清单 ⇒ 让人选「整条」还是某一行；没有就直接整条转 */
function onConvertClick(note: Note, setMenu: (m: 'todo' | null) => void) {
  if (parseChecklist(note.body).some((c) => !c.done && c.text.trim())) setMenu('todo');
  else convert(note.id);
}

function convert(id: string, line?: number) {
  if (convertNoteToTodo(id, line)) undoToast('已转成待办，在工作台「待处理」里');
  else showToast('这条便签是空的，没法转成待办');
}

function TodoMenu({ note, onDone }: { note: Note; onDone: () => void }) {
  const open = parseChecklist(note.body).filter((c) => !c.done && c.text.trim());
  return (
    <div className="nt-menu nt-todo-menu glass-float float-in" role="menu">
      <button type="button" role="menuitem" onClick={() => (convert(note.id), onDone())}>
        整条转成一件待办
      </button>
      <div className="nt-menu-h">或只转某一项</div>
      {open.map((c) => (
        <button key={c.line} type="button" role="menuitem" onClick={() => (convert(note.id, c.line), onDone())}>
          {c.text}
        </button>
      ))}
    </div>
  );
}

function NotePreview({ note, onTag, canCheck }: { note: Note; onTag: (tag: string) => void; canCheck: boolean }) {
  const lines = useMemo(() => {
    const all = note.body.replace(/^\s*\n/, '').split('\n');
    // 去掉开头空行后，line 下标要对回原文（勾选按原文行号改）
    const offset = note.body.split('\n').length - all.length;
    return { list: all.slice(0, NOTE_PREVIEW_LINES).map((text, i) => ({ text, line: i + offset })), more: all.length > NOTE_PREVIEW_LINES };
  }, [note.body]);
  if (!note.body.trim()) return <div className="nt-body is-empty">空便签</div>;
  return (
    <div className={`nt-body${lines.more ? ' is-clipped' : ''}`}>
      {lines.list.map(({ text, line }, i) => {
        const m = CHECK_LINE.exec(text);
        if (m) {
          const done = m[2] !== ' ';
          return (
            <div key={line} className={`nt-line nt-check${done ? ' is-done' : ''}`} style={{ paddingLeft: `${m[1].length * 0.5}em` }}>
              <button
                type="button"
                className="nt-box"
                role="checkbox"
                aria-checked={done}
                disabled={!canCheck}
                onClick={() => toggleNoteCheck(note.id, line)}
              />
              <span>
                <Segments text={m[3]} onTag={onTag} />
              </span>
            </div>
          );
        }
        return (
          <div key={line} className={`nt-line${i === 0 ? ' nt-title' : ''}`}>
            {text.trim() ? <Segments text={text} onTag={onTag} /> : ' '}
          </div>
        );
      })}
    </div>
  );
}

function Segments({ text, onTag }: { text: string; onTag: (tag: string) => void }) {
  return (
    <>
      {segmentLine(text).map((s, i) =>
        s.kind === 'url' ? (
          <a key={i} href={s.text} target="_blank" rel="noreferrer noopener" className="nt-url">
            {s.text}
          </a>
        ) : s.kind === 'tag' ? (
          <button key={i} type="button" className="nt-tag" onClick={() => onTag(s.tag)}>
            {s.text}
          </button>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** 编辑态。保存口径见 noteActions.saveNoteBody（base 判冲突）；会话收尾在 uiStore.editNote */
function NoteEditor({ note }: { note: Note }) {
  const session = useNotesUi((s) => s.session) ?? '';
  const [draft, setDraft] = useState(note.body);
  const draftRef = useRef(note.body);
  const baseRef = useRef(note.body);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ta = useRef<HTMLTextAreaElement>(null);
  /** 程序改了正文后光标该在哪：在提交 DOM 的同一帧设（下一帧再设，打字快时后一个字已经落在旧位置） */
  const pendingCaret = useRef<number | null>(null);
  const id = note.id;

  const flush = useRef(() => {});
  flush.current = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (draftRef.current === baseRef.current) return;
    const r = saveNoteBody(id, draftRef.current, baseRef.current, session);
    const saved = useStore.getState().notes[id]?.body ?? draftRef.current;
    baseRef.current = saved;
    if (saved !== draftRef.current) {
      draftRef.current = saved;
      setDraft(saved);
    }
    if (r.clipped) showToast('便签太长了，超出 20000 字的部分没有保存');
    if (r.conflict) showToast('这条便签刚在别处也改过：你这版已保存，另一版存成了「冲突副本」');
  };

  useEffect(() => registerFlusher(() => flush.current()), []);
  useEffect(() => () => flush.current(), []);

  // 关窗 / 切到后台：立刻存，并把落库防抖也冲掉
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      flush.current();
      void flushNow();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // 库里那条在别处变了（同步 / 撤销）且我这边没有没存的字 ⇒ 跟上；有没存的字 ⇒ 保存时出冲突副本
  useEffect(() => {
    if (note.body === baseRef.current) return;
    if (draftRef.current !== baseRef.current) return;
    baseRef.current = note.body;
    draftRef.current = note.body;
    setDraft(note.body);
  }, [note.body]);

  // 自适应高度 + 落下待设的光标
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [draft]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.closest('.nt-card')?.scrollIntoView({ block: 'nearest' });
  }, []);

  const change = (v: string) => {
    draftRef.current = v;
    setDraft(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush.current(), NOTE_SAVE_DEBOUNCE_MS);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      e.stopPropagation();
      editNote(null);
      return;
    }
    // 清单里回车自动续一行 `- [ ] `；空的那一行回车 = 结束清单
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end, value } = el;
      if (s !== end) return;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const lineEnd = value.indexOf('\n', s);
      const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
      const m = CHECK_LINE.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[3].trim()) {
        pendingCaret.current = lineStart;
        change(value.slice(0, lineStart) + value.slice(lineStart + line.length));
        return;
      }
      const insert = `\n${m[1]}- [ ] `;
      pendingCaret.current = s + insert.length;
      change(value.slice(0, s) + insert + value.slice(s));
    }
  };

  return (
    <textarea
      ref={ta}
      className="nt-editor"
      value={draft}
      rows={3}
      placeholder={'第一行是标题\n- [ ] 清单这样写，#标签 随手打'}
      aria-label="便签内容"
      onChange={(e) => change(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
