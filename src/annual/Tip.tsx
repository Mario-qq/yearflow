/**
 * 全页共用一个悬浮提示：图上的元素只挂 `data-tip="第一行\n第二行"`，这里在根节点上
 * 做事件委托。状态只在本组件里，指针移动不会让整页重渲染。
 * 触屏下 pointerdown 同样触发（轻点格子即看数字），点空白处收起。
 */
import { useEffect, useState } from 'react';

interface TipState {
  text: string;
  x: number;
  y: number;
}

export function Tip({ root }: { root: React.RefObject<HTMLElement> }) {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const show = (e: PointerEvent): void => {
      const hit = (e.target as Element | null)?.closest?.('[data-tip]');
      const text = hit?.getAttribute('data-tip');
      if (!text) {
        setTip(null);
        return;
      }
      setTip((prev) =>
        prev && prev.text === text && prev.x === e.clientX && prev.y === e.clientY
          ? prev
          : { text, x: e.clientX, y: e.clientY },
      );
    };
    const hide = (): void => setTip(null);
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      el.removeEventListener('pointermove', show);
      el.removeEventListener('pointerdown', show);
      el.removeEventListener('pointerleave', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [root]);

  if (!tip) return null;
  // 靠右半屏时翻到指针左侧，避免出界
  const flip = tip.x > window.innerWidth / 2;
  return (
    <div
      className="yr-tip tnum"
      role="tooltip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, calc(-100% - 10px))`,
      }}
    >
      {tip.text}
    </div>
  );
}
