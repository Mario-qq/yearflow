/**
 * 学习卡（DESK_SPEC §五 六层防忘）：今天这张日卡的第一块。
 * 没学 = 醒目大卡（锚点句 · 学什么 · 为什么是它 · 一键开始 / 短版 / 换一个），主色描边轻呼吸；
 * 正在学 = 倒计时（经 1s 单例 ticker 直写 DOM，零 React 重渲）+ 结束并打卡 / 暂停 / 放弃；
 * 学过了 = 收成一行；今天没排学习 = 一行安静的「想学也可以」。
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { goalColor } from '../lib/colors';
import { untouchedDays } from '../lib/derive/study';
import { pauseFocus, resumeFocus } from '../pomodoro/kernel';
import { subscribeTick } from '../pomodoro/ticker';
import { mmss } from '../pomodoro/format';
import { abandonStudy, finishStudy, markStudied, startStudy, swapStudyPick, type StudyView } from './study';
import { useDeskUi } from './uiStore';

function openSetup(e: React.MouseEvent) {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  useDeskUi.getState().set({ studySetup: { left: r.left, top: r.bottom }, menu: null });
}

export function StudyDots({ v }: { v: StudyView }) {
  const n = v.prefs.weekTarget;
  return (
    <span className="dk-dots" title={`本周目标 ${n} 天，已学 ${v.weekDays} 天（周末可补）`}>
      {Array.from({ length: n }, (_, i) => (
        <b key={i} className={i < v.weekDays ? 'on' : ''} />
      ))}
      <span className="tnum">
        {v.weekDays}/{n} 天
      </span>
    </span>
  );
}

function Countdown() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      subscribeTick((ms) => {
        if (ref.current) ref.current.textContent = mmss(ms);
      }),
    [],
  );
  return <div ref={ref} className="dk-st-timer tnum" />;
}

export function StudyCard({ v, today }: { v: StudyView; today: string }) {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);

  if (!v.configured) {
    return (
      <button type="button" className="dk-st-line setup" onClick={openSetup}>
        <span className="dk-st-ic">✎</span>
        <span className="dk-st-txt">选哪些目标算「学习」，这里每天提醒你学</span>
        <span className="dk-grow" />
        设置 ›
      </button>
    );
  }

  if (v.running) {
    const r = v.running;
    const g = r.goalId ? goals[r.goalId] : undefined;
    const t = r.taskId ? tasks[r.taskId] : undefined;
    return (
      <div className="dk-study running" style={{ '--c': goalColor(g?.color ?? 'goal-1') } as React.CSSProperties}>
        <div className="dk-st-top">
          <span>
            {r.paused ? '暂停中' : '专注中'} · {g?.name}
            {t ? ` · ${t.name}` : ''}
          </span>
          <span className="dk-grow" />
          <StudyDots v={v} />
        </div>
        <Countdown />
        <div className="dk-st-acts">
          <button type="button" className="dk-btn primary" onClick={() => finishStudy(r, today)}>
            结束并打卡
          </button>
          <button type="button" className="dk-btn" onClick={() => (r.paused ? resumeFocus() : pauseFocus())}>
            {r.paused ? '继续' : '暂停'}
          </button>
          <button type="button" className="dk-btn ghost" onClick={abandonStudy} title="不记录这一段">
            放弃
          </button>
        </div>
      </div>
    );
  }

  if (v.studied) {
    return (
      <div className="dk-st-line done">
        <span className="dk-st-ok" aria-hidden />
        <span className="dk-st-txt tnum" title={`今天学过了${v.minutes > 0 ? ` · ${v.minutes} 分钟` : ''}${v.streak >= 2 ? ` · 连学 ${v.streak} 天` : ''}`}>
          今天学过了
          {v.minutes > 0 && ` · ${v.minutes} 分钟`}
          {v.streak >= 2 && <span className="dk-st-sub"> · 连学 {v.streak} 天</span>}
        </span>
        <span className="dk-grow" />
        {v.pick && (
          <button type="button" className="dk-play" onClick={() => startStudy(today)} title={`再学 ${v.prefs.studyMinutes} 分钟`}>
            ▶ 再学一段
          </button>
        )}
        <StudyDots v={v} />
      </div>
    );
  }

  const p = v.pick;
  if (!p) return null;
  const g = goals[p.goalId];
  const color = goalColor(g?.color ?? 'goal-1');

  if (!v.dueToday) {
    return (
      <div className="dk-st-line">
        <span className="dk-st-ic">◎</span>
        <span className="dk-st-txt">今天没排学习</span>
        <span className="dk-grow" />
        <button type="button" className="dk-play show" onClick={() => startStudy(today)} title={`${g?.name} · ${p.taskName}`}>
          ▶ 想学就学 {v.prefs.studyMinutes} 分钟
        </button>
        <StudyDots v={v} />
      </div>
    );
  }

  const why: React.ReactNode[] = [];
  if (v.broke) why.push(<b key="broke">昨天断了一天，今天别连断</b>);
  else if (v.streak >= 2) why.push(<span key="streak">已连学 {v.streak} 天，接着来</span>);
  if (p.behind >= 5) why.push(<span key="behind">落后计划 {p.behind}%</span>);
  else {
    const n = untouchedDays(p, today);
    if (n === null) why.push(<span key="new">还没开始过</span>);
    else if (n >= 3) why.push(<span key="idle">{n} 天没碰了</span>);
  }
  const anchor = v.anchor.time ? `${v.anchor.text ? `${v.anchor.text} ` : ''}${v.anchor.time}` : null;

  return (
    <div className="dk-study" style={{ '--c': color } as React.CSSProperties}>
      <div className="dk-st-top">
        {anchor ? (
          <span>
            {anchor} · 学 {v.prefs.studyMinutes} 分钟
          </span>
        ) : (
          <button type="button" className="dk-st-link" onClick={openSetup}>
            还没定固定学习时间 · 设一个
          </button>
        )}
        <span className="dk-grow" />
        <StudyDots v={v} />
        <button type="button" className="dk-st-gear" title="学习设置" aria-label="学习设置" onClick={openSetup}>
          ⚙
        </button>
      </div>
      <div className="dk-st-what">
        {g?.name} · {p.taskName}
      </div>
      {why.length > 0 && <div className="dk-st-why">{why.flatMap((w, i) => (i ? [' · ', w] : [w]))}</div>}
      <div className="dk-st-acts">
        <button type="button" className="dk-btn primary" title="快捷键 S" onClick={() => startStudy(today, 'full', p)}>
          ▶ 开始 {v.prefs.studyMinutes} 分钟
        </button>
        <button type="button" className="dk-btn" title={`只有 ${v.prefs.shortMinutes} 分钟也算`} onClick={() => startStudy(today, 'short', p)}>
          {v.prefs.shortMinutes} 分钟版
        </button>
        {v.picks.length > 1 && (
          <button type="button" className="dk-btn ghost" title="换一个学习任务" onClick={swapStudyPick}>
            换一个
          </button>
        )}
        <span className="dk-grow" />
        <button type="button" className="dk-btn ghost" title="在别处学过了：直接打卡完成" onClick={() => markStudied(p, today)}>
          已学过
        </button>
      </div>
    </div>
  );
}
