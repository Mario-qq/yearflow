import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../../types/domain';
import { dayjs } from '../date';
import { meetingRemindersDue, meetingStart, pruneSent, remindLabel, reminderKey, untilText } from './meetings';

const mt = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 'm1',
  kind: 'meeting',
  title: '周会',
  urgency: 'normal',
  scope: 'work',
  status: 'open',
  order: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  date: '2026-11-05',
  time: '15:00',
  remind: [10],
  ...over,
});
const at = (s: string) => dayjs(s, 'YYYY-MM-DD HH:mm').valueOf();
const none = new Set<string>();

describe('会议提醒', () => {
  it('开始时间按本地时区', () => {
    expect(meetingStart(mt())).toBe(at('2026-11-05 15:00'));
    expect(meetingStart(mt({ time: undefined }))).toBeNull();
    expect(meetingStart(mt({ date: undefined }))).toBeNull();
  });

  it('到 开始−m 才提醒；会开始 5 分钟后不再补发', () => {
    expect(meetingRemindersDue([mt()], at('2026-11-05 14:49'), none)).toHaveLength(0);
    const due = meetingRemindersDue([mt()], at('2026-11-05 14:50'), none);
    expect(due).toHaveLength(1);
    expect(due[0].keys).toEqual([reminderKey(mt(), 10)]);
    expect(meetingRemindersDue([mt()], at('2026-11-05 15:04'), none)).toHaveLength(1);
    expect(meetingRemindersDue([mt()], at('2026-11-05 15:05'), none)).toHaveLength(0);
  });

  it('发过的不重发；改了时间重新生效', () => {
    const sent = new Set([reminderKey(mt(), 10)]);
    expect(meetingRemindersDue([mt()], at('2026-11-05 14:55'), sent)).toHaveLength(0);
    expect(meetingRemindersDue([mt({ time: '15:02' })], at('2026-11-05 14:55'), sent)).toHaveLength(1);
  });

  it('同一会议几条同时到点只发一次，全记为已发；前一天的提醒', () => {
    const item = mt({ remind: [1440, 30, 10] });
    expect(meetingRemindersDue([item], at('2026-11-04 15:00'), none)[0].keys).toEqual([reminderKey(item, 1440)]);
    const due = meetingRemindersDue([item], at('2026-11-05 14:52'), none);
    expect(due).toHaveLength(1);
    expect(due[0].keys).toHaveLength(3);
  });

  it('不是会议 / 做完了 / 不做了 / 删了 / 没设提醒 ⇒ 不提醒', () => {
    const now = at('2026-11-05 14:55');
    for (const o of [{ kind: 'todo' as const }, { status: 'done' as const }, { status: 'dropped' as const }, { deletedAt: 'x' }, { remind: [] }, { remind: undefined }]) {
      expect(meetingRemindersDue([mt(o)], now, none)).toHaveLength(0);
    }
  });

  it('文案', () => {
    expect(remindLabel(0)).toBe('准时');
    expect(remindLabel(15)).toBe('提前 15 分钟');
    expect(remindLabel(60)).toBe('提前 1 小时');
    expect(remindLabel(1440)).toBe('前一天');
    const s = at('2026-11-05 15:00');
    expect(untilText(s, at('2026-11-05 14:48'))).toBe('还有 12 分钟');
    expect(untilText(s, at('2026-11-05 15:00'))).toBe('现在开始');
    expect(untilText(s, at('2026-11-05 15:02'))).toBe('已开始 2 分钟');
    expect(untilText(s, at('2026-11-05 13:55'))).toBe('还有 1 小时 5 分钟');
    expect(untilText(s, at('2026-11-04 15:00'))).toBe('明天 15:00');
  });

  it('已发记录按日期修剪', () => {
    expect(pruneSent(['a@2026-11-03T09:00-10', 'b@2026-11-05T09:00-0', 'junk'], '2026-11-04')).toEqual(['b@2026-11-05T09:00-0']);
  });
});
