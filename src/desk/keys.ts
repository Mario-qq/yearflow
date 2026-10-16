/**
 * 选择/拖拽用的字符串 key ↔ DeskKey。字符串是为了能放进 Set、写进 data-key 属性。
 * 事项：i:<id>；例行的一次：r:<routineId>@<原日期>
 */
import type { DeskKey } from '../store/deskPlan';

export const itemKey = (id: string): string => `i:${id}`;
export const occKey = (routineId: string, origDate: string): string => `r:${routineId}@${origDate}`;

export function parseKey(k: string): DeskKey | null {
  if (k.startsWith('i:')) return { type: 'item', id: k.slice(2) };
  if (k.startsWith('r:')) {
    const at = k.lastIndexOf('@');
    if (at < 0) return null;
    return { type: 'routine', routineId: k.slice(2, at), origDate: k.slice(at + 1) };
  }
  return null;
}

export const parseKeys = (ks: Iterable<string>): DeskKey[] =>
  [...ks].map(parseKey).filter((k): k is DeskKey => k !== null);
