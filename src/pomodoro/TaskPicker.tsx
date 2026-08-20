/**
 * 番茄钟任务选择器（规格 §8.2 第 3 项）。
 *
 * 三条来自规格的硬性要求：
 * · 列表**必须包含 adhoc「随缘」任务** —— 只列 dayEntries 的话随缘任务永远统计不到时间
 *   （isScheduledDow 对 adhoc 恒为 false）；
 * · 允许「暂不归类」（先开始后归类，事后在面板里清理）；
 * · 选中日期范围外 / 已完成的任务：**提示但不阻止**（任务延期是真实情况），
 *   并顺手给一个「延长任务到今天」的快捷动作。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { patchTask } from '../store/actions';
import { todayStr } from '../lib/date';
import {
  PICKER_CHROME_H,
  PICKER_GAP,
  PICKER_LIST_MAX,
  PICKER_LIST_MIN,
  PICKER_VIEWPORT_MARGIN,
} from './constants';
import { useSelLabel, type FocusSel } from './useSelLabel';
import { useFocusOptions, type Option } from './useFocusOptions';

const rowStyle: React.CSSProperties = {
  fontSize: 'var(--font-12)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-panel)',
  padding: '3px 8px',
  cursor: 'pointer',
};

function GroupLabel({ text }: { text: string }) {
  return (
    <span
      className="shrink-0 px-1 py-0.5"
      style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
    >
      {text}
    </span>
  );
}

/**
 * 一行 = 选择按钮 + hover 才显形的「不计时 / 恢复」小按钮。
 * 两个 button 并列而不是嵌套：按钮里套按钮是非法 HTML，点击行为也无法预期。
 */
function Row({
  o,
  value,
  onChoose,
  onExclude,
  onInclude,
}: {
  o: Option;
  value: FocusSel;
  onChoose: (sel: FocusSel) => void;
  onExclude?: (o: Option) => void;
  onInclude?: (o: Option) => void;
}) {
  const toggle = onExclude ?? onInclude;
  return (
    <div className="group flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onChoose({ goalId: o.goalId, taskId: o.taskId })}
        className="min-w-0 flex-1 cursor-pointer truncate px-1 py-1 text-left"
        style={{
          fontSize: 'var(--font-12)',
          color: o.taskId === value.taskId ? 'var(--accent)' : 'var(--text-primary)',
        }}
      >
        <span style={{ color: 'var(--text-tertiary)' }}>
          {o.goalIcon} {o.goalName} ·{' '}
        </span>
        {o.taskName}
      </button>
      {toggle && (
        <button
          type="button"
          onClick={() => toggle(o)}
          className="shrink-0 cursor-pointer px-1 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
          title={onExclude ? '以后不在这里列出这个任务（可撤销）' : '恢复列出'}
          aria-label={onExclude ? '不计时' : '恢复列出'}
        >
          {onExclude ? '⊘' : '＋'}
        </button>
      )}
    </div>
  );
}

export function TaskPicker({
  value,
  onPick,
  compact,
}: {
  value: FocusSel;
  onPick: (sel: FocusSel) => void;
  compact?: boolean;
}) {
  const tasks = useStore((s) => s.tasks);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  /** 打开方向与列表高度：面板底部那批 compact 选择器若一律向下开会顶出视口 */
  const [drop, setDrop] = useState({ up: false, listMax: PICKER_LIST_MAX });
  const today = todayStr();
  const label = useSelLabel(value);

  const { recentOptions, todayOptions, hiddenOptions, allOptions, refreshRecent } =
    useFocusOptions();

  const q = query.trim().toLowerCase();
  // 搜索模式不受任何过滤影响 —— 搜得到才叫逃生阀
  const searchList = q
    ? allOptions.filter(
        (o) => o.taskName.toLowerCase().includes(q) || o.goalName.toLowerCase().includes(q),
      )
    : [];
  const empty = q ? searchList.length === 0 : recentOptions.length + todayOptions.length === 0;

  const picked = value.taskId ? tasks[value.taskId] : undefined;
  const overdue = picked && !picked.deletedAt && picked.endDate < today;
  const notStarted = picked && !picked.deletedAt && picked.startDate > today;
  const isDone = picked?.status === 'done';

  // 打开瞬间（以及视口变化时）量一次上下空间：下方装不下且上方更宽裕就翻上去开，
  // 否则就地压缩列表高度 —— 但压不到 PICKER_LIST_MIN 以下，那种高度已经不能用了。
  useEffect(() => {
    if (open) refreshRecent();
  }, [open, refreshRecent]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - PICKER_GAP - PICKER_VIEWPORT_MARGIN;
      const above = r.top - PICKER_GAP - PICKER_VIEWPORT_MARGIN;
      const wanted = PICKER_LIST_MAX + PICKER_CHROME_H;
      const up = below < wanted && above > below;
      const space = (up ? above : below) - PICKER_CHROME_H;
      setDrop({ up, listMax: Math.max(PICKER_LIST_MIN, Math.min(PICKER_LIST_MAX, space)) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  const choose = (sel: FocusSel) => {
    onPick(sel);
    setOpen(false);
    setQuery('');
  };

  // 行内一键排除/恢复：走 patchTask ⇒ 自动进 undo 栈，误点一次 Ctrl+Z 就回来了。
  // 下拉不关闭 —— 用户此刻在做的是「清理这张列表」，关掉它等于每清一个都要重开
  const exclude = (o: Option) =>
    patchTask(o.taskId, { noFocus: true }, `「${o.taskName}」不再列入专注`);
  const include = (o: Option) =>
    patchTask(o.taskId, { noFocus: undefined }, `「${o.taskName}」恢复列入专注`);

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1 text-left"
        style={{ ...rowStyle, fontSize: compact ? 'var(--font-11)' : 'var(--font-12)' }}
        title="选择这段专注计入哪个任务"
      >
        <span className="min-w-0 flex-1 truncate" style={{ color: label.text === '暂不归类' ? 'var(--text-tertiary)' : undefined }}>
          {label.text}
        </span>
        <span aria-hidden style={{ color: 'var(--text-tertiary)' }}>
          ▾
        </span>
      </button>

      {/* 提示但不阻止：任务延期是真实情况，拦住用户反而逼他改数据来迁就工具 */}
      {!open && (overdue || notStarted || isDone) && (
        <p className="mt-1 flex items-center gap-1.5" style={{ fontSize: 'var(--font-11)', color: 'var(--warning)' }}>
          <span>{isDone ? '该任务已标记完成' : overdue ? '该任务已过截止日' : '该任务还没开始'}</span>
          {/* 已完成的任务不给「延长到今天」：那是延期任务的动作，混在一起会让提示自相矛盾 */}
          {overdue && !isDone && picked && (
            <button
              type="button"
              onClick={() => patchTask(picked.id, { endDate: today }, `延长「${picked.name}」到今天`)}
              className="cursor-pointer underline underline-offset-2"
              style={{ color: 'var(--accent)' }}
            >
              延长到今天
            </button>
          )}
        </p>
      )}

      {open && (
        <div
          className="absolute right-0 left-0 z-50 flex flex-col border p-2"
          style={{
            top: drop.up ? undefined : '100%',
            bottom: drop.up ? '100%' : undefined,
            marginTop: drop.up ? undefined : PICKER_GAP,
            marginBottom: drop.up ? PICKER_GAP : undefined,
            borderColor: 'var(--border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-raised)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索全部任务…"
            className="mb-1.5 shrink-0 px-2 py-1 outline-none"
            style={{
              fontSize: 'var(--font-12)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--text-primary)',
            }}
          />
          {/* 每一行都必须 shrink-0：行自带 truncate（overflow:hidden），
              flex item 的自动最小尺寸随之退化为 0，不加就会被压扁成一叠、还挤不出滚动条 */}
          <div className="flex flex-col overflow-y-auto" style={{ maxHeight: drop.listMax }}>
            {empty && (
              <span
                className="shrink-0 px-1 py-1"
                style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)' }}
              >
                {q ? '没有匹配的任务' : '今天没有要计时的任务，可搜索或暂不归类'}
              </span>
            )}
            {q ? (
              <>
                <GroupLabel text={`搜索结果 ${searchList.length}`} />
                {searchList.map((o) => (
                  <Row key={o.taskId} o={o} value={value} onChoose={choose} />
                ))}
              </>
            ) : (
              <>
                {recentOptions.length > 0 && <GroupLabel text="最近" />}
                {recentOptions.map((o) => (
                  <Row key={`r:${o.taskId}`} o={o} value={value} onChoose={choose} onExclude={exclude} />
                ))}
                {todayOptions.length > 0 && <GroupLabel text="今日在办" />}
                {todayOptions.map((o) => (
                  <Row key={o.taskId} o={o} value={value} onChoose={choose} onExclude={exclude} />
                ))}
                {hiddenOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHidden((v) => !v)}
                    className="shrink-0 cursor-pointer px-1 py-1 text-left"
                    style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)' }}
                  >
                    {showHidden ? '收起' : `显示全部（另有 ${hiddenOptions.length} 个已标不计时）`}
                  </button>
                )}
                {showHidden &&
                  hiddenOptions.map((o) => (
                    <Row
                      key={`h:${o.taskId}`}
                      o={o}
                      value={value}
                      onChoose={choose}
                      onInclude={include}
                    />
                  ))}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => choose({})}
            className="mt-1.5 shrink-0 cursor-pointer border-t px-1 pt-1.5 text-left"
            style={{ fontSize: 'var(--font-12)', color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}
          >
            暂不归类（先开始，事后再归）
          </button>
        </div>
      )}
    </div>
  );
}
