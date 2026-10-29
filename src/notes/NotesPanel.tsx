/**
 * 便签面板（NOTES_SPEC §二）：右侧玻璃浮层，全站可用。lazy 分包，入口在顶栏 / Alt+N / 命令面板。
 * 点外面不关（记东西常要对照页面内容）；Esc / × / 再按 Alt+N 关。
 */
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { noteSections, tagCounts, type NoteView } from '../lib/derive/notes';
import { createNote, emptyTrash, purgeExpiredTrash } from '../store/noteActions';
import { useStore } from '../store/useStore';
import { showToast } from '../lib/toast';
import { NOTE_TAG_LIMIT } from './constants';
import { NoteCard } from './NoteCard';
import { NoteIcon } from './icons';
import { closeNotes, editNote, newBlankNote, useNotesUi } from './uiStore';
import './notes.css';

const VIEW_LABEL: Record<NoteView, string> = { active: '便签', archive: '归档', trash: '回收站' };

export default function NotesPanel() {
  const notesMap = useStore((s) => s.notes);
  const view = useNotesUi((s) => s.view);
  const query = useNotesUi((s) => s.query);
  const editing = useNotesUi((s) => s.editing);
  const focusSeq = useNotesUi((s) => s.focusSeq);
  const set = useNotesUi((s) => s.set);
  const input = useRef<HTMLInputElement>(null);

  const all = useMemo(() => Object.values(notesMap), [notesMap]);
  const sections = useMemo(() => noteSections(all, view, query), [all, view, query]);
  const tags = useMemo(() => tagCounts(all).slice(0, NOTE_TAG_LIMIT), [all]);

  // 打开时清一次回收站里满 30 天的
  useEffect(() => {
    const n = purgeExpiredTrash();
    if (n > 0) showToast(`回收站里 ${n} 条满 30 天的便签已永久删除`);
  }, []);

  useEffect(() => {
    if (!editing) input.current?.focus();
  }, [focusSeq, editing]);

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (query) set({ query: '' });
      else closeNotes();
      return;
    }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const text = query.trim();
    if (e.ctrlKey || e.metaKey) {
      set({ query: '' });
      newBlankNote(text);
      return;
    }
    if (!text) return;
    createNote(text);
    set({ query: '', view: 'active' });
  };

  const onPanelKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation(); // 别让页面上的浮层（工作台菜单等）也跟着收
    if (editing) editNote(null);
    else closeNotes();
  };

  const toggleTag = (tag: string) => {
    const term = `#${tag}`;
    const terms = query.split(/\s+/).filter(Boolean);
    const has = terms.some((t) => t.toLowerCase() === term.toLowerCase());
    set({ query: has ? terms.filter((t) => t.toLowerCase() !== term.toLowerCase()).join(' ') : [...terms, term].join(' ') });
  };

  const empty = sections.pinned.length === 0 && sections.recent.length === 0;
  const total = sections.counts[view];

  return (
    <aside className="nt glass-float" role="dialog" aria-label="便签" onKeyDown={onPanelKey}>
      <header className="nt-head">
        <b>{VIEW_LABEL[view]}</b>
        <span className="nt-count tabular-nums">{total}</span>
        {view !== 'active' && (
          <button type="button" className="nt-back" onClick={() => set({ view: 'active' })}>
            ← 回到便签
          </button>
        )}
        <span className="nt-grow" />
        {view === 'active' && (
          <button type="button" className="nt-new" title="新建空白便签（Ctrl+Enter）" onClick={() => newBlankNote()}>
            ＋ 新建
          </button>
        )}
        <button type="button" className="nt-x" title="关闭（Esc / Alt+N）" aria-label="关闭便签" onClick={closeNotes}>
          <NoteIcon name="close" />
        </button>
      </header>

      <div className="nt-search">
        <input
          ref={input}
          className="nt-input"
          value={query}
          placeholder={view === 'active' ? '搜索，或写一句回车记下…' : `在${VIEW_LABEL[view]}里搜索…`}
          aria-label="搜索或新建便签"
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={onInputKey}
        />
        {view === 'active' && query.trim() && <span className="nt-hint">回车记下 · Ctrl+回车展开写</span>}
      </div>

      {view === 'active' && tags.length > 0 && (
        <div className="nt-tags">
          {tags.map((t) => {
            const on = query.toLowerCase().split(/\s+/).includes(`#${t.tag.toLowerCase()}`);
            return (
              <button key={t.tag} type="button" className={`nt-chip${on ? ' is-on' : ''}`} onClick={() => toggleTag(t.tag)}>
                #{t.tag}
                <span className="tabular-nums">{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="nt-list">
        {sections.pinned.length > 0 && (
          <>
            <div className="nt-sec">置顶</div>
            {sections.pinned.map((n) => (
              <NoteCard key={n.id} note={n} view={view} editing={editing === n.id} onTag={toggleTag} />
            ))}
            {sections.recent.length > 0 && <div className="nt-sec">其他</div>}
          </>
        )}
        {sections.recent.map((n) => (
          <NoteCard key={n.id} note={n} view={view} editing={editing === n.id} onTag={toggleTag} />
        ))}
        {empty && <EmptyState view={view} searching={!!query.trim()} />}
      </div>

      <footer className="nt-bottom">
        {view === 'trash' ? (
          <>
            <span>删除满 30 天自动清掉</span>
            <span className="nt-grow" />
            {sections.counts.trash > 0 && (
              <button
                type="button"
                className="nt-link is-danger"
                onClick={() => {
                  const n = emptyTrash();
                  if (n > 0)
                    showToast(`已清空回收站（${n} 条）`, {
                      label: '撤销',
                      run: () => useStore.getState().undo(),
                    });
                }}
              >
                清空回收站
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className={`nt-link${view === 'archive' ? ' is-on' : ''}`} onClick={() => set({ view: view === 'archive' ? 'active' : 'archive' })}>
              归档 <span className="tabular-nums">{sections.counts.archive}</span>
            </button>
            <button type="button" className="nt-link" onClick={() => set({ view: 'trash' })}>
              回收站 <span className="tabular-nums">{sections.counts.trash}</span>
            </button>
            <span className="nt-grow" />
            <span className="nt-kbd">Alt+N</span>
          </>
        )}
      </footer>
    </aside>
  );
}

function EmptyState({ view, searching }: { view: NoteView; searching: boolean }) {
  if (searching) return <div className="nt-empty">没有匹配的便签</div>;
  if (view === 'archive') return <div className="nt-empty">归档的便签放在这里，不占主列表</div>;
  if (view === 'trash') return <div className="nt-empty">回收站是空的</div>;
  return (
    <div className="nt-empty">
      <b>记下要记住的东西</b>
      <span>号码、会议要点、学习思路、灵感。要去做的事，点卡片上的「转待办」送进工作台。</span>
      <span>
        在上面写一句回车就记下；<code>- [ ]</code> 写清单，<code>#标签</code> 随手分类。
      </span>
    </div>
  );
}
