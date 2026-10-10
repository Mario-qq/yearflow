# 底座体检（data / store / derive / eng）

## 模块体检
- **data**：Dexie 两版 schema、BaseRepo 统一软删除与刷新 updatedAt，结构干净。缺口有两处：关窗前不强制落盘（persist.ts 只有 500ms 防抖）；加一张表要手改约 8 处。clearAllData / restore / getByGoalAndRange 全仓无调用，且会物理删数据，应删除。
- **store**：execute → Change(before/after) → 反转撤销，模型优雅。actions.ts 有 766 行、横跨 8 个领域，三条级联删除路径重复，零单测。
- **derive**：纯函数、单测密，是最健康的一层。annual 移出 barrel 属于靠注释维持的例外。
- **eng**：本次实跑 225/225 测试、tsc、oxlint 全绿；性能有生产构建实测记录，但缩放门槛口径不清。CI 部署前不跑测试，也没有自动备份。

## 跨系统隐患
1. **撤销 × 云同步**：applyRemote 不碰 undo 栈（useStore.ts:192）。之后撤销会用旧 before 盖掉另一台设备的新改动，并推上云端。
2. **关窗丢最后 0.5 秒**：store 与 settings 都没有 pagehide/hidden 时的 flush，Electron 关窗、手机划掉 PWA 时会丢掉这段改动。
3. **加表漏注册不报错**：TABLE_NAMES、hydrate、repoByTable、backup zod、同步三循环各自维护。漏一处表现为「不同步 / 不导出 / 墓碑分叉」。
4. **级联删除三份实现**：漏改会产生孤儿专注会话，投入时长还在算，UI 上却找不到（actions.ts:713 自述）。
5. **未提交的 0003 迁移**：supabase/migrations/0003_card_api.sql 与 harmony/ 还在工作区，云端结构可能已与仓库不一致。

## 架构总评
分层清晰：UI → actions → store.execute → persist → repos → Dexie，sync 引擎旁路读写 Dexie，派生层纯函数。底座整体健康，主要债务集中在「注册表散落」和「store 写入层」。

| # | 结构债 | 人日 | 时机 |
|---|---|---|---|
| 1 | 表注册收敛为一份元数据（schema / types / TABLE_NAMES / hydrate / repo / zod 统一驱动） | 1.5 | 下次加表前做 |
| 2 | 拆分 actions.ts 并抽出共用级联函数，补单测 | 2 | 下次大改前做 |
| 3 | undo 栈与 applyRemote 冲突处理 + pagehide 落盘 | 1 | 下次大改前做 |
| 4 | store/persist/sync 引擎集成测试（fake-indexeddb） | 2 | 之后做 |
| 5 | CI 加测试/lint 门 + 自动备份 + 主包瘦身 | 1.5 | 之后做 |
