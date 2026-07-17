/**
 * 左侧任务网格列定义（SPEC 4.3）。
 * 默认列：名称/起止/进度/状态；可选列：应打卡完成率/偏移天数。
 * 名称列 flex 撑满剩余空间，其余列固定宽（可拖调，覆盖值存 settings.ganttView.gridColWidths）。
 */

export type GridColumnKey = 'name' | 'dates' | 'progress' | 'status' | 'checkRate' | 'offset';

export interface GridColumnDef {
  key: GridColumnKey;
  label: string;
  /** 0 = flex 撑满（仅名称列） */
  width: number;
  minWidth: number;
  /** 可选列：默认不显示，经列菜单开启 */
  optional?: boolean;
}

export const GRID_COLUMN_DEFS: GridColumnDef[] = [
  { key: 'name', label: '名称', width: 0, minWidth: 96 },
  { key: 'dates', label: '起止', width: 92, minWidth: 72 },
  { key: 'progress', label: '进度', width: 80, minWidth: 56 },
  { key: 'status', label: '状态', width: 36, minWidth: 32 },
  { key: 'checkRate', label: '打卡率', width: 56, minWidth: 44, optional: true },
  { key: 'offset', label: '偏移', width: 48, minWidth: 40, optional: true },
];

/** 可见列（按定义顺序；名称列常显） */
export function visibleColumns(gridColumns: string[]): GridColumnDef[] {
  return GRID_COLUMN_DEFS.filter((d) => d.key === 'name' || gridColumns.includes(d.key));
}

/** 列实际宽度：覆盖值 clamp 到 minWidth 以上 */
export function columnWidth(def: GridColumnDef, overrides: Record<string, number>): number {
  const w = overrides[def.key] ?? def.width;
  return Math.max(def.minWidth, w);
}
