/**
 * 目标外观选择器（图标 + 颜色，无外部依赖）。
 * - 顶部色板：10 个预设色，点选即改目标色
 * - 分类 curated emoji 网格（可滚动），点选即存
 * - emoji 输入框：输入/粘贴任意 emoji（系统 emoji 键盘 Win+.），回车确认 → 覆盖无上限
 * goal.icon 只是一段 Unicode 字符串，故图标数量无技术上限。
 * 点目标 emoji 或右键「更改图标 / 颜色」打开，锚在触发处；选中进 undo 栈。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { patchGoal } from '../store/actions';
import { GOAL_PALETTE, goalColor } from '../lib/colors';
import { useGanttUi } from './uiStore';

interface Category {
  label: string;
  emojis: string[];
}

const CATEGORIES: Category[] = [
  {
    label: '学习 · 知识',
    emojis: ['🎯', '📚', '📖', '📝', '✍️', '📕', '📗', '📘', '📙', '📔', '🎓', '🧠', '💡', '🔖', '📐', '📏', '🔬', '🧪', '🧬', '🔭'],
  },
  {
    label: '语言 · 沟通',
    emojis: ['🗣️', '💬', '🗨️', '🔤', '🔡', '🌐', '🌍', '📣', '📢', '🈴'],
  },
  {
    label: '科技 · 工作',
    emojis: ['💻', '🖥️', '⌨️', '🖱️', '🤖', '📱', '💾', '🗄️', '🛠️', '⚙️', '🔧', '🧰', '📊', '📈', '📉', '💼', '🏢', '📅', '🖊️', '🧮'],
  },
  {
    label: '金融 · 理财',
    emojis: ['💰', '💵', '💴', '💶', '💷', '🪙', '💳', '🏦', '🧾', '📈'],
  },
  {
    label: '运动 · 健康',
    emojis: ['🏀', '⚽', '🏈', '⚾', '🎾', '🏐', '🏓', '🏸', '🥊', '🏋️', '🤸', '🧘', '🏃', '🚴', '🏊', '⛹️', '🚶', '🎿', '🛹', '💪'],
  },
  {
    label: '艺术 · 娱乐',
    emojis: ['🎨', '🖌️', '🖼️', '🎵', '🎶', '🎸', '🎹', '🥁', '🎺', '🎻', '🎤', '🎬', '📷', '🎥', '🎮', '🎲', '♟️', '🎭', '🃏', '🎼'],
  },
  {
    label: '生活 · 家居',
    emojis: ['🏠', '🛏️', '🧹', '🍳', '☕', '🍵', '🧺', '🪴', '🕯️', '🧸', '👕', '👟', '🛒', '💊', '🛁', '🧴'],
  },
  {
    label: '自然 · 动物',
    emojis: ['🌱', '🌿', '🍀', '🌳', '🌲', '🌸', '🌻', '🌼', '🌵', '🍄', '💧', '🌙', '☀️', '⛅', '🌈', '🐶', '🐱', '🐟', '🐦', '🦋'],
  },
  {
    label: '食物',
    emojis: ['🍎', '🍊', '🍓', '🍉', '🍇', '🥑', '🥦', '🍞', '🧀', '🍜', '🍚', '🍔', '🍕', '🍰', '🍫', '🍺'],
  },
  {
    label: '旅行 · 地点',
    emojis: ['✈️', '🚀', '🚗', '🚆', '🚲', '🏔️', '🏖️', '🗺️', '🧭', '🏕️', '⛺', '🌋', '🗽', '🎡'],
  },
  {
    label: '目标 · 符号',
    emojis: ['🏁', '🏆', '🥇', '🎖️', '🏅', '✅', '⭐', '🌟', '🔥', '🚩', '💯', '⏰', '⏳', '📆', '❤️', '🧡', '💛', '💚', '💙', '💜', '⚡', '✨', '❄️', '☘️'],
  },
];

const COLS = 8;

/** 取字符串首个字形簇（emoji 常为多码点/ZWJ 序列） */
function firstGrapheme(s: string): string {
  const t = s.trim();
  if (!t) return '';
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    for (const { segment } of new Seg(undefined, { granularity: 'grapheme' }).segment(t)) return segment;
  }
  return Array.from(t)[0] ?? '';
}

export function GoalIconPicker() {
  const picker = useGanttUi((s) => s.iconPicker);
  const setIconPicker = useGanttUi((s) => s.setIconPicker);
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    setCustom(''); // 每次打开清空输入
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

  const apply = (emoji: string) => {
    const g = firstGrapheme(emoji);
    if (g && g !== goal.icon) patchGoal(goal.id, { icon: g }, `更改「${goal.name}」图标`);
    setIconPicker(null);
  };

  const applyColor = (color: string) => {
    if (color !== goal.color) patchGoal(goal.id, { color }, `更改「${goal.name}」颜色`);
  };

  const w = COLS * 32 + 16;
  const x = Math.min(picker.x, window.innerWidth - w - 8);
  const y = Math.min(picker.y, Math.max(8, window.innerHeight - 380));

  return (
    <div
      ref={ref}
      className="fixed z-50 flex flex-col p-2"
      style={{
        left: x,
        top: y,
        width: w,
        maxHeight: 360,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {/* 颜色色板：点选即改目标色（进 undo 栈） */}
      <div className="mb-2 shrink-0">
        <div className="mb-1 px-0.5" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
          颜色
        </div>
        <div className="flex flex-wrap gap-1">
          {GOAL_PALETTE.map((c) => {
            const active = c === goal.color;
            return (
              <button
                key={c}
                type="button"
                className="cursor-pointer"
                title={active ? '当前颜色' : '设为颜色'}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: goalColor(c),
                  outline: active ? '2px solid var(--text-primary)' : '1px solid var(--border-default)',
                  outlineOffset: active ? 1 : 0,
                }}
                onClick={() => applyColor(c)}
              />
            );
          })}
        </div>
      </div>

      {/* 任意 emoji 输入（系统 emoji 键盘 Win+.） */}
      <div className="mb-2 flex shrink-0 items-center gap-1.5">
        <input
          type="text"
          value={custom}
          placeholder="输入/粘贴任意 emoji（Win + .）"
          className="min-w-0 flex-1"
          style={{
            fontSize: 'var(--font-12)',
            padding: '4px 8px',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-panel)',
            color: 'var(--text-primary)',
          }}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && firstGrapheme(custom)) apply(custom);
          }}
        />
        <button
          type="button"
          disabled={!firstGrapheme(custom)}
          className="shrink-0 cursor-pointer disabled:cursor-default"
          style={{
            fontSize: 'var(--font-12)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)',
            background: 'var(--bg-panel)',
            color: firstGrapheme(custom) ? 'var(--accent)' : 'var(--text-disabled)',
          }}
          onClick={() => firstGrapheme(custom) && apply(custom)}
        >
          使用
        </button>
      </div>

      {/* 分类网格（可滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {CATEGORIES.map((cat, ci) => (
          <div key={cat.label} className={ci > 0 ? 'mt-1.5' : ''}>
            <div
              className="mb-0.5 px-0.5"
              style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
            >
              {cat.label}
            </div>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
              {cat.emojis.map((emoji, i) => {
                const active = emoji === goal.icon;
                return (
                  <button
                    key={`${ci}-${i}-${emoji}`}
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
                    onClick={() => apply(emoji)}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
