/**
 * 学习设置：哪些目标算学习、学多久、周目标、固定时间（锚点句，可按星期分别设）、最晚提醒。
 * 学习卡右上角 ⚙ 弹出（StudySetupPop），设置页「学习提醒」一节也嵌同一张表（StudySetupForm）。
 * 改动即时生效（updateSettings 防抖落库）；设置只存本机，不同步（DESK_SPEC §七）。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { StudyAnchor } from '../types/domain';
import { useStore } from '../store/useStore';
import { goalColor } from '../lib/colors';
import { isDesktop } from '../lib/desktop';
import { patchDeskPrefs, useDeskPrefs } from './study';
import { useDeskUi } from './uiStore';

/** 设置表里按周一到周日排（下标仍是 0=周日） */
const DOW_ROWS: [number, string][] = [
  [1, '周一'],
  [2, '周二'],
  [3, '周三'],
  [4, '周四'],
  [5, '周五'],
  [6, '周六'],
  [0, '周日'],
];

function clampInt(v: string, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** 数字框：失焦才落库并夹紧（打字过程中不打断） */
function NumField({ value, lo, hi, onSet, label }: { value: number; lo: number; hi: number; onSet: (n: number) => void; label: string }) {
  return (
    <input
      key={value}
      type="number"
      className="dk-in num tnum"
      aria-label={label}
      min={lo}
      max={hi}
      defaultValue={value}
      onBlur={(e) => {
        const n = clampInt(e.currentTarget.value, lo, hi, value);
        e.currentTarget.value = String(n);
        if (n !== value) onSet(n);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

/** 文本/时间框：失焦落库（空 = 清除） */
function TextField({ value, onSet, type = 'text', placeholder, label, wide }: { value?: string; onSet: (v: string | undefined) => void; type?: 'text' | 'time'; placeholder?: string; label: string; wide?: boolean }) {
  return (
    <input
      key={value ?? ''}
      type={type}
      className={`dk-in${wide ? ' wide' : ''}${type === 'time' ? ' tnum' : ''}`}
      aria-label={label}
      placeholder={placeholder}
      maxLength={type === 'text' ? 40 : undefined}
      defaultValue={value ?? ''}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim() || undefined;
        if (v !== value) onSet(v);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export function StudySetupForm() {
  const prefs = useDeskPrefs();
  const goals = useStore((s) => s.goals);
  const [byDow, setByDow] = useState(() => prefs.anchorByDow.some(Boolean));
  const live = Object.values(goals)
    .filter((g) => !g.deletedAt && !g.archived)
    .sort((a, b) => a.order - b.order);
  const picked = new Set(prefs.studyGoalIds);

  const setAnchor = (patch: Partial<StudyAnchor>) => {
    const next: StudyAnchor = { ...prefs.anchor, ...patch };
    for (const k of Object.keys(next) as (keyof StudyAnchor)[]) if (next[k] === undefined) delete next[k];
    patchDeskPrefs({ anchor: next });
  };
  const setDow = (dow: number, patch: Partial<StudyAnchor>) => {
    const arr = Array.from({ length: 7 }, (_, i) => prefs.anchorByDow[i] ?? null);
    const next: StudyAnchor = { ...(arr[dow] ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof StudyAnchor)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    arr[dow] = Object.keys(next).length ? next : null;
    patchDeskPrefs({ anchorByDow: arr.some(Boolean) ? arr : [] });
  };

  return (
    <div className="dk-setup">
      <div className="dk-su-k">哪些目标算学习</div>
      <div className="dk-su-goals">
        {live.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`dk-su-goal${picked.has(g.id) ? ' on' : ''}`}
            style={{ '--c': goalColor(g.color) } as React.CSSProperties}
            aria-pressed={picked.has(g.id)}
            onClick={() => patchDeskPrefs({ studyGoalIds: picked.has(g.id) ? prefs.studyGoalIds.filter((id) => id !== g.id) : [...prefs.studyGoalIds, g.id] })}
          >
            <i />
            {g.name}
          </button>
        ))}
        {live.length === 0 && <span className="dk-su-tip">还没有目标，先去甘特图建一个</span>}
      </div>

      <div className="dk-su-row">
        <span>每次学</span>
        <NumField label="每次学几分钟" value={prefs.studyMinutes} lo={5} hi={180} onSet={(n) => patchDeskPrefs({ studyMinutes: n })} />
        <span>分钟 · 短版</span>
        <NumField label="短版几分钟" value={prefs.shortMinutes} lo={5} hi={60} onSet={(n) => patchDeskPrefs({ shortMinutes: n })} />
        <span>分钟（做完也算学过）</span>
      </div>
      <div className="dk-su-row">
        <span>每周学</span>
        <NumField label="每周学几天" value={prefs.weekTarget} lo={1} hi={7} onSet={(n) => patchDeskPrefs({ weekTarget: n })} />
        <span>天</span>
        <span className="dk-su-tip">周目标代替「天天完美」，周末可以补</span>
      </div>

      <div className="dk-su-k">固定学习时间</div>
      <div className="dk-su-row">
        <span>我会在</span>
        <TextField label="在哪/什么时候学" value={prefs.anchor.text} placeholder="午饭后在工位" onSet={(v) => setAnchor({ text: v })} wide />
        <TextField label="几点开始学" type="time" value={prefs.anchor.time} onSet={(v) => setAnchor({ time: v })} />
        <span>学习</span>
      </div>
      <div className="dk-su-row">
        <span>最晚</span>
        <TextField label="最晚提醒时间" type="time" value={prefs.lastCall} onSet={(v) => patchDeskPrefs({ lastCall: v })} />
        <span className="dk-su-tip">还没学就再提醒一次「{prefs.shortMinutes} 分钟也算」</span>
      </div>
      <label className="dk-su-check">
        <input type="checkbox" checked={prefs.remind} onChange={(e) => patchDeskPrefs({ remind: e.target.checked })} />
        到点发系统通知
        <span className="dk-su-tip">{isDesktop() ? '关掉窗口也照常提醒（收在托盘里）' : '只在桌面版提醒；网页版不发通知'}</span>
      </label>

      <button type="button" className="dk-su-more" onClick={() => setByDow((v) => !v)} aria-expanded={byDow}>
        {byDow ? '▾' : '▸'} 按星期分别设
      </button>
      {byDow && (
        <div className="dk-su-dow">
          {DOW_ROWS.map(([dow, name]) => {
            const o = prefs.anchorByDow[dow] ?? null;
            return (
              <div key={dow} className="dk-su-row">
                <span className="wd">{name}</span>
                <TextField label={`${name}在哪学`} value={o?.text} placeholder="同上" onSet={(v) => setDow(dow, { text: v })} wide />
                <TextField label={`${name}几点学`} type="time" value={o?.time} onSet={(v) => setDow(dow, { time: v })} />
                <label className="dk-su-check inline">
                  <input type="checkbox" checked={Boolean(o?.off)} onChange={(e) => setDow(dow, { off: e.target.checked || undefined })} />
                  不提醒
                </label>
              </div>
            );
          })}
          <div className="dk-su-tip">留空 = 用上面的固定时间</div>
        </div>
      )}
    </div>
  );
}

/** 学习卡上弹出的设置浮层 */
export function StudySetupPop() {
  const at = useDeskUi((s) => s.studySetup);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!at || !el) return setPos(null);
    setPos({
      left: Math.max(8, Math.min(at.left - 20, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(at.top + 6, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [at]);
  if (!at) return null;
  return (
    <div
      ref={ref}
      className="dk-pop dk-su-pop"
      role="dialog"
      aria-label="学习设置"
      style={pos ? { left: pos.left, top: pos.top, maxHeight: window.innerHeight - pos.top - 8 } : { visibility: 'hidden', left: 0, top: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dk-pop-h">
        <b>学习设置</b>
        <span className="dk-grow" />
        <button type="button" className="dk-btn ghost" onClick={() => useDeskUi.getState().set({ studySetup: null })}>
          完成
        </button>
      </div>
      <StudySetupForm />
    </div>
  );
}
