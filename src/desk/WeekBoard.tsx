/**
 * 周历：七张日卡。今天最宽，其余平分；周末有事 1fr、没事 0.7fr。
 * 收起周末时周六日收成窄条（仍可拖进去，点一下展开）；今天正好是周末时那天照常展开。
 */
import { addDays } from '../lib/derive/desk';
import { COL_FR, RAIL_W } from './constants';
import { DayCard } from './DayCard';
import { isWeekendDate } from './format';
import type { PlanRowData } from './usePlanRows';
import type { DayData } from './useDeskData';
import { useDeskUi } from './uiStore';

export function WeekBoard({ monday, today, dayOf, plan, planHidden }: { monday: string; today: string; dayOf: (d: string) => DayData; plan: PlanRowData[]; planHidden: number }) {
  const hideWeekend = useDeskUi((s) => s.hideWeekend);
  const days = Array.from({ length: 7 }, (_, n) => dayOf(addDays(monday, n)));
  const rail = (d: DayData) => hideWeekend && isWeekendDate(d.date) && d.date !== today;
  const cols = days
    .map((d) => {
      if (rail(d)) return `${RAIL_W}px`;
      const fr = d.date === today ? COL_FR.today : !isWeekendDate(d.date) ? COL_FR.normal : d.count.total > 0 ? COL_FR.weekendBusy : COL_FR.weekendEmpty;
      return `minmax(0, ${fr}fr)`;
    })
    .join(' ');
  return (
    <div className="dk-board" style={{ gridTemplateColumns: cols }}>
      {days.map((d) => (
        <DayCard
          key={d.date}
          data={d}
          today={today}
          rail={rail(d)}
          plan={d.date === today ? plan : undefined}
          planHidden={d.date === today ? planHidden : undefined}
        />
      ))}
    </div>
  );
}
