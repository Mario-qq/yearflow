/**
 * 主窗这一侧的便签桥（只在桌面版启动）：替贴纸窗 / 速记框读写 store，并把贴着的便签的变化推过去。
 * 口径见 channel.ts。
 */
import { create } from 'zustand';
import type { Note } from '../types/domain';
import { desktop } from '../lib/desktop';
import { showToast } from '../lib/toast';
import { createNote, saveNoteBody, setNoteColor } from '../store/noteActions';
import { useStore } from '../store/useStore';
import { noteChannel, type ToMain, type ToSticky } from './channel';
import { openNotes } from './uiStore';

/** 当前贴在桌面上的便签 id（主进程是权威，这里是镜像） */
export const useStuckNotes = create<{ ids: string[] }>()(() => ({ ids: [] }));

/** 贴纸该关了：进回收站 / 归档 / 删了 */
const goneFor = (n: Note | undefined) => !n || !!n.deletedAt || !!n.trashedAt || !!n.archivedAt;

let started = false;

export function initNoteBridge(): void {
  const d = desktop();
  const ch = noteChannel();
  if (!d || !ch || started) return;
  started = true;
  const post = (m: ToSticky) => ch.postMessage(m);

  void d.stuckNotes().then((ids) => useStuckNotes.setState({ ids }));
  d.onStuckNotes((ids) => useStuckNotes.setState({ ids }));

  ch.onmessage = (e: MessageEvent<ToMain>) => {
    const m = e.data;
    const notes = useStore.getState().notes;
    switch (m.t) {
      case 'hello': {
        const n = notes[m.id];
        post(goneFor(n) ? { t: 'gone', id: m.id } : { t: 'note', note: n! });
        break;
      }
      case 'save': {
        const r = saveNoteBody(m.id, m.body, m.base, m.session);
        post({ t: 'saved', id: m.id, conflict: r.conflict, clipped: r.clipped });
        break;
      }
      case 'color':
        setNoteColor(m.id, m.color);
        break;
      case 'open':
        void d.focusMain();
        openNotes({ editId: m.id });
        break;
      case 'create': {
        const id = createNote(m.body);
        post({ t: 'created', req: m.req, id });
        if (id) showToast('已从速记框记下一条便签');
        break;
      }
    }
  };

  // 贴着的便签在主窗这边变了（编辑、同步、撤销、删除）⇒ 推给它的贴纸
  useStore.subscribe((s, prev) => {
    if (s.notes === prev.notes) return;
    for (const id of useStuckNotes.getState().ids) {
      const n = s.notes[id];
      if (n === prev.notes[id]) continue;
      if (goneFor(n)) {
        post({ t: 'gone', id });
        void d.unstickNote(id);
      } else post({ t: 'note', note: n! });
    }
  });
}
