/**
 * 头部（一行到底、不折行）：左边日历小牌 + 星期/周次 + 今日脉搏（一排小药丸说清今天的局面，@人可点开人物卡）；
 * 右边学习卡 + 一张安静的统计卡（同高并排）：本周完成环 + 每天完成数小柱、学习周目标点阵、最近两个里程碑倒计时（甘特联动，保留紧迫感）。
 */
import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { diffDays, toDay } from '../lib/date';
import { addDays, effectiveUrgency, followupsByPerson, shutdownDue, weekMonday } from '../lib/derive/desk';
import { goalColor } from '../lib/colors';
import { personColor } from './constants';
import { weekdayCn } from './format';
import type { PlanRowData } from './usePlanRows';
import { useNowHm, type DayData } from './useDeskData';
import { useDeskUi } from './uiStore';
import type { WorkItem } from '../types/domain';
import type { StudyView } from './study';
import { StudyCard, StudyDots } from './StudyCard';

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

export function DeskHero({ today, items, dayOf, plan, study }: { today: string; items: WorkItem[]; dayOf: (d: string) => DayData; plan: PlanRowData[]; study: StudyView }) {
  const milestones = useStore((s) => s.milestones);
  const goals = useStore((s) => s.goals);
  const marks = useStore((s) => s.dayMarks);
  const shutdownAt = useStore((s) => s.settings.desk.shutdownAt);
  const doneOn = useDeskUi((s) => s.shutdownDoneOn);
  const nowHm = useNowHm();

  const t = dayOf(today);
  const urgent = [...t.day.rolled, ...t.day.open].filter((i) => effectiveUrgency(i, today) === 'urgent').length;
  const top = useMemo(() => followupsByPerson(items, today)[0], [items, today]);
  const planLeft = plan.filter((p) => !p.status).length;
  const focus = t.focus;
  const focusLeft = focus.filter((i) => i.status === 'open').length;
  const openLeft = t.day.rolled.length + t.day.open.length;
  const sdDue = shutdownDue({ nowHm, at: shutdownAt, today, doneOn, marks });

  const monday = weekMonday(today);
  const week = Array.from({ length: 7 }, (_, n) => dayOf(addDays(monday, n)).count);
  const done = week.reduce((s, c) => s + c.done, 0);
  const total = week.reduce((s, c) => s + c.total, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const max = Math.max(4, ...week.map((c) => c.done));

  const nextMs = useMemo(
    () =>
      Object.values(milestones)
        .filter((m) => !m.achieved && m.date >= today && goals[m.goalId] && !goals[m.goalId].archived)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 2),
    [milestones, goals, today],
  );

  const d = toDay(today);
  return (
    <section className="dk-hero">
      <div className="dk-h-main">
        <div className="dk-h-cal" aria-hidden>
          <span className="m tnum">{d.month() + 1}月</span>
          <span className="d tnum">{d.date()}</span>
        </div>
        <div className="dk-h-txt">
          <div className="dk-h-title">
            <span className="wd">{weekdayCn(today)}</span>
            <span className="wk tnum">第 {d.isoWeek()} 周</span>
          </div>
          <div className="dk-h-say">
            {sdDue && (
              <span className="sd">
                <i style={{ '--c': 'var(--accent)' } as React.CSSProperties} />
                <button type="button" onClick={() => useDeskUi.getState().set({ shutdown: true })}>
                  该收尾了
                </button>
                {openLeft ? (
                  <>
                    还有 <b className="tnum">{openLeft}</b> 件没做完要安排
                  </>
                ) : (
                  '今天的都做完了'
                )}
              </span>
            )}
            {doneOn === today && (
              <span>
                <i style={{ '--c': 'var(--success)' } as React.CSSProperties} />
                今天已收工
              </span>
            )}
            {focus.length > 0 && (
              <span>
                <i style={{ '--c': focusLeft ? 'var(--accent)' : 'var(--success)' } as React.CSSProperties} />
                {focusLeft ? (
                  <>
                    要事还剩 <b className="tnum">{focusLeft}</b> / {focus.length}
                  </>
                ) : (
                  `${focus.length} 件要事都做完了`
                )}
              </span>
            )}
            <span>
              <i style={{ '--c': urgent ? 'var(--danger)' : 'var(--success)' } as React.CSSProperties} />
              {urgent ? (
                <>
                  还剩 <b className="tnum">{urgent}</b> 件紧急
                </>
              ) : (
                '紧急的都处理完了'
              )}
            </span>
            {top && (
              <span>
                <i style={{ '--c': personColor(top.person) } as React.CSSProperties} />
                <button
                  type="button"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    useDeskUi.getState().set({ person: { name: top.person, left: r.left, top: r.bottom }, personLit: top.person });
                  }}
                >
                  {top.person}
                </button>
                那有 {top.items.length} 件要说
              </span>
            )}
            {plan.length > 0 && (
              <span>
                <i style={{ '--c': planLeft ? 'var(--accent)' : 'var(--success)' } as React.CSSProperties} />
                {planLeft ? (
                  <>
                    年度计划还有 <b className="tnum">{planLeft}</b> 项没打卡
                  </>
                ) : (
                  '年度计划今天都打卡了'
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="dk-h-side">
        <div className="dk-h-study">
          <StudyCard v={study} today={today} dots={false} />
        </div>
        <div className="dk-stats">
          <div className="dk-stat week" title={`本周完成 ${done} / ${total}`}>
            <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
              <circle cx="19" cy="19" r={RING_R} fill="none" stroke="var(--border-subtle)" strokeWidth="4" />
              <circle
                cx="19"
                cy="19"
                r={RING_R}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${(RING_C * pct) / 100} ${RING_C}`}
                transform="rotate(-90 19 19)"
              />
              <text x="19" y="22.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text-primary)" className="tnum">
                {pct}%
              </text>
            </svg>
            <div>
              <div className="k">本周</div>
              <div className="v tnum">
                {done}
                <small>/ {total} 件</small>
              </div>
            </div>
            <div className="dk-spark" title="每天完成数">
              {week.map((c, n) => (
                <span
                  key={n}
                  className={addDays(monday, n) === today ? 'today' : c.done ? 'on' : ''}
                  style={{ height: Math.max(3, Math.round((c.done / max) * 22)) }}
                />
              ))}
            </div>
          </div>
          {study.configured && (
            <div className="dk-stat">
              <div className="k">学习</div>
              <div className="v">
                <StudyDots v={study} />
              </div>
            </div>
          )}
          {nextMs.length > 0 && (
            <div className="dk-stat">
              <div className="k">里程碑</div>
              {nextMs.map((m) => (
                <div key={m.id} className="dk-ms" style={{ '--c': goalColor(goals[m.goalId].color) } as React.CSSProperties} title={`${goals[m.goalId].name} · ${m.date}`}>
                  <i>◆</i>
                  <span>{m.name}</span>
                  <em className="tnum">{diffDays(m.date, today)} 天</em>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
