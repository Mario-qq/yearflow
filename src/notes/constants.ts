/** 便签面板常量（NOTES_SPEC §二）。尺寸在 notes.css 的 --nt-* 变量里，这里只放逻辑用的数 */
import type { NoteColor } from '../types/domain';

/** 卡片预览最多显示几行（超出淡出，点开看全文） */
export const NOTE_PREVIEW_LINES = 8;
/** 标签条最多列几个 */
export const NOTE_TAG_LIMIT = 12;
/** 编辑器自动保存防抖（与全局落库同口径） */
export const NOTE_SAVE_DEBOUNCE_MS = 500;

export const NOTE_COLORS: { value: NoteColor | null; label: string }[] = [
  { value: null, label: '默认' },
  { value: 'yellow', label: '黄' },
  { value: 'green', label: '绿' },
  { value: 'blue', label: '蓝' },
  { value: 'pink', label: '粉' },
  { value: 'purple', label: '紫' },
  { value: 'gray', label: '灰' },
];
