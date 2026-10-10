/** 年报各节共用的小件：节外壳、目标色点、目标名 */
import type { ReactNode } from 'react';
import type { Goal } from '../types/domain';
import { goalColor } from '../lib/colors';
import { useInView } from './hooks';

export type GoalMap = Map<string, Goal>;

/**
 * 一节 = 编号眉题 + 一句话标题 + 副句 + 图。children 是函数时把 inView 交给它，
 * 让图在入场那一刻再开始生长 / 数字滚动。
 */
export function Section({
  no,
  eyebrow,
  title,
  sub,
  children,
  id,
}: {
  no: string;
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode | ((inView: boolean) => ReactNode);
  id?: string;
}) {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section ref={ref} id={id} className={`yr-panel yr-sec${inView ? ' is-in' : ''}`}>
      <header className="yr-sec-head">
        <p className="yr-eyebrow">
          <span className="yr-eyebrow-no tnum">{no}</span>
          {eyebrow}
        </p>
        <h2 className="yr-title">{title}</h2>
        {sub && <p className="yr-sub">{sub}</p>}
      </header>
      {typeof children === 'function' ? children(inView) : children}
    </section>
  );
}

export function GoalDot({ goal, size = 8 }: { goal?: Goal; size?: number }) {
  return (
    <span
      aria-hidden
      className="yr-dot"
      style={{ width: size, height: size, background: goal ? goalColor(goal.color) : 'var(--text-disabled)' }}
    />
  );
}

/** 标题句里的目标名：色点 + 粗体名字（文字本身用文字色，颜色只在点上） */
export function GoalName({ goal }: { goal?: Goal }) {
  return (
    <span className="yr-goal-name">
      <GoalDot goal={goal} size={10} />
      <b>{goal?.name ?? '已删除的目标'}</b>
    </span>
  );
}

/** 标题句里被强调的数字 */
export function Em({ children }: { children: ReactNode }) {
  return <b className="yr-em tnum">{children}</b>;
}
