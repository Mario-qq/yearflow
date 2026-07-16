/** bar tooltip 悬停状态：进入 400ms 后出现，离开即消（SPEC 4.5） */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TOOLTIP_DELAY_MS } from '../constants';

export interface TooltipAnchor {
  taskId: string;
  x: number;
  y: number;
}

export function useBarTooltip(): {
  anchor: TooltipAnchor | null;
  onBarHover: (taskId: string | null, e?: { clientX: number; clientY: number }) => void;
} {
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const timerRef = useRef<number | null>(null);

  const onBarHover = useCallback(
    (taskId: string | null, e?: { clientX: number; clientY: number }) => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!taskId || !e) {
        setAnchor(null);
        return;
      }
      const { clientX, clientY } = e;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setAnchor({ taskId, x: clientX, y: clientY });
      }, TOOLTIP_DELAY_MS);
    },
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    },
    [],
  );

  return { anchor, onBarHover };
}
