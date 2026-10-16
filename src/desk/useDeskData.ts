/**
 * 工作台的派生数据入口：一次建索引，周历 7 天 / 月历 42 天 / 小月历 35 天共用。
 * 只订阅工作台四张表 + 甘特联动要用的几张，别的表变了不重算。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { todayStr } from '../lib/date';
import {
  dayCount,
  dayItemsFrom,
  effectiveUrgency,
  indexItemsByDate,
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

export interface DayData {
  date: string;
  day: DayItems;
  occ: RoutineOccurrence[];
  count: DayCount;
  /** 未完成里显示为紧急的件数（小月历红点） */
  hot: number;
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
      return { date, day, occ, count: dayCount(date, today, day, occ), hot };
    },
    [index, rolled, today, routineList, routineLogs, dayMarks],
  );

  return { today, items, dayOf, dayMarks };
}
