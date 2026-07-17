/**
 * 拖拽浮动提示（光标上方的日期气泡）：单例 fixed div，直写 DOM 不走 React
 * （拖拽帧率敏感，SPEC：拖拽中只改 transform/无重渲）。
 */
import { toDay, diffDays } from '../../lib/date';

let el: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'tnum';
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '60',
    pointerEvents: 'none',
    display: 'none',
    padding: '3px 8px',
    fontSize: 'var(--font-11)',
    color: 'var(--text-primary)',
    background: 'var(--bg-raised)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-lg)',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

export function showDragHint(clientX: number, clientY: number, text: string): void {
  const d = ensure();
  d.textContent = text;
  d.style.display = 'block';
  d.style.left = `${clientX + 14}px`;
  d.style.top = `${clientY - 34}px`;
}

export function hideDragHint(): void {
  if (el) el.style.display = 'none';
}

const fmtZh = (date: string): string => {
  const d = toDay(date);
  return `${d.month() + 1}月${d.date()}日`;
};

/** 「3月4日 – 5月17日 (74天)」 */
export function fmtRangeHint(start: string, end: string): string {
  return `${fmtZh(start)} – ${fmtZh(end)} (${diffDays(end, start) + 1}天)`;
}

/** 单日期提示（里程碑） */
export function fmtDayHint(date: string): string {
  return fmtZh(date);
}
