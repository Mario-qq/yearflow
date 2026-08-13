/** 年报文案与格式化（数字一律配 .tnum；取整只在这一层发生） */
import type { RangeKind } from '../lib/derive/annual';

export const RANGE_LABEL: Record<RangeKind, string> = {
  full: '全年',
  h1: '上半年',
  h2: '下半年',
  q1: 'Q1',
  q2: 'Q2',
  q3: 'Q3',
  q4: 'Q4',
};

/** 顶部条的区间顺序：先粗后细，与规格 §4.1 的写法一致 */
export const RANGE_ORDER: RangeKind[] = ['full', 'h1', 'h2', 'q1', 'q2', 'q3', 'q4'];

/** '2026-03' → '3 月' */
export function monthLabel(month: string): string {
  return `${Number(month.slice(5, 7))} 月`;
}

/** '2026-05-18' → '5-18' —— 长图里高频出现，用紧凑写法 */
export function shortDay(date: string): string {
  return `${Number(date.slice(5, 7))}-${Number(date.slice(8, 10))}`;
}

/** '2026-05-18' → '5 月 18 日' */
export function longDay(date: string): string {
  return `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`;
}

/** 0..1 → 整数百分比（不带 %，单位交给渲染） */
export function pctOf(ratio: number): number {
  return Math.round(ratio * 100);
}

/** 毫秒 → 一位小数的小时数（hero 巨字用；bar 上的明细仍用 humanMs 的中文写法） */
export function hoursOf(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/**
 * SVG <text> 没有 text-overflow，长目标名必须在字符层截断。
 * 按字符数而非像素：中英混排下像素测量要上 canvas，收益不值这个复杂度。
 */
export function clipText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
