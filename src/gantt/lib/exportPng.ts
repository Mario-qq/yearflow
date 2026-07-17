/**
 * 当前视图导出 PNG（SPEC 4.6，含左侧网格）。
 *
 * 不能对整棵 content 直接 toCanvas：周档 totalWidth≈20440px，×2 像素密度超出
 * Chrome canvas 单边上限（32767），光栅化会挂死。改为：克隆 content 到离屏
 * 「舞台」（视口大小、overflow hidden、整体平移 -scrollLeft/-scrollTop），并给
 * 克隆中的 sticky 元素（表头行/左栏/左上角）加 transform 补偿——克隆是静态快照，
 * 不受 sticky 祖先禁 transform 铁律约束。最终只光栅化视口大小的画布，快且小。
 */
import { toCanvas } from 'html-to-image';
import { downloadBlob } from '../../lib/download';
import { todayStr } from '../../lib/date';

const PIXEL_RATIO = 2;

export async function exportGanttPng(scroller: HTMLDivElement): Promise<void> {
  const content = scroller.firstElementChild as HTMLElement | null;
  if (!content) return;
  const vw = scroller.clientWidth;
  const vh = scroller.clientHeight;
  const sl = scroller.scrollLeft;
  const st = scroller.scrollTop;
  const bg = getComputedStyle(document.body).backgroundColor;

  const clone = content.cloneNode(true) as HTMLElement;
  // 结构（与 GanttView 对应）：content > [表头行(sticky top) > 角块(sticky left), body(flex) > 左栏(sticky left)]
  const headerRow = clone.children[0] as HTMLElement | undefined;
  const corner = headerRow?.children[0] as HTMLElement | undefined;
  const bodyRow = clone.children[1] as HTMLElement | undefined;
  const leftGrid = bodyRow?.children[0] as HTMLElement | undefined;
  if (headerRow) headerRow.style.transform = `translateY(${st}px)`;
  if (corner) corner.style.transform = `translateX(${sl}px)`;
  if (leftGrid) leftGrid.style.transform = `translateX(${sl}px)`;

  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${vw}px`,
    height: `${vh}px`,
    overflow: 'hidden',
    background: bg,
  } satisfies Partial<CSSStyleDeclaration>);
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    position: 'absolute',
    left: `${-sl}px`,
    top: `${-st}px`,
  } satisfies Partial<CSSStyleDeclaration>);
  inner.appendChild(clone);
  stage.appendChild(inner);
  document.body.appendChild(stage);

  try {
    const canvas = await toCanvas(stage, { pixelRatio: PIXEL_RATIO, backgroundColor: bg });
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('toBlob 返回空'));
          return;
        }
        downloadBlob(blob, `yearflow-gantt-${todayStr()}.png`);
        resolve();
      }, 'image/png');
    });
  } finally {
    stage.remove();
  }
}
