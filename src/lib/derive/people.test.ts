import { describe, expect, it } from 'vitest';
import type { Interaction, Person, PersonDate, WorkItem } from '../../types/domain';
import { agoLabel, contactStates, dateTitle, lastContactOf, nextOccurrence, prepDue, prepItems, prepKey, upcomingDates } from './people';

const TODAY = '2026-10-19';
const T0 = '2026-09-01T00:00:00.000Z';
const STAMP = '2026-10-19T08:00:00.000Z';

function person(id: string, over: Partial<Person> = {}): Person {
  return { id, name: id, relation: 'friend', order: 0, createdAt: T0, updatedAt: T0, ...over };
}
function talk(personId: string, date: string, over: Partial<Interaction> = {}): Interaction {
  return { id: `${personId}-${date}`, personId, date, kind: 'chat', createdAt: T0, updatedAt: T0, ...over };
}
function followup(person: string, doneAt: string): WorkItem {
  return { id: `f-${person}-${doneAt}`, kind: 'followup', title: 'x', person, urgency: 'normal', scope: 'work', status: 'done', doneAt, order: 0, createdAt: T0, updatedAt: T0 };
}
const date = (over: Partial<PersonDate> = {}): PersonDate => ({ id: 'd1', label: '生日', month: 11, day: 2, ...over });

describe('上次联系 / 该联系', () => {
  it('取互动记录与做完的 @人 跟进里较晚的', () => {
    const p = person('妈妈');
    expect(lastContactOf(p, [], [])).toBeUndefined();
    expect(lastContactOf(p, [talk('妈妈', '2026-10-01'), talk('妈妈', '2026-10-05'), talk('别人', '2026-10-18')], [])).toBe('2026-10-05');
    expect(lastContactOf(p, [talk('妈妈', '2026-10-05')], [followup('妈妈', '2026-10-10T02:00:00.000Z')])).toBe('2026-10-10');
    const deleted = { ...talk('妈妈', '2026-10-15'), deletedAt: T0 };
    expect(lastContactOf(p, [talk('妈妈', '2026-10-05'), deleted], [])).toBe('2026-10-05');
  });
  it('只算设了节奏的人；超得最多（按比例）的在前；没联系过从建档算', () => {
    const people = [person('妈妈', { cadenceDays: 7 }), person('老同学', { cadenceDays: 90 }), person('同事'), person('小美', { cadenceDays: 14 })];
    const st = contactStates(people, [talk('妈妈', '2026-09-26'), talk('小美', '2026-10-15')], [], TODAY);
    expect(st.map((s) => s.person.name)).toEqual(['妈妈', '老同学', '小美']);
    expect(st[0]).toMatchObject({ days: 23, over: 16, last: '2026-09-26' });
    expect(st[1]).toMatchObject({ days: 48, over: -42, last: undefined });
  });
  it('多久前', () => {
    expect(agoLabel(undefined, TODAY)).toBe('还没联系过');
    expect(agoLabel(TODAY, TODAY)).toBe('今天');
    expect(agoLabel('2026-10-18', TODAY)).toBe('昨天');
    expect(agoLabel('2026-10-01', TODAY)).toBe('18 天前');
    expect(agoLabel('2026-06-01', TODAY)).toBe('4 个月前');
    expect(agoLabel('2024-06-01', TODAY)).toBe('2 年前');
  });
});

describe('重要日子', () => {
  it('公历：今年没到 ⇒ 今年，过了 ⇒ 明年，当天算', () => {
    expect(nextOccurrence(date(), TODAY)).toBe('2026-11-02');
    expect(nextOccurrence(date({ month: 3, day: 8 }), TODAY)).toBe('2027-03-08');
    expect(nextOccurrence(date({ month: 10, day: 19 }), TODAY)).toBe(TODAY);
  });
  it('2 月 29 日在平年落到 2 月 28 日', () => {
    expect(nextOccurrence(date({ month: 2, day: 29 }), TODAY)).toBe('2027-02-28');
    expect(nextOccurrence(date({ month: 2, day: 29 }), '2027-03-01')).toBe('2028-02-29');
  });
  it('农历：中秋', () => {
    expect(nextOccurrence(date({ month: 8, day: 15, lunar: true }), '2026-09-01')).toBe('2026-09-25');
    expect(nextOccurrence(date({ month: 9, day: 20, lunar: true }), TODAY)).toBe('2026-10-29'); // 2026 九月二十
  });
  it('30 天内的，近的在前；带起始年算岁数 / 周年', () => {
    const a = person('小美', { dates: [date({ year: 1995 })] });
    const b = person('爸爸', { dates: [date({ id: 'd2', label: '生日', month: 10, day: 25 })] });
    const c = person('老婆', { relation: 'partner', dates: [date({ id: 'd3', label: '结婚纪念日', month: 10, day: 20, year: 2020 })] });
    const far = person('远', { dates: [date({ month: 12, day: 31 })] });
    const list = upcomingDates([a, b, c, far], TODAY);
    expect(list.map((u) => [u.person.name, u.days])).toEqual([
      ['老婆', 1],
      ['爸爸', 6],
      ['小美', 14],
    ]);
    expect(dateTitle(list[0])).toBe('老婆 6 周年结婚纪念日');
    expect(dateTitle(list[2])).toBe('小美 31 岁生日');
    expect(dateTitle(list[1])).toBe('爸爸生日');
  });
});

describe('倒推准备待办', () => {
  it('14 天窗口内、没生成过、没关掉准备的才要生成', () => {
    const a = person('小美', { dates: [date()] }); // 11-02，还有 14 天
    const b = person('爸爸', { dates: [date({ id: 'd2', month: 10, day: 25, noPrep: true })] });
    const c = person('老婆', { dates: [date({ id: 'd3', month: 10, day: 20 })], prepared: ['d3@2026-10-20'] });
    const t = person('今天', { dates: [date({ id: 'd4', month: 10, day: 19 })] });
    expect(prepDue([a, b, c, t], TODAY).map((u) => u.person.name)).toEqual(['小美']);
    expect(prepKey(prepDue([a], TODAY)[0])).toBe('d1@2026-11-02');
  });
  it('还有 14 天：三步分别排在 14 / 7 / 1 天前，确定的 id，截止前一天', () => {
    const p = person('小美', { dates: [date()], loveLanguages: ['time'], likes: '猫、抹茶', ideas: [{ id: 'i1', text: '想去看海', at: '2026-09-01' }, { id: 'i2', text: '旧的', at: '2026-01-01', used: '2026-02-01' }] });
    const [u] = upcomingDates([p], TODAY);
    const items = prepItems(u, TODAY, STAMP);
    expect(items.map((i) => [i.date, i.title])).toEqual([
      ['2026-10-19', '想想小美生日准备什么'],
      ['2026-10-26', '把小美生日的礼物 / 安排定下来'],
      ['2026-11-01', '明天小美生日：写几句具体的话'],
    ]);
    expect(items[0].id).toBe('prep-小美-d1-2026-11-02-14');
    expect(items.every((i) => i.dueDate === '2026-11-01' && i.scope === 'life' && i.kind === 'todo')).toBe(true);
    expect(items[2].urgency).toBe('soon');
    expect(items[0].note).toContain('精心的时刻');
    expect(items[0].note).toContain('想去看海');
    expect(items[0].note).not.toContain('旧的');
  });
  it('只剩 5 天：14 与 7 天那两步合成今天一步；只剩 1 天：三步合一', () => {
    const p = person('爸爸', { relation: 'colleague', dates: [date({ month: 10, day: 24 })] });
    const items = prepItems(upcomingDates([p], TODAY)[0], TODAY, STAMP);
    expect(items.map((i) => [i.date, i.title])).toEqual([
      ['2026-10-19', '爸爸生日：想好并定下礼物 / 安排'],
      ['2026-10-23', '明天爸爸生日：写几句具体的话'],
    ]);
    expect(items[0].scope).toBe('work'); // 同事 / 上级的放工作区
    const q = person('妈妈', { dates: [date({ month: 10, day: 20 })] });
    const one = prepItems(upcomingDates([q], TODAY)[0], TODAY, STAMP);
    expect(one.map((i) => [i.date, i.title])).toEqual([['2026-10-19', '明天妈妈生日：礼物 / 安排 + 写几句具体的话']]);
  });
  it('当天不再准备', () => {
    const p = person('今天', { dates: [date({ month: 10, day: 19 })] });
    expect(prepItems(upcomingDates([p], TODAY)[0], TODAY, STAMP)).toEqual([]);
  });
});
