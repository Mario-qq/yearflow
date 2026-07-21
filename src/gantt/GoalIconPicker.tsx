/**
 * 目标图标选择器：curated emoji 网格（无外部依赖）。
 * 点目标 emoji 或右键「更改图标」打开，锚在触发处；选中即存（进 undo 栈）。
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { patchGoal } from '../store/actions';
import { useGanttUi } from './uiStore';

// 覆盖学习/运动/生活/工作等常见目标域
const EMOJIS = [
  '🎯', '🧩', '📚', '📖', '✍️', '🎓', '🧠', '💡',
  '🗣️', '🌍', '🤖', '💻', '⌨️', '🔬', '🧪', '📊',
  '📈', '💰', '🏦', '📝', '🎨', '🎵', '🎸', '🎬',
  '📷', '🏀', '⚽', '🏸', '🏃', '💪', '🧘', '🚴',
  '🌱', '🍳', '☕', '✈️', '❤️', '⭐', '🔥', '🚀',
];

export function GoalIconPicker() {
  const picker = useGanttUi((s) => s.iconPicker);
  const setIconPicker = useGanttUi((s) => s.setIconPicker);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picker) return;
    const close = (e: Event) => {
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      setIconPicker(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIconPicker(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [picker, setIconPicker]);

  if (!picker) return null;
  const goal = useStore.getState().goals[picker.goalId];
  if (!goal) return null;

  const cols = 8;
  const w = cols * 30 + 12;
  const x = Math.min(picker.x, window.innerWidth - w - 8);
  const y = Math.min(picker.y, window.innerHeight - 220);

  return (
    <div
      ref={ref}
      className="fixed z-50 p-1.5"
      style={{
        left: x,
        top: y,
        width: w,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {EMOJIS.map((emoji) => {
          const active = emoji === goal.icon;
          return (
            <button
              key={emoji}
              type="button"
              className="flex cursor-pointer items-center justify-center hover:bg-subtle"
              style={{
                width: 28,
                height: 28,
                fontSize: 16,
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--accent-soft)' : 'transparent',
                outline: active ? '1px solid var(--accent)' : 'none',
              }}
              title={active ? '当前图标' : '设为图标'}
              onClick={() => {
                if (emoji !== goal.icon) patchGoal(goal.id, { icon: emoji }, `更改「${goal.name}」图标`);
                setIconPicker(null);
              }}
            >
              {emoji}
            </button>
          );
        })}
      </div>
    </div>
  );
}
