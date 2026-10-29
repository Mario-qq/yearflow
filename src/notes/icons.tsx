/**
 * 便签卡片操作的线性小图标（currentColor），不引图标库。
 * 默认 1em 跟字号走：顶栏按钮在面板样式表（lazy）载入前就要有尺寸；面板里由 .nt-ic 定成 --nt-ic
 */
const PATHS = {
  pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 11h.01M10 7.5h.01M14 7.5h.01',
  todo: 'M4 6h10M4 12h7M4 18h6M15 15l3 3 4-6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  restore: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  close: 'M6 6l12 12M18 6L6 18',
  note: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  desk: 'M3 5h18v12H3zM8 21h8M12 17v4M14 8h4v4h-4z',
} as const;

export type NoteIconName = keyof typeof PATHS;

export function NoteIcon({ name }: { name: NoteIconName }) {
  return (
    <svg className="nt-ic" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
