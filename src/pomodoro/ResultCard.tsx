/**
 * 结算结果卡（规格 §8.3）：一段专注结束后出现在面板内，不弹窗打扰。
 *
 * 四个必须有的东西：
 * · `[✓ 记为完成]` —— 与打卡体系**唯一的连接点**，是一条独立的 undo 命令
 *   （绝不自动写打卡：整行 LWW 下累加不安全，且 undo 会连带回滚用户手改的状态/备注）；
 * · **明示「计入 X 月 X 日」** —— 跨天会话（23:50 开始整段归开始日）的逃生阀，可一键改归相邻日；
 * · `needsReview` 徽标 + 一行说明；
 * · 徽标的**清除路径 `[知道了]`** —— 用户认可现状什么都不想改时，徽标必须能消掉，
 *   否则「待确认」会沦为常态噪音。
 */
import { useState } from 'react';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import {
  deleteFocusSession,
  reassignFocusSession,
  setCheckIn,
  updateFocusSession,
} from '../store/actions';
import { toDay, fmtDay } from '../lib/date';
import { humanMs } from './format';
import { usePomodoroStore } from './store';
import { TaskPicker } from './TaskPicker';
import { useSelLabel, type FocusSel } from './useSelLabel';

const btn: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '3px 8px',
  cursor: 'pointer',
};

export function ResultCard({ sessionId }: { sessionId: string }) {
  const session = useStore((s) => s.focusSessions[sessionId]);
  /**
   * 「已完成 ✓」必须订阅到打卡记录本身（选择器返回 boolean ⇒ 打卡/取消后立刻回显）。
   * 不能只订阅 checkIns 的条数：把已有的「做了一点」改成「完成」走的是原位更新，条数不变。
   */
  const checked = useStore((s) => {
    const f = s.focusSessions[sessionId];
    if (!f?.goalId) return false;
    return Object.values(s.checkIns).some(
      (c) =>
        !c.deletedAt &&
        c.goalId === f.goalId &&
        c.date === f.date &&
        (c.taskId ?? undefined) === (f.taskId ?? undefined) &&
        c.status === 'done',
    );
  });
  const [editing, setEditing] = useState<'none' | 'owner' | 'date'>('none');

  const sel: FocusSel = { goalId: session?.goalId, taskId: session?.taskId };
  const label = useSelLabel(sel);
  const dismiss = () => usePomodoroStore.setState({ lastResult: null });

  if (!session || session.deletedAt) return null;

  const shiftDate = (days: number) => {
    updateFocusSession(session.id, { date: fmtDay(toDay(session.date).add(days, 'day')) });
  };

  return (
    <div
      className="flex flex-col gap-1.5 border p-2.5"
      style={{
        borderColor: 'var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-subtle)',
      }}
    >
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 'var(--font-13)', color: 'var(--success)' }}>
          已记录专注 <span className="tnum">{humanMs(session.focusMs)}</span>
        </span>
        {session.needsReview && (
          <span
            style={{
              fontSize: 'var(--font-11)',
              color: 'var(--warning)',
              border: '1px solid var(--warning)',
              borderRadius: 999,
              padding: '0 6px',
            }}
          >
            待确认
          </span>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="ml-auto cursor-pointer"
          style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
          title="收起这张卡"
        >
          ✕
        </button>
      </div>

      {session.needsReview && (
        <p style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
          期间页面未在前台或系统时钟有跳变，已按计划终点结算。可改归属/删除，或点「知道了」。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-1.5" style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
        <button
          type="button"
          onClick={() => setEditing((v) => (v === 'date' ? 'none' : 'date'))}
          className="tnum cursor-pointer underline decoration-dotted underline-offset-2"
          title="改归相邻日"
        >
          计入 {dayjs(session.date).format('M月D日')}
        </button>
        <span style={{ color: 'var(--text-tertiary)' }}>·</span>
        <span className="truncate">{label.text}</span>
      </div>

      {editing === 'date' && (
        <div className="flex gap-1.5">
          <button type="button" style={btn} onClick={() => shiftDate(-1)}>
            ‹ 前一天
          </button>
          <button type="button" style={btn} onClick={() => shiftDate(1)}>
            后一天 ›
          </button>
        </div>
      )}

      {editing === 'owner' && (
        <TaskPicker
          value={sel}
          onPick={(next) => {
            reassignFocusSession(session.id, next);
            setEditing('none');
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={checked || session.goalId === undefined}
          onClick={() => {
            if (session.goalId === undefined) return;
            setCheckIn({
              goalId: session.goalId,
              date: session.date,
              status: 'done',
              taskId: session.taskId,
            });
          }}
          style={{
            ...btn,
            color: checked ? 'var(--success)' : 'var(--text-secondary)',
            borderColor: checked ? 'var(--success)' : 'var(--border-default)',
            cursor: checked || session.goalId === undefined ? 'default' : 'pointer',
            opacity: session.goalId === undefined ? 0.5 : 1,
          }}
          title={session.goalId === undefined ? '先归类到任务才能记为完成' : '为该任务当日打一次「完成」卡'}
        >
          {checked ? '已完成 ✓' : '✓ 记为完成'}
        </button>
        <button type="button" style={btn} onClick={() => setEditing((v) => (v === 'owner' ? 'none' : 'owner'))}>
          改归属
        </button>
        {session.needsReview && (
          <button
            type="button"
            style={btn}
            onClick={() => updateFocusSession(session.id, { needsReview: false })}
            title="认可这段记录，清掉待确认徽标"
          >
            知道了
          </button>
        )}
        <button
          type="button"
          style={{ ...btn, color: 'var(--danger)', border: 'none', background: 'transparent' }}
          onClick={() => {
            deleteFocusSession(session.id);
            dismiss();
          }}
        >
          删除
        </button>
      </div>
    </div>
  );
}
