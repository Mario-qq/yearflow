/**
 * 人际的派生（docs/PEOPLE_SPEC.md）：上次联系、该联系了、重要日子的下一次、倒推准备待办。都是纯函数，不入库。
 *
 * 「上次联系」= 互动记录的最晚日期，和 TA 名下做完的 @人 跟进（告知了 / 下发了也是一次联系）取较晚者。
 */
import type { Interaction, InteractionKind, LoveLanguage, Person, PersonDate, Relation, WorkItem } from '../../types/domain';
import { dayjs, diffDays, fmtDay, toDay } from '../date';
import { nextLunarDate } from '../lunar';
import { addDays } from './desk';

/** 倒推准备：提前几天做哪一步 */
export const PREP_STEPS = [14, 7, 1] as const;
/** 提前多少天开始在工作台提醒「快到了」 */
export const DATE_SOON_DAYS = 14;

export const RELATION_LABEL: Record<Relation, string> = {
  partner: '伴侣',
  family: '家人',
  friend: '朋友',
  colleague: '同事',
  boss: '上级',
  other: '其他',
};

export const KIND_LABEL: Record<InteractionKind, string> = {
  chat: '聊天',
  call: '电话',
  meet: '见面',
  message: '消息',
  gift: '送礼',
  help: '帮忙',
};

export const LOVE_LABEL: Record<LoveLanguage, { name: string; tip: string }> = {
  words: { name: '肯定的言辞', tip: '具体地夸、写几句真心话、说谢谢' },
  time: { name: '精心的时刻', tip: '放下手机的专门时间：一起吃饭、散步、聊天' },
  gifts: { name: '接受礼物', tip: '用心挑的小东西，重在「你记得」' },
  service: { name: '服务的行动', tip: '替 TA 做件事：跑腿、修东西、分担家务' },
  touch: { name: '身体的接触', tip: '拥抱、牵手、拍拍肩（看关系）' },
};

/** ISO 时刻 → 本地日期（一天边界 = 本地 00:00） */
const localDay = (iso: string) => fmtDay(dayjs(iso));

/** 某人的上次联系日期（没有任何记录 = undefined） */
export function lastContactOf(p: Person, interactions: Interaction[], items: WorkItem[]): string | undefined {
  let last: string | undefined;
  for (const i of interactions) if (i.personId === p.id && !i.deletedAt && (!last || i.date > last)) last = i.date;
  for (const w of items) {
    if (w.deletedAt || w.status !== 'done' || w.kind !== 'followup' || w.person !== p.name || !w.doneAt) continue;
    const d = localDay(w.doneAt);
    if (!last || d > last) last = d;
  }
  return last;
}

export interface ContactState {
  person: Person;
  last?: string;
  /** 多少天没联系（从没联系过 = 从建档那天算） */
  days: number;
  /** 超了节奏几天（< 0 = 还没到） */
  over: number;
}

/** 设了节奏的人的联系状态，超得最多（按节奏比例）的在前 */
export function contactStates(people: Person[], interactions: Interaction[], items: WorkItem[], today: string): ContactState[] {
  return people
    .filter((p) => !p.deletedAt && p.cadenceDays)
    .map((p) => {
      const last = lastContactOf(p, interactions, items);
      const days = Math.max(0, diffDays(today, last ?? localDay(p.createdAt)));
      return { person: p, last, days, over: days - p.cadenceDays! };
    })
    .sort((a, b) => b.days / b.person.cadenceDays! - a.days / a.person.cadenceDays!);
}

/** 公历 month/day 在 year 年的日期；2 月 29 日在平年落到 2 月 28 日 */
function solarIn(year: number, month: number, day: number): string {
  const first = toDay(`${year}-${String(month).padStart(2, '0')}-01`);
  return fmtDay(first.date(Math.min(day, first.daysInMonth())));
}

/** 重要日子从 from（含）起的下一次（公历日期）；农历在不支持的环境返回 null */
export function nextOccurrence(pd: PersonDate, from: string): string | null {
  if (pd.lunar) return nextLunarDate(pd.month, pd.day, from);
  const y = toDay(from).year();
  const thisYear = solarIn(y, pd.month, pd.day);
  return thisYear >= from ? thisYear : solarIn(y + 1, pd.month, pd.day);
}

export interface UpcomingDate {
  person: Person;
  date: PersonDate;
  on: string; // 公历
  days: number; // 还有几天（0 = 今天）
  /** 第几年（设了起始年才有）：生日 = 岁，纪念日 = 周年 */
  nth?: number;
}

/** within 天内（含今天）的重要日子，近的在前 */
export function upcomingDates(people: Person[], today: string, within = 30): UpcomingDate[] {
  const out: UpcomingDate[] = [];
  for (const p of people) {
    if (p.deletedAt) continue;
    for (const d of p.dates ?? []) {
      const on = nextOccurrence(d, today);
      if (!on) continue;
      const days = diffDays(on, today);
      if (days > within) continue;
      const nth = d.year ? toDay(on).year() - d.year : undefined;
      out.push({ person: p, date: d, on, days, ...(nth && nth > 0 ? { nth } : {}) });
    }
  }
  return out.sort((a, b) => a.days - b.days || a.person.order - b.person.order);
}

/** 第几年的说法：生日 =「31 岁」，纪念日 =「6 周年」，别的不说 */
export function nthLabel(label: string, nth?: number): string {
  if (!nth || nth <= 0) return '';
  return /生日/.test(label) ? `${nth} 岁` : /纪念|结婚|恋爱|认识/.test(label) ? `${nth} 周年` : '';
}

/** 「小美生日」「妈妈 60 岁生日」「老婆 6 周年结婚纪念日」 */
export function dateTitle(u: Pick<UpcomingDate, 'person' | 'date' | 'nth'>): string {
  const n = nthLabel(u.date.label, u.nth);
  return `${u.person.name}${n ? ` ${n}` : ''}${u.date.label}`;
}

export const prepKey = (u: Pick<UpcomingDate, 'date' | 'on'>): string => `${u.date.id}@${u.on}`;

/** 倒推准备待办里要写进备注的素材：爱的语言、喜好、没用过的点子 */
function prepNote(p: Person): string | undefined {
  const lines: string[] = [];
  const love = p.loveLanguages?.[0];
  if (love) lines.push(`TA 最看重：${LOVE_LABEL[love].name}（${LOVE_LABEL[love].tip}）`);
  if (p.likes) lines.push(`喜欢：${p.likes}`);
  if (p.dislikes) lines.push(`避开：${p.dislikes}`);
  const ideas = (p.ideas ?? []).filter((i) => !i.used).map((i) => i.text);
  if (ideas.length) lines.push(`点子池：${ideas.join('；')}`);
  return lines.length ? lines.join('\n') : undefined;
}

/**
 * 某次重要日子的倒推准备待办（14 / 7 / 1 天前），已经过了的步骤排在今天。当天及以后不再准备。
 * id 确定（两台设备同时生成不会重复）；调用方负责查 person.prepared 防止删掉后又生成。
 */
export function prepItems(u: UpcomingDate, today: string, stamp: string): WorkItem[] {
  if (u.days <= 0 || u.date.noPrep) return [];
  const p = u.person;
  const what = dateTitle(u);
  const scope = p.relation === 'colleague' || p.relation === 'boss' ? 'work' : 'life';
  const note = prepNote(p);
  const steps: [number, string][] = [
    [14, `想想${what}准备什么`],
    [7, `把${what}的礼物 / 安排定下来`],
    [1, `明天${what}：写几句具体的话`],
  ];
  // 已经过了的步骤排在今天；同一天撞上的几步合成一步（标题用最后那步，前面没做的补在前头）
  const byDate = new Map<string, { n: number; title: string; merged: number }>();
  for (const [n, title] of steps) {
    const date = addDays(u.on, -n) < today ? today : addDays(u.on, -n);
    const prev = byDate.get(date);
    byDate.set(date, { n, title, merged: (prev?.merged ?? 0) + 1 });
  }
  const due = addDays(u.on, -1) < today ? today : addDays(u.on, -1);
  return [...byDate.entries()].map(([date, { n, title, merged }], k) => ({
    id: `prep-${p.id}-${u.date.id}-${u.on}-${n}`,
    kind: 'todo' as const,
    title: merged > 1 && n === 1 ? `明天${what}：礼物 / 安排 + 写几句具体的话` : merged > 1 && n === 7 ? `${what}：想好并定下礼物 / 安排` : title,
    urgency: n === 1 ? ('soon' as const) : ('normal' as const),
    scope,
    date,
    dueDate: due,
    status: 'open' as const,
    order: Date.parse(stamp) + k,
    createdAt: stamp,
    updatedAt: stamp,
    ...(note ? { note } : {}),
  }));
}

/** 现在该为哪些日子生成准备待办：进了 14 天窗口、还没生成过、没关掉准备 */
export function prepDue(people: Person[], today: string): UpcomingDate[] {
  return upcomingDates(people, today, DATE_SOON_DAYS).filter((u) => u.days > 0 && !u.date.noPrep && !(u.person.prepared ?? []).includes(prepKey(u)));
}

export function interactionsOf(personId: string, interactions: Interaction[]): Interaction[] {
  return interactions.filter((i) => i.personId === personId && !i.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** 「今天」「昨天」「3 天前」「2 个月前」 */
export function agoLabel(date: string | undefined, today: string): string {
  if (!date) return '还没联系过';
  const n = diffDays(today, date);
  if (n <= 0) return '今天';
  if (n === 1) return '昨天';
  if (n < 30) return `${n} 天前`;
  if (n < 365) return `${Math.floor(n / 30)} 个月前`;
  return `${Math.floor(n / 365)} 年前`;
}
