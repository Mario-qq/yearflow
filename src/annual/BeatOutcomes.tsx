/**
 * beat 8 停滞与放弃 —— 全篇唯一会写库的一 beat（`[归档]`）。
 *
 * 三条硬约束（规格 §3.6 / §二）：
 * 1. **可申辩**：卡上必须显示「最后一条记录 5-12，距今 93 天」的原文。
 *    一个不能当场被人眼否掉的指控就是噪音。
 * 2. **随缘契约**：只剩随缘任务的目标判为 adhocOnly，中性列出最后一次，不催不指责。
 * 3. **不自动归档**：只建议；归档必须人点 + confirm，走既有 patchGoal（一条 undo）。
 *
 * idleDays 已在派生层扣掉该目标的免打卡区间 —— 出差两个月不该被诬告成放弃。
 */
import type { Goal } from '../types/domain';
import type { AnnualIndex, GoalStatusCard } from '../lib/derive/annual';
import { DEFAULT_STALL_DAYS } from '../lib/derive/annual';
import { goalColor } from '../lib/colors';
import { patchGoal } from '../store/actions';
import { showToast } from '../lib/toast';
import { Beat, HeroNumber, LookButton } from './Beat';
import { OUTCOME_BAR_H } from './constants';
import { shortDay } from './format';
import { useLocate } from './useLocate';

interface Props {
  idx: AnnualIndex;
  goals: Goal[];
}

function Card({
  card,
  goal,
  tone,
  note,
  onLook,
  action,
}: {
  card: GoalStatusCard;
  goal: Goal;
  tone: string;
  note: string;
  onLook?: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-2 border p-3"
      style={{
        borderColor: 'var(--border-default)',
        borderLeft: `3px solid ${tone}`,
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-panel)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block size-2 shrink-0"
          style={{ background: goalColor(goal.color), borderRadius: '50%' }}
        />
        <span className="truncate" style={{ fontSize: 'var(--font-13)' }}>
          {goal.icon} {goal.name}
        </span>
        <span className="ml-auto shrink-0" style={{ fontSize: 'var(--font-12)', color: tone }}>
          {note}
        </span>
      </div>

      {/* 可申辩的原文：日期 + 距今天数，误判能当场被人眼否掉 */}
      <p className="tnum" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
        {card.lastActivityDate ? (
          <>
            最后一条记录 {shortDay(card.lastActivityDate)}，距今 {card.idleDays} 天（已扣除免打卡区间）
          </>
        ) : (
          <>这个区间内没有任何记录</>
        )}
        {' · 进度 '}
        {Math.round(card.progressPct)}%
      </p>

      <div
        className="w-full"
        style={{
          height: OUTCOME_BAR_H,
          background: 'var(--bg-subtle)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <div
          style={{
            height: OUTCOME_BAR_H,
            width: `${Math.max(0, Math.min(100, card.progressPct))}%`,
            background: goalColor(goal.color),
            borderRadius: 'var(--radius-sm)',
          }}
        />
      </div>

      {(onLook || action) && (
        <div className="flex items-center gap-2" data-annual-noprint>
          {onLook && <LookButton onClick={onLook} title="跳到最后一条记录那天" />}
          {action}
        </div>
      )}
    </div>
  );
}

export function BeatOutcomes({ idx, goals }: Props) {
  const { scrollToDate } = useLocate();
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const cards = idx.outcomes.filter((c) => goalMap.has(c.goalId));
  if (cards.length === 0) return null; // 规格 §4.2

  const stalled = cards.filter((c) => c.outcome === 'stalled');
  const adhoc = cards.filter((c) => c.outcome === 'adhocOnly');
  const completed = cards.filter((c) => c.outcome === 'completed');
  const active = cards.filter((c) => c.outcome === 'active');

  const worst = [...stalled].sort((a, b) => b.idleDays - a.idleDays)[0];

  const archive = (card: GoalStatusCard): void => {
    const g = goalMap.get(card.goalId)!;
    const ok = window.confirm(
      `归档目标「${g.name}」？\n\n` +
        '归档后它会从甘特图泳道、打卡页与筛选器里消失，数据一条不删（年报与历史统计照常包含它）。\n' +
        '可以用 Ctrl+Z 撤销，也可以随时在目标设置里取消归档。',
    );
    if (!ok) return;
    patchGoal(g.id, { archived: true }, `归档目标「${g.name}」`);
    showToast(`已归档「${g.name}」，Ctrl+Z 可撤销`);
  };

  return (
    <Beat
      index={8}
      eyebrow="停滞与放弃"
      title={
        stalled.length === 0 ? (
          <>
            没有目标掉队 —— <span className="tnum">{cards.length}</span> 个在办目标近{' '}
            <span className="tnum">{DEFAULT_STALL_DAYS}</span> 天都还有动静。
          </>
        ) : (
          <>
            <span className="tnum">{stalled.length}</span> 个目标已经静默超过{' '}
            <span className="tnum">{DEFAULT_STALL_DAYS}</span> 天
            {worst && (
              <>
                ，最久的是「{goalMap.get(worst.goalId)!.name}」，
                <span className="tnum">{worst.idleDays}</span> 天没动过
              </>
            )}
            。
          </>
        )
      }
      footnote={
        <>
          静默天数已扣除该目标的免打卡区间 —— 出差、长假不算放弃。判定阈值固定{' '}
          {DEFAULT_STALL_DAYS} 天，只给建议：<b>归档要你自己点</b>，且是一条可撤销的命令。
          已归档与已软删的目标不在这一节里。
        </>
      }
    >
      <HeroNumber
        value={stalled.length}
        unit="个"
        format={(n) => String(Math.round(n))}
        sub={
          <>
            静默超 {DEFAULT_STALL_DAYS} 天的目标 · 完成 <span className="tnum">{completed.length}</span>{' '}
            · 在办 <span className="tnum">{active.length}</span> · 随缘{' '}
            <span className="tnum">{adhoc.length}</span>
          </>
        }
      />

      {stalled.length > 0 && (
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          {stalled
            .sort((a, b) => b.idleDays - a.idleDays)
            .map((c) => (
              <Card
                key={c.goalId}
                card={c}
                goal={goalMap.get(c.goalId)!}
                tone="var(--danger)"
                note={`静默 ${c.idleDays} 天`}
                onLook={c.lastActivityDate ? () => scrollToDate(c.lastActivityDate!) : undefined}
                action={
                  <button
                    type="button"
                    onClick={() => archive(c)}
                    className="cursor-pointer px-2 py-1"
                    style={{
                      fontSize: 'var(--font-12)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-panel)',
                    }}
                    title="归档后从甘特图与打卡页移出，数据保留，可撤销"
                  >
                    归档
                  </button>
                }
              />
            ))}
        </div>
      )}

      {adhoc.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            下面这些目标只剩随缘任务 —— 它们按设计就不排期，这里只中性记一笔「最后一次」：
          </p>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            {adhoc.map((c) => (
              <Card
                key={c.goalId}
                card={c}
                goal={goalMap.get(c.goalId)!}
                tone="var(--border-strong)"
                note="随缘"
                onLook={c.lastActivityDate ? () => scrollToDate(c.lastActivityDate!) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </Beat>
  );
}
