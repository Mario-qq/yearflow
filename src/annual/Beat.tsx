/**
 * 叙事 beat 的外壳与共享零件（规格 §4.3：一屏一 beat = 巨号数字 + 一句结论 + 一张图）。
 *
 * 「是否已揭示」由 Beat 通过 context 下发，HeroNumber 据此决定何时启动数字滚动 ——
 * 否则视口外的 beat 会在挂载瞬间把数字滚完，滚到时只剩静止的终值。
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion, tween } from '../gantt/lib/tween';
import { useIsMobile } from '../lib/useIsMobile';
import {
  COUNT_DUR_MS,
  MOBILE_CHART_W,
  REVEAL_ROOT_MARGIN,
  REVEAL_THRESHOLD,
} from './constants';

const ShownContext = createContext(true);

/** 进入视口一次性揭示。reduced-motion 直接返回已揭示（规格 §4.3） */
function useReveal(): { ref: React.RefObject<HTMLElement>; shown: boolean } {
  const [shown, setShown] = useState(() => prefersReducedMotion());
  // 用 ref 对象而非 ref 回调：内联回调每次渲染都换身份 ⇒ React 会 detach/attach 一轮，
  // 若在回调里 setState 就是无限更新循环（实测踩到过）。effect 在挂载后跑，节点必然已就位。
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: REVEAL_ROOT_MARGIN, threshold: REVEAL_THRESHOLD },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  return { ref, shown };
}

export interface BeatProps {
  /** beat 序号，渲染成左上角的 `01` 标记 */
  index: number;
  /** 分类小标题，如「投入」 */
  eyebrow: string;
  /** 一句话结论。允许直白，不许说教（规格 §4.3） */
  title: ReactNode;
  /** 右上角动作区，通常是 [看一眼] */
  action?: ReactNode;
  /** 图下方的灰字脚注：口径说明与「未计入」披露 */
  footnote?: ReactNode;
  children: ReactNode;
}

export function Beat({ index, eyebrow, title, action, footnote, children }: BeatProps) {
  const { ref, shown } = useReveal();
  return (
    <ShownContext.Provider value={shown}>
      <section
        ref={ref}
        className={`annual-beat flex flex-col gap-4 border p-6 max-md:p-4${shown ? ' is-shown' : ''}`}
        style={{
          borderColor: 'var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-raised)',
        }}
      >
        {/*
          序号与 eyebrow 同处第一行、标题独占第二行：序号若像原来那样在流里占一列，
          标题就会被推进 ~24px，而 hero 数字和图都从卡片内边距起画 ⇒ 卡片内出现两条
          左边缘。叙事长图整页只该有一条。
        */}
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <span
              className="tnum shrink-0"
              style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
            >
              {String(index).padStart(2, '0')}
            </span>
            <span
              className="min-w-0 truncate"
              style={{
                fontSize: 'var(--font-11)',
                color: 'var(--text-tertiary)',
                letterSpacing: '0.08em',
              }}
            >
              {eyebrow}
            </span>
            {action && <div className="ml-auto shrink-0">{action}</div>}
          </div>
          <h2 style={{ fontSize: 'var(--font-20)', fontWeight: 500, lineHeight: 1.45 }}>{title}</h2>
        </header>
        {children}
        {footnote && (
          <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>{footnote}</p>
        )}
      </section>
    </ShownContext.Provider>
  );
}

/** 巨号 hero 数字：揭示时从 0 滚到终值（tween 已内建 reduced-motion / 后台直出终值） */
export function HeroNumber({
  value,
  format,
  unit,
  sub,
}: {
  value: number;
  /** 把补间中的浮点值格式化成展示文本（取整只在这一层发生） */
  format: (n: number) => string;
  unit?: string;
  /** hero 右侧或下方的补充说明 */
  sub?: ReactNode;
}) {
  const shown = useContext(ShownContext);
  const [n, setN] = useState(() => (prefersReducedMotion() ? value : 0));
  const cur = useRef(prefersReducedMotion() ? value : 0);

  useEffect(() => {
    if (!shown) return;
    return tween({
      from: cur.current,
      to: value,
      duration: COUNT_DUR_MS,
      onUpdate: (v) => {
        cur.current = v;
        setN(v);
      },
    });
  }, [shown, value]);

  return (
    <div>
      <div className="flex items-baseline gap-2">
        {/*
          字号走 .annual-hero 而不是内联 style：移动端要降到 --font-32（规格 §5.3），
          内联 style 只能被 !important 盖过，把降档规则留在 CSS 里更干净。
        */}
        <span className="annual-hero tnum" style={{ fontWeight: 600, lineHeight: 1.05 }}>
          {format(n)}
        </span>
        {unit && (
          <span style={{ fontSize: 'var(--font-16)', color: 'var(--text-tertiary)' }}>{unit}</span>
        )}
      </div>
      {sub && (
        <div className="mt-1" style={{ fontSize: 'var(--font-13)', color: 'var(--text-secondary)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * 图表容器：自绘 SVG 统一用固定 viewBox + 宽度 100%，等比缩放（不引任何图表库）。
 *
 * 移动端（规格 §5.3「可进可读」）：等比缩到 343px 屏宽时，`--font-11` 的轴标签只剩
 * 4.6px —— 图还在，但读不了。所以窄屏改成「SVG 保持 MOBILE_CHART_W、外层横向滚动」，
 * 与宽表格的通行做法一致。桌面与导出路径（离屏舞台固定 900px）完全不受影响。
 */
export function ChartBox({
  width,
  height,
  label,
  children,
}: {
  width: number;
  height: number;
  /** 无障碍标题，同时也是 SVG 的 aria-label */
  label: string;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const svg = (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={isMobile ? MOBILE_CHART_W : '100%'}
      height={isMobile ? (height / width) * MOBILE_CHART_W : undefined}
      role="img"
      aria-label={label}
      style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}
    >
      {children}
    </svg>
  );
  if (!isMobile) return svg;
  return (
    <div className="annual-chart-scroll flex overflow-x-auto" style={{ paddingBottom: 2 }}>
      {svg}
    </div>
  );
}

/**
 * 回流甘特图按钮（规格 §4.4）。低调、不抢结论的视觉重量。
 * `data-annual-noprint`：纸上与长图里点不了，打印 CSS 与 exportLong 都按这个属性摘掉。
 */
export function LookButton({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-annual-noprint
      className="cursor-pointer px-2 py-1 whitespace-nowrap"
      title={title ?? '在甘特图上定位'}
      style={{
        fontSize: 'var(--font-12)',
        color: 'var(--accent)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-panel)',
      }}
    >
      看一眼
    </button>
  );
}
