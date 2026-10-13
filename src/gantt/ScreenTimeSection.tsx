/**
 * 任务抽屉「屏幕时间」区：把手机应用的前台时长关联到本任务，电脑端采集脚本每个工作日 9:00 自动打卡。
 * 候选应用 = 已采集到的屏幕时间里出现过的非系统应用，按近 14 天总时长排序。
 */
import { useMemo, useState } from 'react';
import type { ScreenTimeRule, Task } from '../types/domain';
import { useStore } from '../store/useStore';
import { patchTask } from '../store/actions';
import { appLabel, isSystemBundle } from '../lib/screenTimeApps';
import { dayjs, fmtDay } from '../lib/date';

const CANDIDATE_DAYS = 14;
const DEFAULT_RULE: ScreenTimeRule = { apps: [], mode: 'reach', minutes: 30 };

const chip: React.CSSProperties = {
  fontSize: 'var(--font-11)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 6px',
};

export function ScreenTimeSection({ task, field }: { task: Task; field: React.CSSProperties }) {
  const days = useStore((s) => s.screenTimeDays);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const rule = task.screenTime;

  /** 近 14 天各应用日均分钟 + 最近一天的日期（提示数据新鲜度） */
  const { candidates, latest } = useMemo(() => {
    const since = fmtDay(dayjs().subtract(CANDIDATE_DAYS, 'day'));
    const totals = new Map<string, number>();
    let latest = '';
    for (const d of Object.values(days)) {
      if (d.deletedAt) continue;
      if (d.date > latest) latest = d.date;
      if (d.date < since) continue;
      for (const [b, m] of Object.entries(d.apps)) {
        if (!isSystemBundle(b)) totals.set(b, (totals.get(b) ?? 0) + m);
      }
    }
    const candidates = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([bundle, total]) => ({ bundle, avg: Math.round(total / CANDIDATE_DAYS) }));
    return { candidates, latest };
  }, [days]);

  const save = (next: ScreenTimeRule | undefined, label: string) => patchTask(task.id, { screenTime: next }, label);

  const toggle = (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-1.5"
      style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
      onClick={() =>
        save(rule ? undefined : DEFAULT_RULE, rule ? `「${task.name}」取消关联手机应用` : `「${task.name}」关联手机应用`)
      }
    >
      <span style={{ color: rule ? 'var(--accent)' : 'var(--text-tertiary)' }}>{rule ? '☑' : '☐'}</span>
      按手机应用使用时长自动打卡（工作日 9:00 确认前一天）
    </button>
  );

  if (!rule) return toggle;

  const q = query.trim().toLowerCase();
  const pickable = candidates.filter(
    (c) =>
      !rule.apps.includes(c.bundle) &&
      (!q || appLabel(c.bundle).toLowerCase().includes(q) || c.bundle.toLowerCase().includes(q)),
  );

  return (
    <div className="flex flex-col gap-2">
      {toggle}

      <div className="flex gap-1">
        {(
          [
            ['reach', '累计型（学习类）'],
            ['cap', '上限型（娱乐类）'],
          ] as const
        ).map(([mode, label]) => {
          const active = rule.mode === mode;
          return (
            <button
              key={mode}
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
              onClick={() => save({ ...rule, mode }, `修改「${task.name}」屏幕时间规则`)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2" style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
        <span>{rule.mode === 'reach' ? '合计达到' : '合计不超过'}</span>
        <input
          key={`st-min-${task.id}-${task.updatedAt}`}
          type="number"
          min={1}
          max={1440}
          className="tnum"
          style={{ ...field, width: 72 }}
          defaultValue={rule.minutes}
          onBlur={(e) => {
            const v = Math.min(1440, Math.max(1, Math.round(Number(e.target.value) || rule.minutes)));
            if (v !== rule.minutes) save({ ...rule, minutes: v }, `修改「${task.name}」屏幕时间分钟`);
            else e.target.value = String(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
        />
        <span>分钟记「完成」</span>
      </div>
      <div style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        {rule.mode === 'reach'
          ? '不足目标但用过记「做了一点」；时长计入投入时间。'
          : '超出上限不打卡（当天显示为缺卡）；时长只写进备注，不计入投入时间。'}
        手动打过的卡不会被改状态。
      </div>

      <div className="flex flex-wrap gap-1">
        {rule.apps.map((b) => (
          <span key={b} className="flex items-center gap-1" style={{ ...chip, color: 'var(--text-primary)', background: 'var(--bg-subtle)' }}>
            {appLabel(b)}
            <button
              type="button"
              className="cursor-pointer"
              style={{ color: 'var(--text-tertiary)' }}
              title="移除"
              onClick={() => save({ ...rule, apps: rule.apps.filter((x) => x !== b) }, `「${task.name}」移除关联应用`)}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          type="button"
          className="cursor-pointer"
          style={{ ...chip, color: 'var(--accent)', borderStyle: 'dashed' }}
          onClick={() => setPicking((v) => !v)}
        >
          {picking ? '收起' : '＋ 添加应用'}
        </button>
      </div>
      {rule.apps.length === 0 && (
        <div style={{ fontSize: 'var(--font-11)', color: 'var(--warning)' }}>
          还没选应用，不会自动打卡。
        </div>
      )}

      {picking && (
        <div className="flex flex-col gap-1" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 6 }}>
          {candidates.length === 0 ? (
            <div style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              还没有屏幕时间数据。电脑端采集脚本首次运行后，这里会列出手机上用过的应用。
            </div>
          ) : (
            <>
              <input
                style={field}
                placeholder="搜索应用"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <div className="flex flex-col overflow-y-auto" style={{ maxHeight: 200 }}>
                {pickable.map((c) => (
                  <button
                    key={c.bundle}
                    type="button"
                    className="flex cursor-pointer items-center gap-2 hover:bg-subtle"
                    style={{ padding: '3px 4px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-12)', textAlign: 'left' }}
                    onClick={() => save({ ...rule, apps: [...rule.apps, c.bundle] }, `「${task.name}」关联应用「${appLabel(c.bundle)}」`)}
                  >
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{appLabel(c.bundle)}</span>
                    <span className="tnum" style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-11)' }}>
                      日均 {c.avg} 分
                    </span>
                  </button>
                ))}
                {pickable.length === 0 && (
                  <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>没有匹配的应用</span>
                )}
              </div>
              <div style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
                数据截至 {latest}，近 {CANDIDATE_DAYS} 天用过的应用
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
