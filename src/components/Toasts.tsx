/** 左下角 toast 堆叠（SPEC 第六节：每次 undo 显示被撤销内容摘要） */
import { useEffect, useState } from 'react';
import { subscribeToasts, type ToastItem } from '../lib/toast';

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={t.action ? 'glass-float float-in pointer-events-auto flex items-center gap-3' : 'glass-float float-in'}
          style={{
            padding: '6px 12px',
            fontSize: 'var(--font-12)',
            color: 'var(--text-primary)',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            maxWidth: 320,
          }}
        >
          {t.text}
          {t.action && (
            <button
              type="button"
              onClick={t.action.run}
              className="cursor-pointer"
              style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 'var(--font-12)' }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
