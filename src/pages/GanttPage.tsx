import { useStore } from '../store/useStore';
import GanttView from '../gantt/GanttView';

export default function GanttPage() {
  const goals = useStore((s) => s.goals);
  const hasGoals = Object.values(goals).some((g) => !g.archived && !g.deletedAt);

  if (!hasGoals) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p style={{ fontSize: 'var(--font-16)' }}>还没有目标</p>
        <p style={{ fontSize: 'var(--font-13)', color: 'var(--text-tertiary)' }}>
          到「设置」页载入示例数据，或等 Phase 3 在此直接创建
        </p>
      </div>
    );
  }

  return <GanttView />;
}
