import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);

export { dayjs };
export type { Dayjs };

export const DATE_FMT = 'YYYY-MM-DD';

export const toDay = (s: string): Dayjs => dayjs(s, DATE_FMT);
export const fmtDay = (d: Dayjs): string => d.format(DATE_FMT);

/** 全部按本地时区处理，一天的边界是本地 00:00 */
export const todayStr = (): string => dayjs().format(DATE_FMT);

/** 遍历 [start, end] 闭区间的每一天（YYYY-MM-DD） */
export function* eachDay(start: string, end: string): Generator<string> {
  let d = toDay(start);
  const e = toDay(end);
  while (!d.isAfter(e, 'day')) {
    yield fmtDay(d);
    d = d.add(1, 'day');
  }
}

/** 某天所在周的周首日期（weekStartsOn: 1=周一(ISO)，0=周日） */
export function weekStartOf(date: string, weekStartsOn: 0 | 1): string {
  const d = toDay(date);
  if (weekStartsOn === 1) return fmtDay(d.startOf('isoWeek'));
  return fmtDay(d.subtract(d.day(), 'day'));
}

/** a - b 的天数差（a 晚于 b 为正） */
export function diffDays(a: string, b: string): number {
  return toDay(a).diff(toDay(b), 'day');
}
