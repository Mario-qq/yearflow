## 模块体检

- CheckInPage + checkin/* · ~1475 行 · 打卡页/卡片/补卡/免打卡 · polish · GoalCheckCard 449 行三套布局混写，分钟档与状态 UI 与 CheckinPopover 重复
- gantt/CheckinDots+Popover+HeatStrip · 478 行 · 甘特打卡点与热度 · polish · Popover 与打卡卡片重复实现编辑 UI
- derive/{scheduled,streak,heat,dayPanel} · 419 行 · 应打卡日/streak/热度/面板条目 · keep · 纯函数，单测充分
- derive/tracks · 154 行 · 轨道分组/聚合 · keep · 16 单测，可选参数保回归
- pomodoro 内核(kernel/running/ticker/chime) · ~960 行 · 计时/结算/多标签/提醒 · rework · 模块级可变状态、多标签机制在桌面版是包袱、内核无单测
- pomodoro UI + derive/focus · ~2300 行 · 面板/选择器/统计 · keep · focus.ts 54 单测
- pip 窗内(PipView/PipWindow/pip.css) · ~1250 行 · 小窗渲染 · polish · 网页/原生双路径分叉、hover 双轨
- electron/main.cts · 605 行 · 主窗+小窗几何状态机 · rework · ~400 行小窗逻辑与主窗混在一个文件，十余个全局变量

## 跨系统隐患
1. 小窗交互靠 Playwright 合成事件测不出，已连踩 3 次（关闭键、hover、药丸），e2e 全绿不代表真鼠标可用。
2. 计时状态在 localStorage、主进程缓存、IndexedDB 三处，桌面/网页两 origin 不共享，易出不一致。
3. 打卡编辑 UI 两份实现（打卡页 vs 甘特 popover），改规则要改两处。
4. 到点提醒、自动休息等核心路径 PROGRESS 自写「待用户真机过」，至今无闭环记录。
5. 番茄内核无单测，任何改动只能靠 e2e 兜底。
