/** 任务状态的顺序/文案/颜色（左栏状态点、右键菜单、批量操作条、详情抽屉共用） */
import type { TaskStatus } from '../types/domain';

export const STATUS_ORDER: TaskStatus[] = ['planned', 'active', 'done', 'paused'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  planned: '计划中',
  active: '进行中',
  done: '已完成',
  paused: '已暂停',
};

export const STATUS_COLOR: Record<TaskStatus, string> = {
  planned: 'var(--text-disabled)',
  active: 'var(--accent)',
  done: 'var(--success)',
  paused: 'var(--warning)',
};
