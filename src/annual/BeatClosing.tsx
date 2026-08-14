/**
 * beat 10 收尾：把前面十个 beat 收成一张记分卡 + 一份「接下来」。
 *
 * 三条约束：
 * · **结论全部规则驱动**（规格 §二：本地优先应用必须离线可用，不接 LLM）。
 *   下面每条建议都来自一个可读的判断式，不是生成的文案。
 * · **不说教**：只写「做什么」，不写「你应该更自律」。
 * · **不新算数字**：所有数字来自 annualIndex，本组件只做加总与措辞。
 *
 * 这一 beat 的「图」是记分卡本身 —— 收尾要的是一眼扫完，再画一张曲线只是重复。
 */
import type { AnnualIndex } from '../lib/derive/annual';
import { humanMs } from '../pomodoro/format';
import { Beat, HeroNumber } from './Beat';
import { hoursOf, RANGE_LABEL, shortDay } from './format';

interface Tile {
  label: string;
  value: string;
  hint?: string;
}

export function BeatClosing({ idx }: { idx: AnnualIndex }) {
  const { range, months, invested, runs, drift, milestones, outcomes } = idx;

  let scheduled = 0;
  let score = 0;
  for (const m of months) {
    scheduled += m.scheduled;
    score += m.score;
  }
  const ratePct = scheduled > 0 ? Math.round((score / scheduled) * 100) : null;

  const overdue = milestones.rows.filter((r) => !r.achieved && r.date <= range.clippedEnd).length;
  const stalled = outcomes.filter((c) => c.outcome === 'stalled').length;
  const longest = runs[0];
  const label = RANGE_LABEL[range.kind];

  const tiles: Tile[] = [
    {
      label: '合计完成率',
      value: ratePct === null ? '—' : `${ratePct}%`,
      hint: scheduled > 0 ? `${score} / ${scheduled} 应打卡日` : '这个区间没有应打卡日',
    },
    {
      label: '归类投入',
      value: `${hoursOf(invested.goalTotalMs)} 小时`,
      hint:
        invested.unassignedCount > 0
          ? `另有 ${invested.unassignedCount} 段未归类（${humanMs(invested.unassignedMs)}）`
          : '全部已归到目标',
    },
    {
      label: '最长连续',
      value: longest ? `${longest.days} 天` : '—',
      hint: longest ? `${shortDay(longest.from)} — ${shortDay(longest.to)}` : '这个区间没有连续段',
    },
    {
      label: '累计推迟',
      value: `${drift.totalDelayDays} 天`,
      hint:
        drift.noBaselineCount > 0 ? `${drift.noBaselineCount} 个任务无基线未计` : '所有任务都有基线',
    },
    {
      label: '里程碑',
      value: `${milestones.achieved} / ${milestones.total}`,
      hint: overdue > 0 ? `${overdue} 个已过期未达成` : '没有过期未达成的',
    },
    {
      label: '静默目标',
      value: `${stalled} 个`,
      hint: stalled > 0 ? '见上一节，可归档或重新排期' : '没有目标掉队',
    },
  ];

  // 规则驱动的「接下来」：每条都对应一个可点的具体动作，按可操作性排序
  const todos: string[] = [];
  if (stalled > 0) todos.push(`处理 ${stalled} 个静默目标：归档，或给它排一个这周就能做的任务。`);
  if (overdue > 0) todos.push(`重排 ${overdue} 个过期里程碑：改期，或标记为已达成。`);
  if (invested.unassignedCount > 0)
    todos.push(
      `归类 ${invested.unassignedCount} 段未归类专注（${humanMs(invested.unassignedMs)}）：它们现在不进任何目标的账。`,
    );
  if (drift.noBaselineCount > 0)
    todos.push(`给 ${drift.noBaselineCount} 个任务保存基线：没有基线就看不出计划漂移。`);
  if (todos.length === 0) todos.push('没有待办 —— 这个区间的账是干净的。');

  return (
    <Beat
      index={10}
      eyebrow="收尾"
      title={
        range.clipped ? (
          <>
            {range.year} 年{label}还剩 <span className="tnum">{idx.totalDays - idx.elapsedDays}</span>{' '}
            天。到这里为止，这一年长这个样子。
          </>
        ) : (
          <>
            {range.year} 年{label}到此为止 —— 这是它最终的样子。
          </>
        )
      }
      footnote={
        <>
          这一节的结论全部由规则算出（离线可用，不接任何在线模型），数字与上面各节同源。
          月度明细去复盘页，这里只留能立刻动手的那几件。
        </>
      }
    >
      {ratePct === null ? (
        <HeroNumber
          value={hoursOf(invested.goalTotalMs)}
          unit="小时"
          format={(n) => n.toFixed(1)}
          sub={<>这个区间归类到目标的总投入</>}
        />
      ) : (
        <HeroNumber
          value={ratePct}
          unit="%"
          format={(n) => String(Math.round(n))}
          sub={
            <>
              区间合计完成率 · <span className="tnum">{score}</span> /{' '}
              <span className="tnum">{scheduled}</span> 应打卡日
            </>
          }
        />
      )}

      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-2">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="flex flex-col gap-1 border p-3"
            style={{
              borderColor: 'var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-panel)',
            }}
          >
            <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
              {t.label}
            </span>
            <span className="tnum" style={{ fontSize: 'var(--font-16)', fontWeight: 500 }}>
              {t.value}
            </span>
            {t.hint && (
              <span className="tnum" style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>
                {t.hint}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>接下来：</p>
        {todos.map((t) => (
          <p key={t} style={{ fontSize: 'var(--font-13)' }}>
            · {t}
          </p>
        ))}
      </div>
    </Beat>
  );
}
