/**
 * 工作台的派生数据入口：一次建索引，周历 7 天 / 月历 42 天 / 小月历 35 天共用。
 * 只订阅工作台四张表 + 甘特联动要用的几张，别的表变了不重算。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { todayStr } from '../lib/date';
import type { WorkItem } from '../types/domain';
import {
  dayCount,
  dayItemsFrom,
  compareItems,
  effectiveUrgency,
  indexItemsByDate,
  isFocusOn,
  rolledItems,
  routineOccurrencesOn,
  type DayCount,
  type DayItems,
  type RoutineOccurrence,
} from '../lib/derive/desk';

/** 跨午夜自动换「今天」（工作台常开不关） */
export function useToday(): string {
  const [today, setToday] = useState(todayStr);
  useEffect(() => {
    const t = setInterval(() => setToday((prev) => (prev === todayStr() ? prev : todayStr())), 60_000);
    return () => clearInterval(t);
  }, []);
  return today;
}

/** 现在几点 HH:mm（每 30 秒刷新；头部到点提醒收尾用） */
export function useNowHm(): string {
  const read = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const [hm, setHm] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setHm(read), 30_000);
    return () => clearInterval(t);
  }, []);
  return hm;
}

export interface DayData {
  date: string;
  day: DayItems;
  occ: RoutineOccurrence[];
  count: DayCount;
  /** 未完成里显示为紧急的件数（小月历红点） */
  hot: number;
  /** 这天的要事（focusOn = 这天；今天含顺延来的）：没做完的在前 */
  focus: WorkItem[];
}

export function useDeskData() {
  const workItems = useStore((s) => s.workItems);
  const routines = useStore((s) => s.routines);
  const routineLogs = useStore((s) => s.routineLogs);
  const dayMarks = useStore((s) => s.dayMarks);
  const today = useToday();

  const items = useMemo(() => Object.values(workItems), [workItems]);
  const routineList = useMemo(() => Object.values(routines), [routines]);
  const index = useMemo(() => indexItemsByDate(items), [items]);
  const rolled = useMemo(() => rolledItems(items, today), [items, today]);

  const dayOf = useCallback(
    (date: string): DayData => {
      const day = dayItemsFrom(index, rolled, date, today);
      const occ = routineOccurrencesOn(date, today, routineList, routineLogs, dayMarks);
      const hot = [...day.open, ...day.rolled].filter((i) => effectiveUrgency(i, today) === 'urgent').length;
      // 过去的日子只认做完的要事（没做完的已挂到今天，在那边按普通事项显示）
      const focus = (date < today ? day.done : [...day.rolled, ...day.open, ...day.done])
        .filter((i) => isFocusOn(i, date))
        .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || compareItems(a, b, today));
      return { date, day, occ, count: dayCount(date, today, day, occ), hot, focus };
    },
    [index, rolled, today, routineList, routineLogs, dayMarks],
  );

  return { today, items, dayOf, dayMarks };
}
