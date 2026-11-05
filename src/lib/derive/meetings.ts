/**
 * 会议提醒派生（纯函数）：哪些会议此刻该提醒、提醒文案里的「还有多久」。
 *
 * 规则：
 * - 只看没删、没做完/不做、排了日子、定了时间、设了提醒的会议；
 * - 一条提醒 = (会议, 那一刻, 提前 m 分钟)，到 开始−m 就算到点，会议开始 GRACE_MIN 分钟后还没发就不再补发
 *   （电脑睡着/没开错过了，会都开完了再弹没有意义）；
 * - 同一个会议同一轮有几条都到点（比如开机时「提前 30」「提前 10」都过了），只发一条，全部记为已发；
 * - 记「已发」的键里带日期和时间：改了会议时间，提醒重新生效。
 */
import type { WorkItem } from '../../types/domain';
import { dayjs } from '../date';

/** 提醒选项（分钟）：0 = 准时，1440 = 前一天 */
export const REMIND_OPTS: number[] = [0, 5, 10, 15, 30, 60, 1440];
/** 新建会议默认提前 10 分钟提醒 */
export const DEFAULT_REMIND: number[] = [10];
/** 会议开始后多少分钟内还补发 */
export const GRACE_MIN = 5;

export function remindLabel(m: number): string {
  if (m === 0) return '准时';
  if (m === 1440) return '前一天';
  if (m % 60 === 0) return `提前 ${m / 60} 小时`;
  return `提前 ${m} 分钟`;
}

/** 会议开始的那一刻（本地时间，毫秒）；没日子/没时间 ⇒ null */
export function meetingStart(item: Pick<WorkItem, 'date' | 'time'>): number | null {
  if (!item.date || !item.time || !/^\d{2}:\d{2}$/.test(item.time)) return null;
  const t = dayjs(`${item.date} ${item.time}`, 'YYYY-MM-DD HH:mm');
  return t.isValid() ? t.valueOf() : null;
}

export const reminderKey = (item: Pick<WorkItem, 'id' | 'date' | 'time'>, m: number): string => `${item.id}@${item.date}T${item.time}-${m}`;

export interface MeetingDue {
  item: WorkItem;
  start: number;
  /** 这次要标记为已发的键（同一会议里所有已到点的） */
  keys: string[];
}

export function meetingRemindersDue(items: Iterable<WorkItem>, now: number, sent: ReadonlySet<string>): MeetingDue[] {
  const out: MeetingDue[] = [];
  for (const item of items) {
    if (item.kind !== 'meeting' || item.deletedAt || item.status !== 'open' || !item.remind?.length) continue;
    const start = meetingStart(item);
    if (start === null || now >= start + GRACE_MIN * 60_000) continue;
    const keys: string[] = [];
    for (const m of item.remind) {
      const key = reminderKey(item, m);
      if (now >= start - m * 60_000 && !sent.has(key)) keys.push(key);
    }
    if (keys.length) out.push({ item, start, keys });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 「还有 12 分钟」「还有 1 小时 5 分钟」「明天 9:30」「现在开始」「已开始 2 分钟」 */
export function untilText(start: number, now: number): string {
  const min = Math.round((start - now) / 60_000);
  if (min < 0) return `已开始 ${-min} 分钟`;
  if (min === 0) return '现在开始';
  if (min < 60) return `还有 ${min} 分钟`;
  if (min < 6 * 60) return `还有 ${Math.floor(min / 60)} 小时${min % 60 ? ` ${min % 60} 分钟` : ''}`;
  const s = dayjs(start);
  const days = s.startOf('day').diff(dayjs(now).startOf('day'), 'day');
  return `${days === 0 ? '今天' : days === 1 ? '明天' : s.format('M/D')} ${s.format('H:mm')}`;
}

/** 已发记录只留还用得着的：键里的日期在 keepFrom（含）之后 */
export function pruneSent(sent: Iterable<string>, keepFrom: string): string[] {
  return [...sent].filter((k) => {
    const d = /@(\d{4}-\d{2}-\d{2})T/.exec(k)?.[1];
    return d !== undefined && d >= keepFrom;
  });
}
