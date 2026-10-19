import { describe, expect, it } from 'vitest';
import type { DayMark, Routine, RoutineLog, WorkItem } from '../../types/domain';
import {
  dayCount,
  dayItemsFrom,
  effectiveUrgency,
  indexItemsByDate,
  rolledItems,
  followupsByPerson,
  isStale,
  isWorkday,
  itemsOnDay,
  moveItem,
  moveTarget,
  pendingItems,
  routineActiveOn,
  routineLogId,
  routineOccurrencesOn,
  ruleHits,
  ruleLabel,
  compareItems,
  isFocusOn,
  nextWorkday,
  shutdownDue,
} from './desk';

/* 2026-10 日历参考：10-01 周四；10-12 周一 … 10-16 周五（今天）10-17 周六 10-18 周日；10-30 周五 10-31 周六 */
const TODAY = '2026-10-16';
const T0 = '2026-10-01T00:00:00.000Z';

const item = (id: string, p: Partial<WorkItem> = {}): WorkItem => ({
  id,
  kind: 'todo',
  title: id,
  urgency: 'normal',
  scope: 'work',
  status: 'open',
  order: 0,
  createdAt: T0,
  updatedAt: T0,
  ...p,
});

const routine = (id: string, p: Partial<Routine> = {}): Routine => ({
  id,
  title: id,
  scope: 'work',
  rule: { type: 'daily' },
  startDate: '2026-01-01',
  order: 0,
  createdAt: T0,
  updatedAt: T0,
  ...p,
});

const log = (routineId: string, date: string, p: Partial<RoutineLog> = {}): RoutineLog => ({
  id: routineLogId(routineId, date),
  routineId,
  date,
  status: 'done',
  createdAt: T0,
  updatedAt: T0,
  ...p,
});

const logs = (...ls: RoutineLog[]) => Object.fromEntries(ls.map((l) => [l.id, l]));
const mark = (date: string, type: 'off' | 'work', p: Partial<DayMark> = {}): DayMark => ({ id: date, date, type, updatedAt: T0, ...p });
const NO_MARKS: Record<string, DayMark> = {};

describe('工作日判定', () => {
  it('没有标记时周一~周五是工作日', () => {
    expect(isWorkday('2026-10-16', NO_MARKS)).toBe(true);
    expect(isWorkday('2026-10-17', NO_MARKS)).toBe(false);
  });
  it('休/班标记优先，已删除的标记不算', () => {
    const marks = { '2026-10-17': mark('2026-10-17', 'work'), '2026-10-12': mark('2026-10-12', 'off') };
    expect(isWorkday('2026-10-17', marks)).toBe(true);
    expect(isWorkday('2026-10-12', marks)).toBe(false);
    expect(isWorkday('2026-10-12', { '2026-10-12': mark('2026-10-12', 'off', { deletedAt: T0 }) })).toBe(true);
  });
});

describe('例行规则', () => {
  it('每周几', () => {
    expect(ruleHits({ type: 'weekly', daysOfWeek: [1, 3] }, '2026-10-14', NO_MARKS)).toBe(true);
    expect(ruleHits({ type: 'weekly', daysOfWeek: [1, 3] }, '2026-10-15', NO_MARKS)).toBe(false);
  });
  it('每月几号：超出当月天数落在月末；-1 = 月末', () => {
    expect(ruleHits({ type: 'monthlyDay', monthDay: 31 }, '2026-02-28', NO_MARKS)).toBe(true);
    expect(ruleHits({ type: 'monthlyDay', monthDay: 31 }, '2026-02-27', NO_MARKS)).toBe(false);
    expect(ruleHits({ type: 'monthlyDay', monthDay: -1 }, '2026-10-31', NO_MARKS)).toBe(true);
    expect(ruleHits({ type: 'monthlyDay', monthDay: 5 }, '2026-10-05', NO_MARKS)).toBe(true);
  });
  it('每月第 N 个周几 / 最后一个周几', () => {
    expect(ruleHits({ type: 'monthlyNth', nth: 2, weekday: 3 }, '2026-10-14', NO_MARKS)).toBe(true);
    expect(ruleHits({ type: 'monthlyNth', nth: 2, weekday: 3 }, '2026-10-07', NO_MARKS)).toBe(false);
    expect(ruleHits({ type: 'monthlyNth', nth: -1, weekday: 5 }, '2026-10-30', NO_MARKS)).toBe(true);
    expect(ruleHits({ type: 'monthlyNth', nth: -1, weekday: 5 }, '2026-10-23', NO_MARKS)).toBe(false);
  });
  it('工作类只在工作日出现（含补班），生活类不受影响；暂停与起止日生效', () => {
    const sat = routine('r', { rule: { type: 'weekly', daysOfWeek: [6] } });
    expect(routineActiveOn(sat, '2026-10-17', NO_MARKS)).toBe(false);
    expect(routineActiveOn(sat, '2026-10-17', { '2026-10-17': mark('2026-10-17', 'work') })).toBe(true);
    expect(routineActiveOn({ ...sat, scope: 'life' }, '2026-10-17', NO_MARKS)).toBe(true);
    expect(routineActiveOn(routine('r', { paused: true }), TODAY, NO_MARKS)).toBe(false);
    expect(routineActiveOn(routine('r', { startDate: '2026-10-17' }), TODAY, NO_MARKS)).toBe(false);
    expect(routineActiveOn(routine('r', { endDate: '2026-10-15' }), TODAY, NO_MARKS)).toBe(false);
  });
});

describe('某天出现的例行', () => {
  const wed = routine('wed', { rule: { type: 'weekly', daysOfWeek: [3] } });

  it('命中规则的照常出现，带完成/跳过状态', () => {
    const r1 = routine('a');
    const r2 = routine('b');
    const occ = routineOccurrencesOn(TODAY, TODAY, [r1, r2], logs(log('a', TODAY), log('b', TODAY, { status: 'skipped' })), NO_MARKS);
    expect(occ.map((o) => [o.routine.id, o.status])).toEqual([
      ['a', 'done'],
      ['b', 'skipped'],
    ]);
  });

  it('这一次改走了：原日不再出现，新日期出现一次', () => {
    const ls = logs(log('wed', '2026-10-21', { status: 'moved', movedTo: '2026-10-22' }));
    expect(routineOccurrencesOn('2026-10-21', TODAY, [wed], ls, NO_MARKS)).toHaveLength(0);
    const thu = routineOccurrencesOn('2026-10-22', TODAY, [wed], ls, NO_MARKS);
    expect(thu).toHaveLength(1);
    expect(thu[0]).toMatchObject({ origDate: '2026-10-21', movedIn: true, status: 'open' });
  });

  it('改期后没做完的顺延到今天；做完的不顺延', () => {
    const open = logs(log('wed', '2026-10-14', { status: 'moved', movedTo: '2026-10-15' }));
    const today = routineOccurrencesOn(TODAY, TODAY, [wed], open, NO_MARKS);
    expect(today).toEqual([expect.objectContaining({ origDate: '2026-10-14', makeup: true, movedIn: true })]);
    const done = logs(log('wed', '2026-10-14', { status: 'moved', movedTo: '2026-10-15', doneAt: T0 }));
    expect(routineOccurrencesOn(TODAY, TODAY, [wed], done, NO_MARKS)).toHaveLength(0);
  });

  it('本周漏做的周常挂到今天补做；日常不补；上周的不补', () => {
    const daily = routine('daily');
    const occ = routineOccurrencesOn(TODAY, TODAY, [wed, daily], {}, NO_MARKS);
    expect(occ.filter((o) => o.makeup).map((o) => [o.routine.id, o.origDate])).toEqual([['wed', '2026-10-14']]);
    // 2026-10-07 上周三漏了，不应出现
    expect(occ.some((o) => o.origDate === '2026-10-07')).toBe(false);
  });

  it('今天补做完的，今天照样显示为已完成', () => {
    const occ = routineOccurrencesOn(TODAY, TODAY, [wed], logs(log('wed', '2026-10-14', { doneOn: TODAY })), NO_MARKS);
    expect(occ).toEqual([expect.objectContaining({ origDate: '2026-10-14', makeup: true, status: 'done' })]);
  });

  it('本月漏做的月常补到月底', () => {
    const m5 = routine('m5', { rule: { type: 'monthlyDay', monthDay: 5 } });
    const occ = routineOccurrencesOn(TODAY, TODAY, [m5], {}, NO_MARKS);
    expect(occ).toEqual([expect.objectContaining({ origDate: '2026-10-05', makeup: true })]);
  });

  it('只看今天才补做，别的日子不挂补做', () => {
    expect(routineOccurrencesOn('2026-10-19', TODAY, [wed], {}, NO_MARKS)).toHaveLength(0);
  });

  it('已删除的例行与记录都不算', () => {
    expect(routineOccurrencesOn(TODAY, TODAY, [routine('x', { deletedAt: T0 })], {}, NO_MARKS)).toHaveLength(0);
    const occ = routineOccurrencesOn(TODAY, TODAY, [routine('a')], logs(log('a', TODAY, { deletedAt: T0 })), NO_MARKS);
    expect(occ[0].status).toBe('open');
  });

  it('按时间点排序，没写时间的在后', () => {
    const occ = routineOccurrencesOn(
      TODAY,
      TODAY,
      [routine('late', { time: '17:30' }), routine('none'), routine('early', { time: '09:00' })],
      {},
      NO_MARKS,
    );
    expect(occ.map((o) => o.routine.id)).toEqual(['early', 'late', 'none']);
  });
});

describe('事项', () => {
  it('紧急度提档：过截止 ⇒ 紧急；明天截止 ⇒ 至少尽快；已完成不提档', () => {
    expect(effectiveUrgency(item('a', { dueDate: '2026-10-15' }), TODAY)).toBe('urgent');
    expect(effectiveUrgency(item('a', { dueDate: '2026-10-17' }), TODAY)).toBe('soon');
    expect(effectiveUrgency(item('a', { dueDate: '2026-10-17', urgency: 'urgent' }), TODAY)).toBe('urgent');
    expect(effectiveUrgency(item('a', { dueDate: '2026-10-20' }), TODAY)).toBe('normal');
    expect(effectiveUrgency(item('a', { dueDate: '2026-10-15', status: 'done' }), TODAY)).toBe('normal');
  });

  it('某天的事项：过去没做完的只在今天顺延；不做了的不算完成；删除的不出现', () => {
    const items = [
      item('old', { date: '2026-10-12' }),
      item('mine', { date: TODAY }),
      item('hot', { date: TODAY, urgency: 'urgent' }),
      item('done', { date: TODAY, status: 'done' }),
      item('dropped', { date: TODAY, status: 'dropped' }),
      item('gone', { date: TODAY, deletedAt: T0 }),
    ];
    const today = itemsOnDay(items, TODAY, TODAY);
    expect(today.rolled.map((i) => i.id)).toEqual(['old']);
    expect(today.open.map((i) => i.id)).toEqual(['hot', 'mine']);
    expect(today.done.map((i) => i.id)).toEqual(['done']);
    expect(itemsOnDay(items, '2026-10-17', TODAY).rolled).toEqual([]);
  });

  it('待处理 = 未完成且没排日子', () => {
    const items = [item('a'), item('b', { date: TODAY }), item('c', { status: 'done' })];
    expect(pendingItems(items, TODAY).map((i) => i.id)).toEqual(['a']);
  });

  it('拖延信号：挪过 3 次，或过期顺延 3 天', () => {
    expect(isStale(item('a', { deferCount: 3, date: TODAY }), TODAY)).toBe(true);
    expect(isStale(item('a', { date: '2026-10-13' }), TODAY)).toBe(true);
    expect(isStale(item('a', { date: '2026-10-14' }), TODAY)).toBe(false);
    expect(isStale(item('a', { date: '2026-10-13', status: 'done' }), TODAY)).toBe(false);
  });

  it('跟进按人聚合：件数多的在前，最久天数从创建日算', () => {
    const fu = (id: string, person: string, created: string) =>
      item(id, { kind: 'followup', person, mode: 'inform', createdAt: `${created}T08:00:00.000Z` });
    const groups = followupsByPerson(
      [fu('1', '张经理', '2026-10-13'), fu('2', '张经理', '2026-10-15'), fu('3', '王芳', '2026-10-09'), item('4')],
      TODAY,
    );
    expect(groups.map((g) => [g.person, g.items.length, g.oldestDays])).toEqual([
      ['张经理', 2, 3],
      ['王芳', 1, 7],
    ]);
  });
});

describe('挪动', () => {
  it('目标日：过期/待处理按今天起算；下周一；下周同一天', () => {
    expect(moveTarget('tomorrow', '2026-10-12', TODAY)).toBe('2026-10-17');
    expect(moveTarget('tomorrow', undefined, TODAY)).toBe('2026-10-17');
    expect(moveTarget('nextMonday', TODAY, TODAY)).toBe('2026-10-19');
    expect(moveTarget('nextMonday', '2026-10-18', TODAY)).toBe('2026-10-19');
    expect(moveTarget('sameDayNextWeek', '2026-10-21', TODAY)).toBe('2026-10-28');
  });

  it('往后挪 deferCount + 1；往前挪、从待处理排进来不加；进待处理去掉 date', () => {
    const stamp = '2026-10-16T09:00:00.000Z';
    expect(moveItem(item('a', { date: TODAY }), '2026-10-19', stamp).item.deferCount).toBe(1);
    expect(moveItem(item('a', { date: TODAY, deferCount: 2 }), '2026-10-19', stamp).item.deferCount).toBe(3);
    expect(moveItem(item('a', { date: '2026-10-20' }), '2026-10-19', stamp).item.deferCount).toBeUndefined();
    expect(moveItem(item('a'), '2026-10-19', stamp).item.deferCount).toBeUndefined();
    const toPending = moveItem(item('a', { date: TODAY }), null, stamp).item;
    expect('date' in toPending).toBe(false);
    expect(toPending.updatedAt).toBe(stamp);
  });

  it('挪到截止日之后要提示', () => {
    expect(moveItem(item('a', { date: TODAY, dueDate: '2026-10-17' }), '2026-10-19', T0).pastDue).toBe(true);
    expect(moveItem(item('a', { date: TODAY, dueDate: '2026-10-19' }), '2026-10-19', T0).pastDue).toBe(false);
  });
});

describe('日卡计数', () => {
  const occ = (status: 'open' | 'done' | 'skipped') => ({ routine: routine('r'), origDate: TODAY, status, makeup: false, movedIn: false });
  it('过去的日子只算做完的；今天含顺延；跳过不算', () => {
    const items = [item('a', { date: '2026-10-12', status: 'done' }), item('b', { date: '2026-10-12' }), item('c', { date: TODAY })];
    const idx = indexItemsByDate(items);
    const rolled = rolledItems(items, TODAY);
    const past = dayItemsFrom(idx, rolled, '2026-10-12', TODAY);
    expect(dayCount('2026-10-12', TODAY, past, [occ('open')])).toEqual({ done: 1, total: 1 });
    const today = dayItemsFrom(idx, rolled, TODAY, TODAY);
    expect(today.rolled.map((i) => i.id)).toEqual(['b']);
    expect(dayCount(TODAY, TODAY, today, [occ('done'), occ('open'), occ('skipped')])).toEqual({ done: 1, total: 4 });
  });

  it('索引不收待处理与已删除', () => {
    const idx = indexItemsByDate([item('a'), item('b', { date: TODAY, deletedAt: T0 }), item('c', { date: TODAY })]);
    expect([...idx.keys()]).toEqual([TODAY]);
    expect(idx.get(TODAY)!.map((i) => i.id)).toEqual(['c']);
  });
});

describe('ruleLabel 规则的中文说法', () => {
  it('五种规则', () => {
    expect(ruleLabel({ type: 'daily' })).toBe('每天');
    expect(ruleLabel({ type: 'workday' })).toBe('每个工作日');
    expect(ruleLabel({ type: 'weekly', daysOfWeek: [0, 3, 1] })).toBe('每周一、三、日');
    expect(ruleLabel({ type: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })).toBe('每天');
    expect(ruleLabel({ type: 'monthlyDay', monthDay: 5 })).toBe('每月 5 号');
    expect(ruleLabel({ type: 'monthlyDay', monthDay: -1 })).toBe('每月最后一天');
    expect(ruleLabel({ type: 'monthlyNth', nth: 2, weekday: 3 })).toBe('每月第 2 个周三');
    expect(ruleLabel({ type: 'monthlyNth', nth: -1, weekday: 5 })).toBe('每月最后一个周五');
  });
});

describe('不做了', () => {
  it('单列在 dropped，不进完成也不进未完成，不计数', () => {
    const items = [item('a', { date: TODAY, status: 'dropped' }), item('b', { date: TODAY, status: 'done' }), item('c', { date: TODAY })];
    const d = itemsOnDay(items, TODAY, TODAY);
    expect(d.dropped.map((i) => i.id)).toEqual(['a']);
    expect(d.done.map((i) => i.id)).toEqual(['b']);
    expect(d.open.map((i) => i.id)).toEqual(['c']);
    expect(dayCount(TODAY, TODAY, d, [])).toEqual({ done: 1, total: 2 });
  });
});

describe('v3：重要 / 要事 / 下个工作日 / 收尾', () => {
  it('同紧急度里重要的在前；紧急度仍优先于重要', () => {
    const list = [item('a', { order: 1 }), item('b', { order: 2, important: true }), item('c', { order: 3, urgency: 'urgent' })];
    expect(list.sort((x, y) => compareItems(x, y, TODAY)).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
  it('要事只认 focusOn 那天，「不做了」和删掉的不算', () => {
    expect(isFocusOn(item('a', { focusOn: TODAY }), TODAY)).toBe(true);
    expect(isFocusOn(item('a', { focusOn: TODAY }), '2026-10-17')).toBe(false);
    expect(isFocusOn(item('a', { focusOn: TODAY, status: 'dropped' }), TODAY)).toBe(false);
    expect(isFocusOn(item('a', { focusOn: TODAY, deletedAt: T0 }), TODAY)).toBe(false);
    expect(isFocusOn(item('a', { focusOn: TODAY, status: 'done' }), TODAY)).toBe(true);
  });
  it('下个工作日：周五 ⇒ 下周一；周六标了补班 ⇒ 周六；周一标了休 ⇒ 周二', () => {
    expect(nextWorkday(TODAY, {})).toBe('2026-10-19');
    const work: DayMark = { id: '2026-10-17', date: '2026-10-17', type: 'work', updatedAt: T0 };
    expect(nextWorkday(TODAY, { '2026-10-17': work })).toBe('2026-10-17');
    const off: DayMark = { id: '2026-10-19', date: '2026-10-19', type: 'off', updatedAt: T0 };
    expect(nextWorkday(TODAY, { '2026-10-19': off })).toBe('2026-10-20');
  });
  it('收尾提醒：设了时间、到点、工作日、今天没收工', () => {
    const base = { nowHm: '17:30', at: '17:30', today: TODAY, doneOn: null, marks: {} };
    expect(shutdownDue(base)).toBe(true);
    expect(shutdownDue({ ...base, nowHm: '17:29' })).toBe(false);
    expect(shutdownDue({ ...base, at: '' })).toBe(false);
    expect(shutdownDue({ ...base, at: undefined })).toBe(false);
    expect(shutdownDue({ ...base, doneOn: TODAY })).toBe(false);
    expect(shutdownDue({ ...base, doneOn: '2026-10-15' })).toBe(true);
    expect(shutdownDue({ ...base, today: '2026-10-17' })).toBe(false); // 周六
  });
});
