import { useStore } from '../store/useStore';
import { goalColor } from '../lib/colors';

/** Phase 2 实现完整甘特图；当前为数据概览占位 */
export default function GanttPage() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const milestones = useStore((s) => s.milestones);

  const goalList = Object.values(goals)
    .filter((g) => !g.archived)
    .sort((a, b) => a.order - b.order);

  if (goalList.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p style={{ fontSize: 'var(--font-16)' }}>还没有目标</p>
        <p style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
          到「设置」页载入示例数据，或等 Phase 2/3 在此直接创建
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 font-semibold" style={{ fontSize: 'var(--font-20)' }}>
        甘特图
      </h1>
      <p className="mb-5" style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
        Phase 2 将在此渲染全年时间轴。当前为数据概览。
      </p>
      <div className="flex flex-col gap-2">
        {goalList.map((g) => {
          const goalTasks = Object.values(tasks)
            .filter((t) => t.goalId === g.id)
            .sort((a, b) => a.order - b.order);
          const goalMs = Object.values(milestones).filter((m) => m.goalId === g.id);
          return (
            <div
              key={g.id}
              className="flex items-center gap-3 border p-3"
              style={{
                borderColor: 'var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-panel)',
                borderLeft: `3px solid ${goalColor(g.color)}`,
              }}
            >
              <span style={{ fontSize: 'var(--font-16)' }}>{g.icon}</span>
              <span className="font-medium">{g.name}</span>
              <span
                className="tnum ml-auto"
                style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
              >
                {goalTasks.length} 个任务
                {goalMs.length > 0 && ` · ${goalMs.length} 个里程碑`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
