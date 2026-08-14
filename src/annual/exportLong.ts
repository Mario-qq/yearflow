/**
 * 年报长图导出（规格 §4.5）：宽度固定 900 CSS px、scale 2、单张高度硬上限 20000 px。
 *
 * 三个必须这么做的理由：
 * 1. **不能直接光栅化页面上的那一列**：它带着 sticky 顶部条、未揭示的 beat（opacity 0）、
 *    以及 [看一眼]/[归档] 这些在图里点不了的按钮。所以走「克隆到离屏舞台」，
 *    与 gantt/lib/exportPng.ts 同一个套路：克隆是静态快照，随便改样式。
 * 2. **必须能分页**：900×2 = 1800 宽，1800×20000 = 36M px 已接近浏览器 canvas 的安全线，
 *    11 个 beat 在数据多时会超。超了就按 beat 边界切成多张 —— 只切在 beat 之间，
 *    绝不把一张图从中间劈开。
 * 3. **不能靠 CSS 的 @media print**：那是打印路径；导出走的是 html-to-image，
 *    看不到 print media，所以隐藏与揭示都要在克隆上用内联样式做一遍。
 *
 * ⚠️ 环境坑（docs/PROGRESS.md 已记）：html-to-image 的 resolve 包在 rAF 里，
 * 在 document.hidden === true 的窗口（本机浏览器面板）里会永挂。验证必须走
 * Playwright + 系统 Chrome（channel:'chrome'）。
 */
import { toCanvas } from 'html-to-image';
import { downloadBlob } from '../lib/download';
import { EXPORT_MAX_H, EXPORT_SCALE, EXPORT_W, PAGE_GAP } from './constants';

/** 舞台左右内边距，与页面上的 px-6 同值，长图边缘才不会顶到卡片 */
const STAGE_PAD = 24;
/** beat 之间的间距 = 页面上的 rowGap，长图的节奏才与屏幕上一致 */
const STAGE_GAP = PAGE_GAP;

/**
 * ⚠️ 交给 toCanvas 的那个节点**自身不能是 position:fixed 的离屏节点**，否则整张图全白。
 * html-to-image 把节点连同它的计算样式一起塞进 SVG <foreignObject>，`left:-100000px`
 * 在那个坐标系里照样生效 ⇒ 内容被推出画布，只剩背景色。
 * 实测：同一个 beat，直接截 fixed 舞台得到 0 个非背景像素，套一层壳后 19.6 万个。
 * 所以是「外壳 fixed 负责离屏，内层 stage 静态定位负责被截」。
 */
function makeStage(bg: string): { host: HTMLDivElement; stage: HTMLDivElement } {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${EXPORT_W}px`,
    zIndex: '-1',
  } satisfies Partial<CSSStyleDeclaration>);
  const stage = document.createElement('div');
  Object.assign(stage.style, {
    width: `${EXPORT_W}px`,
    padding: `${STAGE_PAD}px`,
    boxSizing: 'border-box',
    background: bg,
    display: 'flex',
    flexDirection: 'column',
    gap: `${STAGE_GAP}px`,
  } satisfies Partial<CSSStyleDeclaration>);
  host.append(stage);
  return { host, stage };
}

function makeHeading(caption: string, page: number, pages: number): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    color: 'var(--text-tertiary)',
    fontSize: 'var(--font-12)',
  } satisfies Partial<CSSStyleDeclaration>);
  const left = document.createElement('span');
  left.style.color = 'var(--text-primary)';
  left.style.fontSize = 'var(--font-16)';
  left.style.fontWeight = '600';
  left.textContent = 'YearFlow 年报';
  const mid = document.createElement('span');
  mid.textContent = caption;
  el.append(left, mid);
  if (pages > 1) {
    const right = document.createElement('span');
    right.style.marginLeft = 'auto';
    right.textContent = `第 ${page} / ${pages} 张`;
    el.append(right);
  }
  return el;
}

/** 克隆一个 beat 并把它修成「导出态」：强制揭示、去掉图里点不了的按钮 */
function cloneBeat(el: Element): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  c.classList.add('is-shown');
  c.style.opacity = '1';
  c.style.transform = 'none';
  c.style.transition = 'none';
  for (const n of c.querySelectorAll('[data-annual-noprint]')) n.remove();
  return c;
}

async function renderPage(
  beats: Element[],
  caption: string,
  page: number,
  pages: number,
  bg: string,
  filename: string,
): Promise<void> {
  const { host, stage } = makeStage(bg);
  stage.append(makeHeading(caption, page, pages));
  for (const b of beats) stage.append(cloneBeat(b));
  document.body.append(host);
  try {
    const canvas = await toCanvas(stage, { pixelRatio: EXPORT_SCALE, backgroundColor: bg });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 返回空'))), 'image/png');
    });
    downloadBlob(blob, filename);
  } finally {
    host.remove();
  }
}

export interface ExportResult {
  /** 实际导出的张数（>1 表示触到了单张高度上限，已按 beat 边界分页） */
  pages: number;
  /** 未分页时的总高度（CSS px），供日志与断言 */
  totalHeight: number;
}

/**
 * 导出年报长图。root = 叙事列容器（含 .annual-beat 若干）。
 * caption 例：「2026 · 全年 · 统计截至 8 月 14 日」。
 */
export async function exportAnnualPng(
  root: HTMLElement,
  caption: string,
  baseName: string,
): Promise<ExportResult> {
  const beats = [...root.querySelectorAll('.annual-beat')];
  if (beats.length === 0) return { pages: 0, totalHeight: 0 };
  const bg = getComputedStyle(document.body).backgroundColor;

  // 先在离屏量一次真高：页面上的 beat 宽度未必是 900，量在导出宽度下才作数
  const { host: probeHost, stage: probe } = makeStage(bg);
  probe.append(makeHeading(caption, 1, 1));
  for (const b of beats) probe.append(cloneBeat(b));
  document.body.append(probeHost);
  const heights = [...probe.children].map((c) => (c as HTMLElement).offsetHeight);
  const totalHeight = probe.offsetHeight;
  probeHost.remove();

  const headH = heights[0];
  const beatH = heights.slice(1);

  if (totalHeight <= EXPORT_MAX_H) {
    await renderPage(beats, caption, 1, 1, bg, `${baseName}.png`);
    return { pages: 1, totalHeight };
  }

  // 超上限：按 beat 边界贪心分组。单个 beat 自己就超上限时独占一页（切开它更糟）
  const groups: Element[][] = [];
  let cur: Element[] = [];
  let curH = headH + STAGE_PAD * 2;
  beats.forEach((b, i) => {
    const h = beatH[i] + STAGE_GAP;
    if (cur.length > 0 && curH + h > EXPORT_MAX_H) {
      groups.push(cur);
      cur = [];
      curH = headH + STAGE_PAD * 2;
    }
    cur.push(b);
    curH += h;
  });
  if (cur.length > 0) groups.push(cur);

  for (const [i, g] of groups.entries()) {
    await renderPage(g, caption, i + 1, groups.length, bg, `${baseName}-${i + 1}of${groups.length}.png`);
  }
  return { pages: groups.length, totalHeight };
}
