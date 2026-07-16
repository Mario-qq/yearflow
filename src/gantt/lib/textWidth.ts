/**
 * 离屏 canvas 文本测宽 —— bar 标签「放得下放里面、放不下溢出到右侧外部」的判定依据。
 * 按 (font, text) 缓存；字体取 body 的计算字体族（与实际渲染一致）。
 */
import { BAR_LABEL_FONT } from '../constants';

let ctx: CanvasRenderingContext2D | null = null;
let labelFont: string | null = null;
const cache = new Map<string, number>();

function barLabelFont(): string {
  if (!labelFont) {
    const family =
      typeof document !== 'undefined'
        ? getComputedStyle(document.body).fontFamily || 'sans-serif'
        : 'sans-serif';
    labelFont = `${BAR_LABEL_FONT}px ${family}`;
  }
  return labelFont;
}

/** bar 标签渲染宽度（px）；canvas 不可用时按每字符一个字号兜底 */
export function barLabelWidth(text: string): number {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  let width: number;
  if (ctx) {
    ctx.font = barLabelFont();
    width = ctx.measureText(text).width;
  } else {
    width = text.length * BAR_LABEL_FONT;
  }
  cache.set(text, width);
  return width;
}
