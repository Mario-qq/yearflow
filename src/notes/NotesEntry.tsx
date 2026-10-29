/**
 * 便签的全局入口：顶栏按钮 + Alt+N 热键 + 懒加载的面板本体（NOTES_SPEC §二）。
 */
import { lazy, Suspense, useEffect } from 'react';
import { NoteIcon } from './icons';
import { toggleNotes, useNotesUi } from './uiStore';

// 面板低频且带样式表：lazy 分包，第一次打开才拉
const NotesPanel = lazy(() => import('./NotesPanel'));

export function NotesButton() {
  const open = useNotesUi((s) => s.open);
  return (
    <button
      type="button"
      onClick={toggleNotes}
      aria-pressed={open}
      className="flex cursor-pointer items-center gap-1 whitespace-nowrap px-2 py-1"
      style={{
        fontSize: 'var(--font-12)',
        color: open ? 'var(--accent)' : 'var(--text-secondary)',
        border: `1px solid ${open ? 'var(--accent)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-sm)',
        background: open ? 'var(--accent-soft)' : 'var(--bg-panel)',
      }}
      title="便签（Alt+N）"
    >
      <NoteIcon name="note" />
      <span className="max-md:hidden">便签</span>
    </button>
  );
}

export function NotesHost() {
  const open = useNotesUi((s) => s.open);

  // Alt+N：输入框里也认（Windows 上 Alt+N 不产生字符）。用 code 而不是 key：macOS 上 Option+N 的 key 是 ˜
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyN' || e.repeat) return;
      e.preventDefault();
      toggleNotes();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <NotesPanel />
    </Suspense>
  );
}
