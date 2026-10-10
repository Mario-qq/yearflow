# 甘特图 · 模块体检

- 时间轴（timeScale 252/useZoomAnimation 240/useViewport 172/TimelineHeader 220/MiniMap 178）· 坐标与缩放 · keep · 纯函数有单测，常量集中
- GanttView 787 · 整体编排 · rework · 筛选、聚焦、快捷键、bus、右键分流全内联
- 任务条（TaskBar 212/useBarDrag 246/dragCore 95/DependencyLayer 203/rowLayout 186）· 渲染与拖拽 · keep · 拖拽只改 transform
- LeftGrid 1005 · 左栏 · rework · 五种行+两套重复重排
- TaskDrawer 444/ContextMenu 405 · 详情与菜单 · polish · 大组件、原生 confirm
- 效率工具（BulkBar/FilterMenu/CommandPalette 269/exportPng 83/uiStore 129）· polish · 小缺陷

## 跨系统隐患
1. 手机只读漏网：里程碑单击/拖动、依赖线单击删除未屏蔽，误触会同步回电脑。
2. 删除确认用原生 confirm() 散落 6 处，Electron 下未验证。
3. 导出用 `<a download>`，Electron 无 will-download 处理，桌面导出未验证。
4. 跨页定位靠 setTimeout 80/150/220ms 赌挂载，年报已改闩锁。
5. 交互层零自动化测试，单测只覆盖 timeScale/rowLayout/derive。
