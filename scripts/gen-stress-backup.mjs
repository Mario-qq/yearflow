/**
 * 生成 ANNUAL_SPEC §六 那份压力数据的备份 JSON：
 * **10 目标 × 8 任务 × 全年打卡 + 800 段会话**。
 *
 * 为什么走「备份 JSON + 产品自己的导入」而不是 `window.__store` 注入：
 * `__store` 只在 DEV 构建里暴露（`src/store/useStore.ts` 有 `import.meta.env.DEV` 守卫），
 * 而 §六 的门槛说的是**生产构建**。走导入这条路，数据真正落进 IndexedDB、
 * 经过 hydrate，测到的才是用户会遇到的那条首屏路径。
 *
 * 单独成文件（不内联进 perf 脚本）是为了能手动导进浏览器肉眼看这份数据长什么样。
 * 用法：node scripts/gen-stress-backup.mjs [输出路径]
 */
import { writeFileSync } from 'node:fs';

const YEAR = 2026;
const GOALS = 10;
const TASKS_PER_GOAL = 8;
const SESSIONS = 800;
const now = new Date(`${YEAR}-08-14T10:00:00.000Z`).toISOString();

/** 确定性伪随机：同一份种子每次跑出同一份数据，性能读数才可比 */
let seed = 20260814;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const goals = [];
const tasks = [];
const milestones = [];
const checkIns = [];
const focusSessions = [];

for (let g = 0; g < GOALS; g += 1) {
  const goalId = `stress-goal-${g}`;
  goals.push({
    id: goalId,
    name: `压力目标 ${g + 1}`,
    color: `goal-${(g % 10) + 1}`,
    icon: '🎯',
    order: g,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });

  for (let t = 0; t < TASKS_PER_GOAL; t += 1) {
    // 每目标 8 个任务铺满全年：起点按 t 均分，跨度 60~130 天，彼此重叠
    const startDay = Math.floor((t * 365) / TASKS_PER_GOAL);
    const span = 60 + ((g * 7 + t * 13) % 70);
    const s = new Date(YEAR, 0, 1 + startDay);
    const e = new Date(YEAR, 0, 1 + Math.min(364, startDay + span));
    tasks.push({
      id: `stress-task-${g}-${t}`,
      goalId,
      name: `任务 ${g + 1}-${t + 1}`,
      startDate: dstr(s),
      endDate: dstr(e),
      progress: (g * 11 + t * 7) % 101,
      progressMode: 'manual',
      status: pick(['planned', 'active', 'done', 'paused']),
      // 四种周期都占到：daily 最费（应打卡日最多），adhoc 用来喂 beat 3 的 noPlan 逃生阀
      recurrence:
        t % 4 === 0
          ? { type: 'daily' }
          : t % 4 === 1
            ? { type: 'weekdays' }
            : t % 4 === 2
              ? { type: 'custom', daysOfWeek: [1, 3, 5] }
              : { type: 'adhoc' },
      order: t,
      // 一半任务有基线（beat 6 才有漂移可排），另一半用来验「N 个任务没有基线」那行披露
      baseline:
        t % 2 === 0
          ? {
              startDate: dstr(new Date(YEAR, 0, 1 + Math.max(0, startDay - 5))),
              endDate: dstr(new Date(YEAR, 0, 1 + Math.min(364, startDay + span - 9))),
            }
          : undefined,
      updatedAt: now,
    });
  }

  milestones.push({
    id: `stress-ms-${g}`,
    goalId,
    name: `目标 ${g + 1} 里程碑`,
    date: `${YEAR}-${pad(1 + (g % 12))}-15`,
    achieved: g % 3 === 0,
    updatedAt: now,
  });
}

// 全年打卡：每天 × 每目标一条（今天之后不生成 —— 未来不可能有记录）
const TODAY = `${YEAR}-08-14`;
let ci = 0;
for (let day = 0; day < 365; day += 1) {
  const d = new Date(YEAR, 0, 1 + day);
  const date = dstr(d);
  if (date > TODAY) break;
  for (let g = 0; g < GOALS; g += 1) {
    // 每目标每天 ~70% 有记录：全打满不真实，也测不出缺卡那条路径
    if (rnd() > 0.7) continue;
    ci += 1;
    checkIns.push({
      id: `stress-ci-${ci}`,
      goalId: `stress-goal-${g}`,
      taskId: `stress-task-${g}-${day % TASKS_PER_GOAL}`,
      date,
      status: pick(['done', 'done', 'done', 'partial', 'skipped']),
      minutes: 20 + Math.floor(rnd() * 70),
      createdAt: now,
      updatedAt: now,
    });
  }
}

// 800 段专注会话，均匀铺在 1-1 ~ 8-14；一成不归属目标（喂 beat 1 的 unassignedMs 披露）
const spanDays = Math.round((new Date(TODAY) - new Date(`${YEAR}-01-01`)) / 86_400_000);
for (let i = 0; i < SESSIONS; i += 1) {
  const d = new Date(YEAR, 0, 1 + Math.floor((i / SESSIONS) * spanDays));
  const hour = [8, 9, 10, 14, 15, 20, 21, 22][i % 8];
  const startAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, (i * 7) % 60);
  const focusMs = (15 + ((i * 13) % 45)) * 60_000;
  focusSessions.push({
    id: `stress-fs-${i}`,
    goalId: i % 10 === 0 ? undefined : `stress-goal-${i % GOALS}`,
    date: dstr(d),
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + focusMs).toISOString(),
    focusMs,
    plannedMs: 25 * 60_000,
    outcome: i % 7 === 0 ? 'stopped' : 'completed',
    source: 'timer',
    createdAt: startAt.toISOString(),
    updatedAt: startAt.toISOString(),
  });
}

const backup = {
  app: 'yearflow',
  schemaVersion: 1,
  exportedAt: now,
  data: {
    goals,
    tasks,
    milestones,
    checkIns,
    // 免打卡区间：beat 8 的 idleDays 扣除逻辑与 expandScheduledDays 的扣除路径都要被走到
    exemptions: [
      {
        id: 'stress-ex-1',
        startDate: `${YEAR}-04-01`,
        endDate: `${YEAR}-04-10`,
        reason: '出差',
        updatedAt: now,
      },
    ],
    reviews: [],
    focusSessions,
  },
};

const out = process.argv[2] ?? 'docs/screenshots/annual/stress-backup.json';
writeFileSync(out, JSON.stringify(backup));
console.log(
  `写入 ${out}：${goals.length} 目标 / ${tasks.length} 任务 / ${checkIns.length} 打卡 / ${focusSessions.length} 会话`,
);
