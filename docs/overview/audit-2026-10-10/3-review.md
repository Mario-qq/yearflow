# 模块体检（review / yearreport / settings）

- ReviewPage + review/* · 1175 行 · 月度复盘与年度总览 · polish · Card 三处重复、年度视图不能换年、笔记卸载丢字
- derive/review.ts · 114 行 · 复盘派生 · keep · 复用 scheduled/focus 口径，5 测
- YearReportPage + annual/* · 3277 行 · 11 段叙事/导出/打印 · keep · 单一 annualIndex 入口，几何常量集中
- derive/annual.ts · 735 行 · 年报派生 · keep · 13 个纯函数 40 测，口径零复制
- SettingsPage · 246 行 · 设置与数据操作 · polish · 直连 Dexie，示例/清空按钮有误删风险
- backup.ts · 231 行 · JSON 备份 · polish · 手写 zod 无类型护栏
- theme/toast/Toasts/tokens · 255 行 · 主题与提示 · keep · 小而单一
- App.tsx · 266 行 · 外壳+全局初始化+快捷键 · polish · 职责偏多

## 跨系统隐患
1. 导入备份、载入示例、清空数据都走墓碑式 replaceAllData，登录状态下删除会同步到所有设备，确认框没有说明。
2. backup.ts 的 zod schema 与 domain.ts 是两份手写定义，加字段漏改不会报错，已出过两次事。
3. 移动断点散在四处（useIsMobile、annual/constants、annual.css、App.tsx HomeRedirect），只靠注释保持一致。
4. 复盘、年报、导出都只有 Playwright 自查，年报年底才真正用到；Electron 下的 a.download 导出路径没人验过。
5. 页面大量用内联 style 加字面量（3600000、SVG 坐标、borderRadius 999），Card/按钮样式各页各抄一份，偏离「只用令牌/常量」的约定。
