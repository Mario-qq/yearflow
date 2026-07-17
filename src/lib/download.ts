/** 文件下载工具：JSON 备份（设置页/命令面板共用）与 PNG 导出 */
import { useStore } from '../store/useStore';
import { buildBackupJSON } from './backup';
import { todayStr } from './date';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBackupJSON(): void {
  const s = useStore.getState();
  const json = buildBackupJSON(s.exportBundle(), s.settings);
  downloadBlob(new Blob([json], { type: 'application/json' }), `yearflow-backup-${todayStr()}.json`);
}
