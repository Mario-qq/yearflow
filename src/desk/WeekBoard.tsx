/** 周历：七张日卡。今天 2fr，周末有事 1fr、没事 0.7fr */
import { addDays } from '../lib/derive/desk';
import { COL_FR } from './constants';
import { DayCard } from './DayCard';
import { isWeekendDate } from './format';
import type { PlanRowData } from './usePlanRows';
import type { DayData } from './useDeskData';
import type { StudyView } from './study';

export function WeekBoard({ monday, today, dayOf, plan, study }: { monday: string; today: string; dayOf: (d: string) => DayData; plan: PlanRowData[]; study: StudyView }) {
  const days = Array.from({ length: 7 }, (_, n) => dayOf(addDays(monday, n)));
  const cols = days
    .map((d) => {
      const fr = d.date === today ? COL_FR.today : !isWeekendDate(d.date) ? COL_FR.normal : d.count.total > 0 ? COL_FR.weekendBusy : COL_FR.weekendEmpty;
      return `minmax(0, ${fr}fr)`;
    })
    .join(' ');
  return (
    <div className="dk-board" style={{ gridTemplateColumns: cols }}>
      {days.map((d) => (
        <DayCard key={d.date} data={d} today={today} plan={d.date === today ? plan : undefined} study={d.date === today ? study : undefined} />
      ))}
    </div>
  );
}
