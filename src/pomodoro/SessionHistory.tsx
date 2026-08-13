/**
 * 专注记录（规格 §十二 S5「会话历史 / 编辑 / 手动补录界面」）。
 *
 * 三件事，都是纯 UI —— 数据层在 S3 就已具备（focusRepo 的 date 索引 + 四个 action）：
 * · 按日分组回看某个日期范围内的全部会话（含丢弃的，标注「不计入」，否则用户会以为丢了数据）；
 * · 就地编辑：改时长（onBlur 才提交，Enter → blur）、改归属、删除，每一步一格 undo；
 * · 手动补录一段（忘了开计时器的那一小时）——落 `source: 'manual'`，标记中性、不做降权。
 *
 * ⚠️ 时长与归属都走 store/actions 里的 updateFocusSession / reassignFocusSession：
 * 改时长会同时把 plannedMs 抬到 focusMs（否则打破 focusMs ≤ plannedMs 恒等式），
 * 这条口径只此一处实现，界面绝不自己拼 FocusSession 写库。
 */
import { useMemo, useState } from 'react';
import type { FocusSession } from '../types/domain';
import { useStore } from '../store/useStore';
import { fmtDay, toDay, todayStr } from '../lib/date';
import { isCountedSession } from '../lib/derive';
import {
  addManualFocusSession,
  deleteFocusSession,
  reassignFocusSession,
  updateFocusSession,
} from '../store/actions';
import { showToast } from '../lib/toast';
import { humanMs, toMinutes } from './format';
import { TaskPicker } from './TaskPicker';
import type { FocusSel } from './useSelLabel';

/** 手动补录的分钟上限：10 小时。比 4h 硬截断宽松（补录的是已发生的事实，不是计时器） */
const MANUAL_MAX_MIN = 600;
/** 回看窗口默认天数 */
const DEFAULT_RANGE_DAYS = 13;
/** dayjs 没装中文 locale（date.ts 只 extend 了 isoWeek/customParseFormat），星期自己拼 */
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

const inputStyle: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-primary)',
  padding: '3px 6px',
};

const btn: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '3px 10px',
  cursor: 'pointer',
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 一条会话：起止 · 时长（可改）· 归属（可改）· 徽标 · 删除 */
function SessionRow({ s }: { s: FocusSession }) {
  const [min, setMin] = useState(String(toMinutes(s.focusMs)));
  const counted = isCountedSession(s);

  // onBlur 才提交，且 clamp 后写回并回显（不是「非法就不写」——那会留下一个骗人的输入框）
  const commitMinutes = () => {
    const n = Math.round(Number(min));
    if (!Number.isFinite(n) || n <= 0) {
      setMin(String(toMinutes(s.focusMs)));
      return;
    }
    const clamped = Math.min(n, MANUAL_MAX_MIN);
    setMin(String(clamped));
    if (clamped !== toMinutes(s.focusMs)) updateFocusSession(s.id, { focusMs: clamped * 60_000 });
  };

  return (
    <div className="flex items-center gap-2" style={{ opacity: counted ? 1 : 0.55 }}>
      <span
        className="tnum shrink-0"
        style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', width: 82 }}
        title={`${s.startAt} → ${s.endAt}`}
      >
        {hhmm(s.startAt)}–{hhmm(s.endAt)}
      </span>

      <span className="flex shrink-0 items-center gap-1">
        <input
          value={min}
          onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))}
          onBlur={commitMinutes}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          }}
          className="tnum w-11 text-right outline-none"
          style={inputStyle}
          aria-label="专注分钟"
        />
        <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>分</span>
      </span>

      <div className="min-w-0 flex-1">
        <TaskPicker
          compact
          value={{ goalId: s.goalId, taskId: s.taskId }}
          onPick={(next) => reassignFocusSession(s.id, next)}
        />
      </div>

      {s.source === 'manual' && <Badge text="手动" color="var(--text-tertiary)" />}
      {s.needsReview && <Badge text="待确认" color="var(--warning)" />}
      {s.outcome === 'stopped' && <Badge text="提前停" color="var(--text-tertiary)" />}
      {s.outcome === 'discarded' && <Badge text="不计入" color="var(--danger)" />}

      <button
        type="button"
        onClick={() => deleteFocusSession(s.id)}
        className="shrink-0 cursor-pointer px-1"
        style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
        title="删除这段记录（可 Ctrl+Z 撤销）"
      >
        ✕
      </button>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="shrink-0"
      style={{ fontSize: 'var(--font-11)', color, border: `1px solid ${color}`, borderRadius: 999, padding: '0 5px' }}
    >
      {text}
    </span>
  );
}

export function SessionHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const focusSessions = useStore((s) => s.focusSessions);
  const today = todayStr();
  const [from, setFrom] = useState(() => fmtDay(toDay(today).subtract(DEFAULT_RANGE_DAYS, 'day')));
  const [to, setTo] = useState(today);

  // 补录表单
  const [addDate, setAddDate] = useState(today);
  const [addTime, setAddTime] = useState('09:00');
  const [addMin, setAddMin] = useState('50');
  const [addSel, setAddSel] = useState<FocusSel>({});

  const groups = useMemo(() => {
    const byDate = new Map<string, FocusSession[]>();
    for (const s of Object.values(focusSessions)) {
      if (s.deletedAt || s.date < from || s.date > to) continue;
      const list = byDate.get(s.date);
      if (list) list.push(s);
      else byDate.set(s.date, [s]);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, list]) => ({
        date,
        list: list.sort((a, b) => (a.startAt < b.startAt ? -1 : 1)),
        // 合计只算计入的段：与复盘/面板的口径一致，丢弃的段不能让这里的数变大
        ms: list.filter(isCountedSession).reduce((sum, s) => sum + s.focusMs, 0),
      }));
  }, [focusSessions, from, to]);

  const totalMs = groups.reduce((sum, g) => sum + g.ms, 0);

  if (!open) return null;

  const submitManual = () => {
    const n = Math.round(Number(addMin));
    if (!Number.isFinite(n) || n <= 0) return;
    const clamped = Math.min(n, MANUAL_MAX_MIN);
    const startAt = new Date(`${addDate}T${addTime || '09:00'}:00`);
    if (Number.isNaN(startAt.getTime())) return;
    addManualFocusSession({
      goalId: addSel.goalId,
      taskId: addSel.taskId,
      // date 与 startAt 同源派生一次即冻结（跨天/改归日的语义见 domain.ts 的字段注释）
      date: addDate,
      startAt: startAt.toISOString(),
      focusMs: clamped * 60_000,
    });
    showToast(`已补录 ${clamped} 分钟`);
    if (addDate < from) setFrom(addDate);
  };

  /**
   * ⚠️ 不 portal 到 body：胶囊的「点外部关闭」是 DOM 包含判断（`rootRef.contains`），
   * portal 出去的节点不在 rootRef 里 ⇒ 点对话框任何一处都会把面板连同本对话框一起卸载。
   * 与 AskDialog 同样挂在胶囊的 relative 容器内即可（fixed 相对视口，父容器不影响定位）。
   */
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.35)' }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-[560px] max-w-[calc(100vw-32px)] flex-col gap-3 border p-4"
        style={{
          borderColor: 'var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-raised)',
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="专注记录"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-medium" style={{ fontSize: 'var(--font-14)' }}>
            专注记录
          </h2>
          <span className="tnum" style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
            合计 {humanMs(totalMs)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer"
            style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2" style={{ fontSize: 'var(--font-12)' }}>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="tnum"
            style={inputStyle}
            aria-label="起始日期"
          />
          <span style={{ color: 'var(--text-tertiary)' }}>至</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            className="tnum"
            style={inputStyle}
            aria-label="结束日期"
          />
          <button
            type="button"
            style={btn}
            className="ml-auto"
            onClick={() => {
              setFrom(fmtDay(toDay(today).subtract(DEFAULT_RANGE_DAYS, 'day')));
              setTo(today);
            }}
          >
            最近两周
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {groups.length === 0 && (
            <p style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}>
              这个范围里没有专注记录。可以在下面补录一段。
            </p>
          )}
          {groups.map((g) => (
            <div key={g.date} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2" style={{ fontSize: 'var(--font-12)' }}>
                <span className="tnum" style={{ color: 'var(--text-secondary)' }}>
                  {toDay(g.date).format('M月D日')} 周{WEEKDAY_ZH[toDay(g.date).day()]}
                </span>
                <span className="tnum" style={{ color: 'var(--text-tertiary)' }}>
                  {humanMs(g.ms)} · {g.list.length} 段
                </span>
              </div>
              {g.list.map((s) => (
                <SessionRow key={s.id} s={s} />
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <span style={{ fontSize: 'var(--font-12)', color: 'var(--text-secondary)' }}>
            补录一段（忘了开计时器的那一小时）
          </span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={addDate}
              max={today}
              onChange={(e) => e.target.value && setAddDate(e.target.value)}
              className="tnum"
              style={inputStyle}
              aria-label="补录日期"
            />
            <input
              type="time"
              value={addTime}
              onChange={(e) => setAddTime(e.target.value)}
              className="tnum"
              style={inputStyle}
              aria-label="开始时刻"
            />
            <span className="flex items-center gap-1">
              <input
                value={addMin}
                onChange={(e) => setAddMin(e.target.value.replace(/\D/g, ''))}
                className="tnum w-12 text-right outline-none"
                style={inputStyle}
                aria-label="补录分钟"
              />
              <span style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}>分</span>
            </span>
            <div className="min-w-0 flex-1">
              <TaskPicker compact value={addSel} onPick={setAddSel} />
            </div>
            <button
              type="button"
              onClick={submitManual}
              style={{ ...btn, borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              补录
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
