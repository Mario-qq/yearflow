/** 快捷键速查表（SPEC 4.7）：顶栏 ? 按钮或 Shift+/ 打开 */
const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: '导航与视图',
    rows: [
      ['T', '回到今天'],
      ['+ / −', '放大 / 缩小一档'],
      ['Ctrl+滚轮', '以鼠标为锚连续缩放'],
      ['← / →', '平移一周'],
      ['Shift+← / →', '平移一月'],
      ['Shift+滚轮', '水平平移'],
      ['空格+拖拽', '抓手平移'],
      ['B', '切换基线显示'],
      ['双击目标行', '聚焦该目标'],
    ],
  },
  {
    title: '编辑',
    rows: [
      ['N', '在视口中心新建任务'],
      ['M', '在视口中心新建里程碑'],
      ['Ctrl+Z', '撤销'],
      ['Ctrl+Shift+Z / Ctrl+Y', '重做'],
      ['Del', '删除选中任务'],
      ['Esc', '取消操作 / 关闭浮层 / 清除选择'],
    ],
  },
  {
    title: '其他',
    rows: [
      ['/ 或 Ctrl+K', '命令面板'],
      ['D', '今日打卡面板'],
      ['P', '开始 / 暂停番茄钟'],
      ['Shift+P', '停止番茄钟并记账'],
      ['?', '本速查表'],
    ],
  },
];

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.25)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full overflow-hidden"
        style={{
          maxWidth: 460,
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          className="flex items-center px-4"
          style={{ height: 42, borderBottom: '1px solid var(--border-subtle)' }}
        >
          <span className="font-semibold" style={{ fontSize: 'var(--font-13)' }}>
            键盘快捷键
          </span>
          <button
            type="button"
            className="ml-auto cursor-pointer hover:bg-subtle"
            style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div style={{ fontSize: 'var(--font-11)', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                {g.title}
              </div>
              <div className="flex flex-col gap-1.5">
                {g.rows.map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-3">
                    <kbd
                      className="tnum shrink-0"
                      style={{
                        minWidth: 120,
                        fontSize: 'var(--font-11)',
                        color: 'var(--text-secondary)',
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '1px 8px',
                        textAlign: 'center',
                        fontFamily: 'inherit',
                      }}
                    >
                      {key}
                    </kbd>
                    <span style={{ fontSize: 'var(--font-12)', color: 'var(--text-primary)' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
