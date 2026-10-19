/** 重要日子进了 14 天窗口 ⇒ 自动倒推生成准备待办（工作台、人际页打开时与跨午夜时各判一次） */
import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { generatePreps } from '../store/peopleActions';
import { showToast } from '../lib/toast';

export function usePrepGeneration(today: string): void {
  const people = useStore((s) => s.people);
  const hydrated = useStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) return;
    const r = generatePreps(today);
    if (r.count) showToast(`快到${r.titles.join('、')}了：在工作台排了 ${r.count} 件准备`);
  }, [today, people, hydrated]);
}
