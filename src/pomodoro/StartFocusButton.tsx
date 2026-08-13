/**
 * 打卡页的番茄启动入口（规格 §8.4）：一枚 ▶ 小按钮，点击 = 以该任务开始一段专注。
 *
 * 为什么放在任务行而不是目标卡头：这是 (goalId, taskId, date) 三元键**唯一齐备**的层，
 * 目标级卡头在多任务目标下拿不到 taskId，与「按任务统计真实投入」直接相悖。
 *
 * ⚠️ 只渲染按钮，绝不把计时器主体放进打卡卡片：useFlip 会对卡片子树做 WAAPI translate，
 * 运行中的计时器会随卡片被平移动画拖着漂（这也是主形态选顶栏胶囊的又一个理由）。
 * ⚠️ 仅当所看日期 = 今天时由调用方渲染（补卡历史日期不该启动计时器）。
 */
import { useIsMobile } from '../lib/useIsMobile';
import { startPomodoro } from './api';
import { usePomodoroStore } from './store';

export function StartFocusButton({ goalId, taskId }: { goalId: string; taskId: string }) {
  const isMobile = useIsMobile();
  const running = usePomodoroStore((s) => s.running);
  if (isMobile) return null; // 移动端不渲染任何番茄入口（v1 纯桌面）

  const active = running?.phase === 'focus' && running.taskId === taskId;
  return (
    <button
      type="button"
      onClick={() => {
        if (!active) startPomodoro({ goalId, taskId });
      }}
      className="shrink-0 cursor-pointer px-1 opacity-60 transition-opacity hover:opacity-100 max-md:hidden"
      style={{ fontSize: 'var(--font-12)', color: active ? 'var(--accent)' : 'var(--text-tertiary)', opacity: active ? 1 : undefined }}
      title={active ? '正在为该任务计时（顶栏胶囊可暂停/停止）' : '为该任务开始一段专注'}
      aria-label={active ? '正在计时' : '开始专注'}
    >
      {active ? '🍅' : '▶'}
    </button>
  );
}
