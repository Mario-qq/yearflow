/**
 * 便签面板的界面状态（不入库）。面板本体 lazy，入口按钮 / Alt+N / 命令面板都只改这里。
 *
 * 编辑会话：editing + session（撤销合并键）。换编辑对象 / 收起 / 关面板一律走 editNote()，
 * 由它先冲掉编辑器里没保存的字、再把全空的便签丢掉 —— 不放在编辑器卸载时做：
 * 开发模式 StrictMode 会假卸载一次，刚新建的空便签会被当场删掉。
 */
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import type { NoteView } from '../lib/derive/notes';
import { createNote, discardIfEmpty } from '../store/noteActions';

interface NotesUi {
  open: boolean;
  view: NoteView;
  query: string;
  /** 正在编辑的便签 id */
  editing: string | null;
  /** 这次编辑会话的撤销合并键 */
  session: string | null;
  /** 每次「打开并聚焦输入框」+1：面板据此把焦点放回搜索框（已打开时再按 Alt+N 也要聚焦） */
  focusSeq: number;
  set: (patch: Partial<Omit<NotesUi, 'set'>>) => void;
}

export const useNotesUi = create<NotesUi>()((set) => ({
  open: false,
  view: 'active',
  query: '',
  editing: null,
  session: null,
  focusSeq: 0,
  set: (patch) => set(patch),
}));

/** 编辑器把「立刻保存」挂在这里（同一时刻只有一个编辑器） */
let flusher: (() => void) | null = null;

export function registerFlusher(f: () => void): () => void {
  flusher = f;
  return () => {
    if (flusher === f) flusher = null;
  };
}

/** 立刻保存编辑器里还没存的字（关窗 / 切走前调） */
export function flushEditor(): void {
  flusher?.();
}

/** 换编辑对象（null = 收起）。session 缺省 = 新开一个会话 */
export function editNote(id: string | null, session?: string): void {
  const s = useNotesUi.getState();
  if (s.editing && s.editing !== id) {
    flusher?.();
    if (s.session) discardIfEmpty(s.editing, s.session);
  }
  if (id === s.editing && id !== null) return;
  s.set({ editing: id, session: id ? (session ?? `note:${id}:${nanoid(6)}`) : null });
}

/** 新建一条空便签并直接进编辑（新建与随后的输入合成一条撤销） */
export function newBlankNote(body = ''): void {
  const session = `note:new:${nanoid(6)}`;
  const id = createNote(body, { mergeKey: session });
  if (!id) return;
  useNotesUi.getState().set({ view: 'active' });
  editNote(id, session);
}

/** 打开面板并聚焦输入框；editId 给了 ⇒ 直接展开那条 */
export function openNotes(opts: { editId?: string; query?: string } = {}): void {
  const s = useNotesUi.getState();
  s.set({
    open: true,
    focusSeq: s.focusSeq + 1,
    ...(opts.editId ? { view: 'active' as const } : {}),
    ...(opts.query !== undefined ? { query: opts.query, view: 'active' as const } : {}),
  });
  if (opts.editId) editNote(opts.editId);
}

export function closeNotes(): void {
  editNote(null);
  useNotesUi.getState().set({ open: false });
}

export function toggleNotes(): void {
  if (useNotesUi.getState().open) closeNotes();
  else openNotes();
}
