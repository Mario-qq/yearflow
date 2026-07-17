/**
 * 原生 pointer 拖拽内核（SPEC 技术栈铁律：不用 dnd 库）。
 * 统一处理：3px 阈值、pointer capture、Esc 取消、cancel/blur 兜底。
 * bar 移动/resize、里程碑拖动、框选新建、（批次C）多选框选全部走这里。
 */
import { DRAG_THRESHOLD } from '../constants';

export interface DragSession {
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  /** 已越过阈值进入拖拽 */
  started: boolean;
}

export interface DragOptions {
  threshold?: number;
  /** 首次越过阈值 */
  onStart?: (s: DragSession) => void;
  /** 每次 pointermove（仅 started 后） */
  onMove?: (s: DragSession) => void;
  /**
   * 结束：committed=false 表示 Esc 取消。
   * 未越过阈值的 pointerup（= 单击）也会回调，started=false。
   */
  onEnd: (s: DragSession, committed: boolean) => void;
}

export function startPointerDrag(
  e: { pointerId: number; clientX: number; clientY: number; currentTarget: EventTarget | null },
  opts: DragOptions,
): void {
  const el = e.currentTarget as HTMLElement | null;
  if (!el) return;
  const threshold = opts.threshold ?? DRAG_THRESHOLD;
  const s: DragSession = {
    startClientX: e.clientX,
    startClientY: e.clientY,
    clientX: e.clientX,
    clientY: e.clientY,
    started: false,
  };

  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // 指针已释放（或合成事件）时无法捕获：放弃拖动跟踪，退化为点击
  }

  let finished = false;
  const finish = (committed: boolean) => {
    if (finished) return;
    finished = true;
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // 已释放
    }
    opts.onEnd(s, committed);
  };

  const onMove = (ev: PointerEvent) => {
    s.clientX = ev.clientX;
    s.clientY = ev.clientY;
    if (!s.started) {
      if (
        Math.abs(ev.clientX - s.startClientX) < threshold &&
        Math.abs(ev.clientY - s.startClientY) < threshold
      ) {
        return;
      }
      s.started = true;
      opts.onStart?.(s);
    }
    opts.onMove?.(s);
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      finish(false);
    }
  };

  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}
