/**
 * 小窗里的事项选择器：一层覆盖整窗的浮层，不占任何常驻高度。
 *
 * 为什么不复用主面板的 TaskPicker：那个是「锚点按钮 + 视口翻转下拉 + 搜索框 + 每行悬浮
 * 小按钮」，最窄 200px 的小窗根本放不下，翻转逻辑在无边框窗口里也没有意义。共享的是候选
 * 集本身（useFocusOptions），那才是容易走样的部分；呈现方式两边各自最优。
 *
 * 触发口在 PipView 顶栏那行文字上 —— 顶栏本来就有，所以「不占地方」是真的不占：
 * 浮层只在打开时存在，关掉后小窗几何一模一样。
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { PIP_TOPBAR_H } from './constants';
import { useFocusOptions, type Option } from './useFocusOptions';
import type { FocusSel } from './useSelLabel';

export function PipTaskPicker({
  value,
  onPick,
  onClose,
}: {
  value: FocusSel;
  onPick: (sel: FocusSel) => void;
  onClose: () => void;
}) {
  const { recentOptions, todayOptions, allOptions, refreshRecent } = useFocusOptions();
  const tasks = useStore((s) => s.tasks);
  const boxRef = useRef<HTMLDivElement>(null);

  // 「最近」是 localStorage 里的跨窗口状态，打开这一刻才是它最新的时候
  useEffect(() => refreshRecent(), [refreshRecent]);

  // Esc 关掉：无边框小窗没有系统关闭键，键盘退路必须自己给
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    boxRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 「最近」优先，其后补今日在办；都空了才退到全部任务，保证这个浮层永远不是空的。
  // 与网页版一致：标了「不列入专注」（noFocus）的任务不进列表 —— 但「最近」不受此约束，
  // 手动选过一次就说明确实想给它计时（规则同 useFocusOptions 里的注释）。小窗没有
  // 网页版那个「显示全部」开关，所以这里是硬过滤。
  const seen = new Set<string>();
  const list: Option[] = [
    ...recentOptions,
    ...todayOptions.filter((o) => !tasks[o.taskId]?.noFocus),
    ...allOptions.filter((o) => !tasks[o.taskId]?.noFocus),
  ].filter((o) => {
    if (seen.has(o.taskId)) return false;
    seen.add(o.taskId);
    return true;
  });

  const pick = (sel: FocusSel): void => {
    onPick(sel);
    onClose();
  };

  return (
    <div ref={boxRef} className="pip-picker" tabIndex={-1} role="dialog" aria-label="选择专注事项">
      <div className="pip-picker-bar" style={{ height: PIP_TOPBAR_H }}>
        <span>选择事项</span>
        <button type="button" className="pip-picker-x" onClick={onClose} aria-label="取消">
          ✕
        </button>
      </div>
      <div className="pip-picker-list">
        {list.map((o) => {
          const on = value.taskId === o.taskId;
          return (
            <button
              key={o.taskId}
              type="button"
              className={`pip-picker-row${on ? ' is-on' : ''}`}
              onClick={() => pick({ goalId: o.goalId, taskId: o.taskId })}
              title={`${o.goalName} · ${o.taskName}`}
            >
              <span className="pip-picker-icon" aria-hidden>
                {o.goalIcon}
              </span>
              <span className="pip-picker-name">{o.taskName}</span>
              <span className="pip-picker-goal">{o.goalName}</span>
            </button>
          );
        })}
        {/* 「暂不归类」是规格里的合法选择，不是兜底文案 —— 不给入口就只能回主窗改 */}
        <button
          type="button"
          className={`pip-picker-row${!value.taskId && !value.goalId ? ' is-on' : ''}`}
          onClick={() => pick({})}
        >
          <span className="pip-picker-icon" aria-hidden>
            ·
          </span>
          <span className="pip-picker-name" style={{ color: 'var(--text-tertiary)' }}>
            暂不归类
          </span>
        </button>
      </div>
    </div>
  );
}
