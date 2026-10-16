/**
 * 今天的「年度计划」分区：甘特图当天应打卡的任务（复用 derive/dayPanel.dayEntries，零新数据）。
 * 勾选 = 打卡「完成」，结果直接回写甘特点阵；▶ 专注 = 起番茄钟并绑定这个任务（结束自动打卡，复用结果卡）。
 * 免打卡区间内的目标不出现（那天本来就不用做）。
 */
import { removeCheckIn, setCheckIn } from '../store/actions';
import { startPomodoro } from '../pomodoro/api';
import type { PlanRowData } from './usePlanRows';
import { useDeskUi } from './uiStore';

export function PlanRows({ rows, today }: { rows: PlanRowData[]; today: string }) {
  const personLit = useDeskUi((s) => s.personLit);
  return (
    <>
      {rows.map((p) => {
        const done = p.status === 'done' || p.status === 'skipped';
        return (
          <div
            key={`${p.goalId}:${p.taskId}`}
            className={['dk-row plan', done ? 'done' : '', personLit ? 'dim' : ''].join(' ')}
            style={{ '--c': p.color } as React.CSSProperties}
            title={`来自甘特图：${p.goalName} · ${p.taskName}`}
          >
            <button
              type="button"
              className="dk-chk"
              aria-label={done ? '取消打卡' : '打卡完成'}
              onClick={() => {
                if (p.status === 'done' && p.recordId) removeCheckIn(p.recordId);
                else setCheckIn({ goalId: p.goalId, taskId: p.taskId, date: today, status: 'done' });
              }}
            />
            <span className="dk-t">
              {p.goalName} · {p.taskName}
            </span>
            <span className="dk-m">
              {p.status === 'partial' && <span>做了一点</span>}
              {p.status === 'skipped' && <span>跳过</span>}
              {!done && (
                <button type="button" className="dk-play" onClick={() => startPomodoro({ goalId: p.goalId, taskId: p.taskId })}>
                  ▶ 专注
                </button>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}
