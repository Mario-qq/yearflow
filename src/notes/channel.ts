/**
 * 桌面贴纸 / 全局速记 ⇄ 主窗 的消息口径（NOTES_SPEC §二）。
 *
 * 为什么不让小窗直接读写 Dexie：主窗内存里的 store 才是唯一写入方（整行防抖落库），
 * 小窗直接写库会被主窗下一次整行写盘盖掉，主窗内存也不知道它变了。
 * 所以小窗只是「视图」：开窗问主窗要那条便签，改动发给主窗执行（照常进撤销栈、照常同步）。
 * 同一个 app:// origin 下的窗口共享 BroadcastChannel。
 */
import type { Note, NoteColor } from '../types/domain';

export const NOTE_CHANNEL = 'yearflow-notes';

/** 小窗 → 主窗 */
export type ToMain =
  | { t: 'hello'; id: string }
  | { t: 'save'; id: string; body: string; base: string; session: string }
  | { t: 'color'; id: string; color: NoteColor | null }
  | { t: 'open'; id: string }
  | { t: 'create'; body: string; req: string };

/** 主窗 → 小窗 */
export type ToSticky =
  | { t: 'note'; note: Note }
  | { t: 'gone'; id: string }
  | { t: 'saved'; id: string; conflict: boolean; clipped: boolean }
  | { t: 'created'; req: string; id: string | null };

export function noteChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NOTE_CHANNEL);
}
