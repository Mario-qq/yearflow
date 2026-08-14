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

  /*
   * 克隆里的 sticky 元素（表头行 / 左栏 / 左上角）**不需要手工补偿位移**：
   * stage 自己带 overflow:hidden ⇒ 它就是克隆的滚动祖先，且 scrollLeft/Top 恒为 0。
   * 内层 inner 把内容整体平移 -scrollLeft/-scrollTop 后，sticky 会自动把这三者
   * 吸回 stage 的左/上边 —— 正是我们要的位置。再叠一层 translate 反而把左栏推出画面
   * （实测：加了补偿的版本，导出图里整条左侧网格消失）。
   */
  const clone = content.cloneNode(true) as HTMLElement;

  /*
   * ⚠️ 交给 toCanvas 的节点**自身不能是 position:fixed 的离屏节点**，否则整张图全白。
   * html-to-image 把节点连同它的计算样式一起塞进 SVG <foreignObject>，`left:-100000px`
   * 在那个坐标系里照样生效 ⇒ 内容被推出画布，只剩背景色。
   * 所以拆成两层：host 负责 fixed 离屏，stage 静态（relative，给 inner 当定位祖先）负责被截。
   * 同一个坑与修法见 annual/exportLong.ts —— 那边先发现，这边照抄。
   */
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${vw}px`,
    zIndex: '-1',
  } satisfies Partial<CSSStyleDeclaration>);
  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'relative',
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
  host.appendChild(stage);
  document.body.appendChild(host);

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
    host.remove();
  }
}
