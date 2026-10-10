/** 年报文案与格式化（数字一律配 .tnum；取整只在这一层发生） */
import type { RangeKind } from '../lib/derive/annual';
import { toDay } from '../lib/date';

export const RANGE_LABEL: Record<RangeKind, string> = {
  full: '全年',
  h1: '上半年',
  h2: '下半年',
  q1: 'Q1',
  q2: 'Q2',
  q3: 'Q3',
  q4: 'Q4',
};

export const RANGE_ORDER: RangeKind[] = ['full', 'h1', 'h2', 'q1', 'q2', 'q3', 'q4'];

/** 叙事里的区间称呼：「这一年 / 这半年 / 这个季度」 */
export function rangeNoun(kind: RangeKind): string {
  if (kind === 'full') return '这一年';
  if (kind === 'h1' || kind === 'h2') return '这半年';
  return '这个季度';
}

const DOW = ['日', '一', '二', '三', '四', '五', '六'];

/** 0..6 → '周四' */
export function dowLabel(dow: number): string {
  return `周${DOW[dow]}`;
}

/** 0..6 → '四'（图上的窄标签） */
export function dowShort(dow: number): string {
  return DOW[dow];
}

/** '2026-03' → 3 */
export function monthNum(month: string): number {
  return Number(month.slice(5, 7));
}

/** '2026-05-18' → '5 月 18 日' */
export function longDay(date: string): string {
  return `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`;
}

/** '2026-05-18' → '5.18' */
export function shortDay(date: string): string {
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
}

/** '2026-05-18' → '5 月 18 日 周一' */
export function dayWithDow(date: string): string {
  return `${longDay(date)} ${dowLabel(toDay(date).day())}`;
}

/** 毫秒 → 小时数：<100 一位小数，≥100 取整 */
export function hoursOf(ms: number): number {
  const h = ms / 3_600_000;
  return h >= 100 ? Math.round(h) : Math.round(h * 10) / 10;
}

/** 毫秒 → '1.5 小时' / '40 分钟'（tooltip 与小字用） */
export function humanDuration(ms: number): string {
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
  return `${hoursOf(ms)} 小时`;
}

/** 0..1 → 整数百分比 */
export function pctOf(ratio: number): number {
  return Math.round(ratio * 100);
}

/** 打卡分 → '打卡 2 项'（partial 记半项，所以可能是 1.5） */
export function scoreLabel(score: number): string {
  return `打卡 ${Number.isInteger(score) ? score : score.toFixed(1)} 项`;
}
