/**
 * 初始种子数据（SPEC 第十一节）：2026 年 5 个目标 + 最近 45 天混合打卡。
 * 确定性伪随机（固定种子），同一天重复载入结果一致。
 * Goal.color 存 tokens.css 的色板键（goal-1..goal-5），UI 用 var(--goal-N) 解析。
 */
import type { CheckIn, Goal, Milestone, Task } from '../types/domain';
import type { DataBundle } from '../store/types';
import { dayjs, toDay } from '../lib/date';
import { expandScheduledDays } from '../lib/derive';

/** mulberry32：确定性 PRNG */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED_ID_PREFIX = 'seed-';

export function buildSeedBundle(today: string): DataBundle {
  const now = new Date().toISOString();
  const stamp = { createdAt: now, updatedAt: now };

  const goals: Goal[] = [
    { id: 'seed-goal-sap', name: 'SAP系统', color: 'goal-1', icon: '🧩', order: 0, archived: false, ...stamp },
    { id: 'seed-goal-english', name: '英语', color: 'goal-2', icon: '🗣️', order: 1, archived: false, ...stamp },
    { id: 'seed-goal-agent', name: 'AI Agent', color: 'goal-3', icon: '🤖', order: 2, archived: false, ...stamp },
    { id: 'seed-goal-pmp', name: 'PMP', color: 'goal-4', icon: '📖', order: 3, archived: false, ...stamp },
    { id: 'seed-goal-ball', name: '篮球', color: 'goal-5', icon: '🏀', order: 4, archived: false, ...stamp },
  ];

  const t = (partial: Omit<Task, 'progress' | 'progressMode' | 'status' | 'updatedAt'> & Partial<Task>): Task => ({
    progress: 0,
    progressMode: 'auto',
    status: 'active',
    updatedAt: now,
    ...partial,
  });

  const tasks: Task[] = [
    // SAP：四阶段 FS 依赖链，工作日打卡
    t({ id: 'seed-task-sap-1', goalId: 'seed-goal-sap', name: 'SAP 基础概念与导航', startDate: '2026-01-01', endDate: '2026-02-28', order: 0, recurrence: { type: 'weekdays' }, status: 'done', progress: 100 }),
    t({ id: 'seed-task-sap-2', goalId: 'seed-goal-sap', name: 'MM 模块', startDate: '2026-03-01', endDate: '2026-05-31', order: 1, recurrence: { type: 'weekdays' }, dependsOn: ['seed-task-sap-1'],
      // 预置基线：原计划 2/24 开始，实际推迟 5 天（演示基线对比）
      baseline: { startDate: '2026-02-24', endDate: '2026-05-24' }, status: 'done', progress: 100 }),
    t({ id: 'seed-task-sap-3', goalId: 'seed-goal-sap', name: 'SD 模块', startDate: '2026-06-01', endDate: '2026-08-31', order: 2, recurrence: { type: 'weekdays' }, dependsOn: ['seed-task-sap-2'] }),
    t({ id: 'seed-task-sap-4', goalId: 'seed-goal-sap', name: '综合项目实战', startDate: '2026-09-01', endDate: '2026-12-31', order: 3, recurrence: { type: 'weekdays' }, dependsOn: ['seed-task-sap-3'], status: 'planned' }),
    // 英语：全年每日 + 上半年词汇冲刺
    t({ id: 'seed-task-en-1', goalId: 'seed-goal-english', name: '每日听力+口语', startDate: '2026-01-01', endDate: '2026-12-31', order: 0, recurrence: { type: 'daily' } }),
    t({ id: 'seed-task-en-2', goalId: 'seed-goal-english', name: '词汇 8000 冲刺', startDate: '2026-01-01', endDate: '2026-06-30', order: 1, recurrence: { type: 'daily' }, status: 'done', progress: 100 }),
    // AI Agent：三阶段，二/四/六打卡
    t({ id: 'seed-task-ai-1', goalId: 'seed-goal-agent', name: 'LLM 基础与 Prompt 工程', startDate: '2026-01-01', endDate: '2026-03-31', order: 0, recurrence: { type: 'custom', daysOfWeek: [2, 4, 6] }, status: 'done', progress: 100 }),
    t({ id: 'seed-task-ai-2', goalId: 'seed-goal-agent', name: 'Agent 框架实践', startDate: '2026-04-01', endDate: '2026-07-31', order: 1, recurrence: { type: 'custom', daysOfWeek: [2, 4, 6] }, dependsOn: ['seed-task-ai-1'] }),
    t({ id: 'seed-task-ai-3', goalId: 'seed-goal-agent', name: '个人 Agent 项目', startDate: '2026-08-01', endDate: '2026-12-31', order: 2, recurrence: { type: 'custom', daysOfWeek: [2, 4, 6] }, dependsOn: ['seed-task-ai-2'], status: 'planned' }),
    // PMP：两阶段
    t({ id: 'seed-task-pmp-1', goalId: 'seed-goal-pmp', name: '教材精读', startDate: '2026-02-01', endDate: '2026-04-30', order: 0, recurrence: { type: 'weekdays' }, status: 'done', progress: 100 }),
    t({ id: 'seed-task-pmp-2', goalId: 'seed-goal-pmp', name: '刷题冲刺', startDate: '2026-05-01', endDate: '2026-06-30', order: 1, recurrence: { type: 'weekdays' }, dependsOn: ['seed-task-pmp-1'],
      // 预置基线：原计划 4/24~6/21，实际整体后移一周
      baseline: { startDate: '2026-04-24', endDate: '2026-06-21' }, status: 'done', progress: 100 }),
    // 篮球：全年一/三/六训练
    t({ id: 'seed-task-ball-1', goalId: 'seed-goal-ball', name: '常规训练', startDate: '2026-01-01', endDate: '2026-12-31', order: 0, recurrence: { type: 'custom', daysOfWeek: [1, 3, 6] } }),
  ];

  const milestones: Milestone[] = [
    { id: 'seed-ms-en', goalId: 'seed-goal-english', name: '雅思/托业模考', date: '2026-06-30', achieved: toDay(today).isAfter('2026-06-30'), updatedAt: now },
    { id: 'seed-ms-pmp', goalId: 'seed-goal-pmp', name: 'PMP 考试', date: '2026-07-04', achieved: toDay(today).isAfter('2026-07-04'), updatedAt: now },
  ];

  // 最近 45 天混合打卡：done/partial/skipped 都有，留白即 missed
  const rand = mulberry32(20260101);
  const from = dayjs(today).subtract(44, 'day').format('YYYY-MM-DD');
  const checkIns: CheckIn[] = [];
  const notes = ['状态不错', '有点累，少做了些', '出差路上', '效率很高', ''];
  for (const goal of goals) {
    const goalTasks = tasks.filter((task) => task.goalId === goal.id);
    for (const task of goalTasks) {
      const days = expandScheduledDays(task, [], today).filter((d) => d >= from);
      for (const date of days) {
        const roll = rand();
        let status: CheckIn['status'] | null = null;
        if (roll < 0.6) status = 'done';
        else if (roll < 0.75) status = 'partial';
        else if (roll < 0.85) status = 'skipped';
        // 其余 ~15% 留白 = missed
        if (!status) continue;
        // 今天留给用户自己打（演示"今天的点"描边态）
        if (date === today) continue;
        checkIns.push({
          id: `seed-ci-${task.id}-${date}`,
          goalId: goal.id,
          taskId: task.id,
          date,
          status,
          minutes: status === 'skipped' ? undefined : [15, 30, 60, 90][Math.floor(rand() * 4)],
          note: rand() < 0.15 ? notes[Math.floor(rand() * notes.length)] || undefined : undefined,
          createdAt: `${date}T21:00:00.000Z`,
          updatedAt: `${date}T21:00:00.000Z`,
        });
      }
    }
  }

  return { goals, tasks, milestones, checkIns, exemptions: [], reviews: [] };
}

/** 判断当前库是否是（或包含）示例数据（"清空示例数据"入口用） */
export function isSeedId(id: string): boolean {
  return id.startsWith(SEED_ID_PREFIX);
}
