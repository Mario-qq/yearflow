/**
 * 任务详情抽屉（SPEC 4.1）：右侧 380px 滑出（200ms --dur-drawer），全字段编辑即存进 undo。
 * 打开：右键「编辑详情」/ 双击 bar；关闭：✕ / Esc。
 */
import { useEffect, useState } from 'react';
import type { Recurrence } from '../types/domain';
import { useStore } from '../store/useStore';
import { deleteTask, patchTask, removeDependency } from '../store/actions';
import { STATUS_LABEL, STATUS_ORDER } from './taskStatus';
import { goalColor } from '../lib/colors';
import { baselineDrift } from '../lib/derive';
import { useGanttUi } from './uiStore';

const DRAWER_W = 380;
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

const field: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  color: 'var(--text-primary)',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  outline: 'none',
  width: '100%',
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', marginBottom: 4 }}>{children}</div>
  );
}

export function TaskDrawer() {
  const drawerTaskId = useGanttUi((s) => s.drawerTaskId);
  const setDrawerTask = useGanttUi((s) => s.setDrawerTask);
  const task = useStore((s) => (drawerTaskId ? s.tasks[drawerTaskId] : undefined));
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  // 滑入动画：挂载后下一帧移除 translate
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!drawerTaskId) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerTaskId, setDrawerTask]);

  if (!drawerTaskId || !task || task.deletedAt) return null;
  const goal = goals[task.goalId];
  const drift = baselineDrift(task);
  const rec = task.recurrence;

  const setRecurrence = (recurrence: Recurrence | undefined, label: string) =>
    patchTask(task.id, { recurrence }, label);

  return (
    <div
      className="fixed right-0 z-40 flex flex-col"
      style={{
        top: 48,
        bottom: 0,
        width: DRAWER_W,
        background: 'var(--bg-raised)',
        borderLeft: '1px solid var(--border-default)',
        boxShadow: 'var(--shadow-lg)',
        transform: entered ? 'translateX(0)' : `translateX(${DRAWER_W}px)`,
        transition: 'transform var(--dur-drawer) var(--ease)',
      }}
    >
      {/* 头部 */}
      <div
        className="flex items-center gap-2 px-4"
        style={{ height: 44, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}
      >
        <span
          className="inline-block"
          style={{ width: 8, height: 8, borderRadius: '50%', background: goalColor(goal?.color ?? 'goal-1') }}
        />
        <span className="font-semibold" style={{ fontSize: 'var(--font-13)' }}>
          任务详情
        </span>
        <button
          type="button"
          className="ml-auto cursor-pointer hover:bg-subtle"
          style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)' }}
          onClick={() => setDrawerTask(null)}
          title="关闭（Esc）"
        >
          ✕
        </button>
      </div>

      {/* 表单 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Label>名称</Label>
          <input
            key={`name-${task.id}-${task.updatedAt}`}
            style={field}
            defaultValue={task.name}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== task.name) patchTask(task.id, { name }, `重命名任务「${name}」`);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
          />
        </div>

        <div>
          <Label>所属目标</Label>
          <select
            style={field}
            value={task.goalId}
            onChange={(e) =>
              patchTask(task.id, { goalId: e.target.value }, `移动任务「${task.name}」→「${goals[e.target.value]?.name}」`)
            }
          >
            {Object.values(goals)
              .filter((g) => !g.deletedAt && !g.archived)
              .sort((a, b) => a.order - b.order)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.icon} {g.name}
                </option>
              ))}
          </select>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <Label>开始</Label>
            <input
              type="date"
              style={field}
              className="tnum"
              value={task.startDate}
              max={task.endDate}
              onChange={(e) => {
                if (e.target.value && e.target.value <= task.endDate) {
                  patchTask(task.id, { startDate: e.target.value }, `调整任务「${task.name}」开始日`);
                }
              }}
            />
          </div>
          <div className="flex-1">
            <Label>结束</Label>
            <input
              type="date"
              style={field}
              className="tnum"
              value={task.endDate}
              min={task.startDate}
              onChange={(e) => {
                if (e.target.value && e.target.value >= task.startDate) {
                  patchTask(task.id, { endDate: e.target.value }, `调整任务「${task.name}」结束日`);
                }
              }}
            />
          </div>
        </div>

        <div>
          <Label>状态</Label>
          <div className="flex gap-1">
            {STATUS_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                className="flex-1 cursor-pointer"
                style={{
                  ...field,
                  width: undefined,
                  textAlign: 'center',
                  padding: '3px 0',
                  background: task.status === st ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                  borderColor: task.status === st ? 'var(--accent)' : 'var(--border-default)',
                  color: task.status === st ? 'var(--accent)' : 'var(--text-secondary)',
                }}
                onClick={() => patchTask(task.id, { status: st }, `任务「${task.name}」→ ${STATUS_LABEL[st]}`)}
              >
                {STATUS_LABEL[st]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>进度</Label>
          <div className="flex items-center gap-2">
            <select
              style={{ ...field, width: 96 }}
              value={task.progressMode}
              onChange={(e) =>
                patchTask(
                  task.id,
                  { progressMode: e.target.value as 'auto' | 'manual' },
                  `任务「${task.name}」进度改为${e.target.value === 'auto' ? '自动' : '手动'}`,
                )
              }
            >
              <option value="auto" disabled={rec?.type === 'adhoc'}>自动</option>
              <option value="manual">手动</option>
            </select>
            {task.progressMode === 'manual' ? (
              <>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={task.progress}
                  className="flex-1"
                  onChange={(e) => patchTask(task.id, { progress: Number(e.target.value) }, `设置进度 ${e.target.value}%`)}
                />
                <span className="tnum" style={{ fontSize: 'var(--font-12)', width: 36, textAlign: 'right' }}>
                  {task.progress}%
                </span>
              </>
            ) : (
              <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
                按已打卡 / 应打卡自动计算
              </span>
            )}
          </div>
        </div>

        <div>
          <Label>打卡规则</Label>
          <div className="flex gap-1">
            {(
              [
                ['daily', '每天'],
                ['weekdays', '工作日'],
                ['custom', '自定义'],
                ['adhoc', '随缘'],
              ] as const
            ).map(([type, label]) => {
              const active = (rec?.type ?? 'daily') === type; // 无 recurrence 默认 daily（与派生口径一致）
              return (
                <button
                  key={type}
                  type="button"
                  className="flex-1 cursor-pointer"
                  style={{
                    ...field,
                    width: undefined,
                    textAlign: 'center',
                    padding: '3px 0',
                    background: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                    borderColor: active ? 'var(--accent)' : 'var(--border-default)',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                  onClick={() => {
                    if (type === 'adhoc') {
                      // 随缘只能手动进度：切换时顺带把 auto 归位为 manual（自动进度分母为 0）
                      patchTask(
                        task.id,
                        { recurrence: { type: 'adhoc' }, progressMode: 'manual' },
                        `修改「${task.name}」打卡规则`,
                      );
                      return;
                    }
                    setRecurrence(
                      type === 'daily' ? { type: 'daily' } : type === 'weekdays' ? { type: 'weekdays' } : { type: 'custom', daysOfWeek: rec?.daysOfWeek ?? [1, 3, 5] },
                      `修改「${task.name}」打卡规则`,
                    );
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {rec?.type === 'adhoc' && (
            <div className="mt-1.5" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              不排期：不进每日「待打卡」、不算缺卡、不断 streak。想记录时在打卡页底部「不定期」区随手补一次。
            </div>
          )}
          {rec?.type === 'custom' && (
            <div className="mt-1.5 flex gap-1">
              {WEEKDAY_ZH.map((w, dow) => {
                const on = rec.daysOfWeek?.includes(dow) ?? false;
                return (
                  <button
                    key={dow}
                    type="button"
                    className="flex-1 cursor-pointer tnum"
                    style={{
                      ...field,
                      width: undefined,
                      textAlign: 'center',
                      padding: '3px 0',
                      background: on ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      borderColor: on ? 'var(--accent)' : 'var(--border-default)',
                      color: on ? 'var(--accent)' : 'var(--text-tertiary)',
                    }}
                    onClick={() => {
                      const days = rec.daysOfWeek ?? [];
                      const next = on ? days.filter((d) => d !== dow) : [...days, dow].sort();
                      setRecurrence({ type: 'custom', daysOfWeek: next }, `修改「${task.name}」打卡规则`);
                    }}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          )}
          {/* 番茄钟任务选择器默认列出「今日在办」，杂事太多时列表会长得没法用。
              标了这个只影响那张列表的默认可见性，不影响打卡、统计与任何派生口径 */}
          <button
            type="button"
            className="mt-2 flex cursor-pointer items-center gap-1.5"
            style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
            onClick={() =>
              patchTask(
                task.id,
                { noFocus: task.noFocus ? undefined : true },
                task.noFocus ? `「${task.name}」恢复列入专注` : `「${task.name}」不再列入专注`,
              )
            }
          >
            <span style={{ color: task.noFocus ? 'var(--accent)' : 'var(--text-tertiary)' }}>
              {task.noFocus ? '☑' : '☐'}
            </span>
            不需要专注计时（番茄钟选择器里默认不列出）
          </button>
        </div>

        <div>
          <Label>前置依赖</Label>
          {task.dependsOn?.length ? (
            <div className="flex flex-col gap-1">
              {task.dependsOn.map((pid) => {
                const pred = tasks[pid];
                if (!pred || pred.deletedAt) return null;
                return (
                  <div
                    key={pid}
                    className="flex items-center gap-2"
                    style={{ ...field, display: 'flex', background: 'var(--bg-subtle)' }}
                  >
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {pred.name}
                    </span>
                    <span className="tnum" style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-11)' }}>
                      {pred.endDate}
                    </span>
                    <button
                      type="button"
                      className="cursor-pointer"
                      style={{ color: 'var(--text-tertiary)' }}
                      title="删除依赖"
                      onClick={() => removeDependency(task.id, pid)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
              无。hover bar 两端圆点可拖出依赖连线。
            </div>
          )}
        </div>

        <div>
          <Label>基线</Label>
          {task.baseline ? (
            <div className="flex items-center gap-2" style={{ fontSize: 'var(--font-12)' }}>
              <span className="tnum" style={{ color: 'var(--text-secondary)' }}>
                {task.baseline.startDate} ~ {task.baseline.endDate}
              </span>
              {drift && drift.endDriftDays !== 0 && (
                <span className="tnum" style={{ color: drift.endDriftDays > 0 ? 'var(--warning)' : 'var(--success)' }}>
                  偏移 {drift.endDriftDays > 0 ? '+' : ''}
                  {drift.endDriftDays} 天
                </span>
              )}
              <button
                type="button"
                className="ml-auto cursor-pointer"
                style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
                onClick={() => patchTask(task.id, { baseline: undefined }, `清除基线「${task.name}」`)}
              >
                清除
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
              未保存基线。右键 bar →「保存为基线」。
            </div>
          )}
        </div>

        <div>
          <Label>备注（Markdown）</Label>
          <textarea
            key={`note-${task.id}`}
            style={{ ...field, minHeight: 88, resize: 'vertical', fontFamily: 'inherit' }}
            defaultValue={task.note ?? ''}
            placeholder="补充说明…"
            onBlur={(e) => {
              const note = e.target.value;
              if (note !== (task.note ?? '')) patchTask(task.id, { note: note || undefined }, `更新「${task.name}」备注`);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {/* 底部危险区 */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <button
          type="button"
          className="w-full cursor-pointer"
          style={{ ...field, textAlign: 'center', color: 'var(--danger)', background: 'transparent' }}
          onClick={() => {
            if (!confirm(`删除任务「${task.name}」？其打卡记录将一并删除。`)) return;
            setDrawerTask(null);
            deleteTask(task.id);
          }}
        >
          删除任务…
        </button>
      </div>
    </div>
  );
}
