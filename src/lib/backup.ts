/**
 * JSON 一键导出/导入（SPEC 第二节）：导入前 schema 校验与版本迁移。
 * 导出物 = 全库数据 + 设置，作为云同步之外的兜底备份。
 */
import { z } from 'zod';
import type { AppSettings } from '../types/domain';
import type { DataBundle } from '../store/types';

export const BACKUP_SCHEMA_VERSION = 1;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期须为 YYYY-MM-DD');

const recurrenceSchema = z.object({
  type: z.enum(['daily', 'weekdays', 'custom']),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
});

const goalSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string(),
  icon: z.string().optional(),
  order: z.number(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const taskSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  name: z.string(),
  startDate: dateStr,
  endDate: dateStr,
  progress: z.number().min(0).max(100),
  progressMode: z.enum(['manual', 'auto']),
  status: z.enum(['planned', 'active', 'done', 'paused']),
  note: z.string().optional(),
  recurrence: recurrenceSchema.optional(),
  order: z.number(),
  dependsOn: z.array(z.string()).optional(),
  baseline: z.object({ startDate: dateStr, endDate: dateStr }).optional(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const milestoneSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  name: z.string(),
  date: dateStr,
  achieved: z.boolean(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const checkInSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().optional(),
  date: dateStr,
  status: z.enum(['done', 'partial', 'skipped']),
  minutes: z.number().optional(),
  note: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const exemptionSchema = z.object({
  id: z.string().min(1),
  startDate: dateStr,
  endDate: dateStr,
  goalIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const reviewSchema = z.object({
  id: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, '月份须为 YYYY-MM'),
  content: z.string(),
  rating: z.number().min(1).max(5).optional(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const ganttViewSchema = z.object({
  zoom: z.enum(['year', 'quarter', 'month', 'week']),
  scrollDate: dateStr.or(z.literal('')), // 空 = 从未记录（首次进甘特页滚到今日线）
  collapsedGoalIds: z.array(z.string()),
  gridColumns: z.array(z.string()),
  gridWidth: z.number(),
  // Phase 3 新增：老备份缺省时补默认值
  gridCollapsed: z.boolean().default(false),
  gridColWidths: z.record(z.string(), z.number()).default({}),
  showDependencies: z.boolean(),
  showBaseline: z.boolean(),
  filter: z.object({
    status: z.array(z.enum(['planned', 'active', 'done', 'paused'])).optional(),
    goalIds: z.array(z.string()).optional(),
    hideOthers: z.boolean().optional(),
  }),
});

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  yearInView: z.number().int(),
  ganttView: ganttViewSchema,
});

const backupSchema = z.object({
  app: z.literal('yearflow'),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  data: z.object({
    goals: z.array(goalSchema),
    tasks: z.array(taskSchema),
    milestones: z.array(milestoneSchema),
    checkIns: z.array(checkInSchema),
    exemptions: z.array(exemptionSchema),
    reviews: z.array(reviewSchema),
  }),
  settings: settingsSchema.optional(),
});

export type BackupFile = z.infer<typeof backupSchema>;

export function buildBackupJSON(data: DataBundle, settings: AppSettings): string {
  const backup: BackupFile = {
    app: 'yearflow',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    settings,
  };
  return JSON.stringify(backup, null, 2);
}

/** 版本迁移钩子：老版本备份在校验前逐级升级到当前 schema */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > BACKUP_SCHEMA_VERSION) {
    throw new Error(`备份文件版本(${version})比当前应用(${BACKUP_SCHEMA_VERSION})更新，请先升级应用`);
  }
  // 未来出现 v2 时在此处补 v1→v2 转换
  return raw;
}

export interface ParsedBackup {
  data: DataBundle;
  settings?: AppSettings;
  exportedAt: string;
}

/** 解析并校验备份 JSON；不合法时抛出带可读信息的 Error */
export function parseBackupJSON(json: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('文件不是合法的 JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('备份内容格式不正确');
  const migrated = migrate(raw as Record<string, unknown>);
  const result = backupSchema.safeParse(migrated);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`备份校验失败：${first?.path.join('.')} ${first?.message}`);
  }
  const { data, settings, exportedAt } = result.data;
  return { data, settings, exportedAt };
}
