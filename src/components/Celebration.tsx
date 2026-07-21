/**
 * 目标完成彩带（中等强度反馈）。监听 celebrate 总线，在触发点放一小簇彩带，
 * ~900ms 后自动消失。prefers-reduced-motion 时直接不渲染（尊重系统设置）。
 */
import { useEffect, useState } from 'react';
import { subscribeCelebrate, type CelebrateEvent } from '../lib/celebrate';

const COLORS = ['var(--goal-1)', 'var(--goal-2)', 'var(--goal-3)', 'var(--goal-4)', 'var(--goal-5)', 'var(--accent)'];
const PARTICLES = 16;
const LIFE_MS = 950;

interface Burst extends CelebrateEvent {
  pieces: { dx: number; dy: number; rot: number; color: string; delay: number }[];
}

function makePieces(): Burst['pieces'] {
  return Array.from({ length: PARTICLES }, (_, i) => {
    const angle = (Math.PI * 2 * i) / PARTICLES + (Math.random() - 0.5) * 0.5;
    const dist = 46 + Math.random() * 40;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 18, // 略偏上，落下更自然
      rot: (Math.random() - 0.5) * 540,
      color: COLORS[i % COLORS.length],
      delay: Math.random() * 60,
    };
  });
}

export function Celebration() {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return; // 降级：不放彩带
    return subscribeCelebrate((e) => {
      const burst: Burst = { ...e, pieces: makePieces() };
      setBursts((prev) => [...prev, burst]);
      setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== e.id)), LIFE_MS);
    });
  }, []);

  if (bursts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      <style>{`
        @keyframes yf-confetti {
          0% { opacity: 1; transform: translate(0,0) rotate(0deg) scale(1); }
          100% { opacity: 0; transform: translate(var(--dx), calc(var(--dy) + 60px)) rotate(var(--rot)) scale(0.8); }
        }
      `}</style>
      {bursts.map((b) =>
        b.pieces.map((p, i) => (
          <span
            key={`${b.id}-${i}`}
            style={{
              position: 'absolute',
              left: b.x,
              top: b.y,
              width: 7,
              height: 7,
              borderRadius: i % 3 === 0 ? '50%' : '1px',
              background: p.color,
              // @ts-expect-error CSS 自定义属性
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              animation: `yf-confetti ${LIFE_MS}ms var(--ease) ${p.delay}ms forwards`,
            }}
          />
        )),
      )}
    </div>
  );
}
