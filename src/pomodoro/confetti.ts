/**
 * 到点庆祝的纸屑（canvas 现场绘制，不引任何库）。
 *
 * 三条让它不像「confetti 库默认效果」的做法：
 * · 每片是一张**会翻面的纸**：绕自身横轴翻转，正面亮、背面暗一档、宽度随翻转角收缩。
 *   平面小方块只会像塑料片。
 * · 两侧礼花筒斜射，不是从正中央炸开；每片有独立的空气阻力与左右飘摆。
 * · 颜色取自 tokens.css 的目标色令牌（跟随深浅主题），不写死十六进制。
 *
 * ⚠️ rAF 必须用**小窗自己的** window：主页面被最小化/遮挡时它的 rAF 会被节流甚至冻结，
 * 而这个小窗恰恰是那时唯一可见的东西 —— 用主窗的 rAF 会让庆祝卡在半空。
 *
 * ⚠️ 几何一律现量（canvas 是 inset:0 铺满小窗）：桌面版小窗是可任意拉伸的原生窗口，
 * 用 PIP_W/PIP_H 常量会让礼花筒在窗外、纸屑在半空消失。常量只作量不到时的兜底。
 */
import {
  CONFETTI_BACK_RATIO,
  CONFETTI_FADE_FROM,
  CONFETTI_FRAMES,
  CONFETTI_PER_CANNON,
  CONFETTI_TOKENS,
  PIP_H,
  PIP_W,
} from './constants';

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  tilt: number;
  spin: number;
  flip: number;
  flipV: number;
  drag: number;
  sway: number;
  swayV: number;
  front: string;
  back: string;
}

/** #rgb / #rrggbb → 压暗一档的 rgb()。令牌不是十六进制时原样返回（宁可不压暗也不画错色） */
function darken(hex: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const raw = m[1];
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  const n = parseInt(full, 16);
  const f = (shift: number): number =>
    Math.round(((n >> shift) & 0xff) * CONFETTI_BACK_RATIO);
  return `rgb(${f(16)}, ${f(8)}, ${f(0)})`;
}

/** 从小窗自己的根元素上读令牌：主题写在 <html data-theme>，小窗由 pip.ts 同步 */
function palette(root: Element): Array<[front: string, back: string]> {
  const cs = getComputedStyle(root);
  const out: Array<[string, string]> = [];
  for (const token of CONFETTI_TOKENS) {
    const front = cs.getPropertyValue(token).trim();
    if (front) out.push([front, darken(front)]);
  }
  return out.length > 0 ? out : [['#4a6ee0', '#2e4796']];
}

/**
 * 撒一次纸屑，返回取消函数（组件卸载 / 提醒被点掉时调用）。
 * 落完自动清空画布，不留常驻动效。
 */
export function burstConfetti(canvas: HTMLCanvasElement): () => void {
  const win = canvas.ownerDocument.defaultView;
  const ctx = canvas.getContext('2d');
  if (!win || !ctx) return () => {};
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const rect = canvas.getBoundingClientRect();
  const W = Math.round(rect.width) || PIP_W;
  const H = Math.round(rect.height) || PIP_H;
  const dpr = Math.min(2, win.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pal = palette(canvas.ownerDocument.documentElement);
  const bits: Bit[] = [];
  // 左下往右上、右下往左上：两筒对射，比正中央炸开自然得多
  const cannons: Array<[x: number, y: number, angle: number]> = [
    [6, H + 6, -Math.PI / 3.1],
    [W - 6, H + 6, -Math.PI + Math.PI / 3.1],
  ];
  for (const [ox, oy, base] of cannons) {
    for (let i = 0; i < CONFETTI_PER_CANNON; i++) {
      const a = base + (Math.random() - 0.5) * 0.52;
      const v = 7.4 + Math.random() * 4.2;
      const [front, back] = pal[(Math.random() * pal.length) | 0];
      const ribbon = Math.random() < 0.22; // 少量长纸条：尺寸不能全一样
      bits.push({
        x: ox,
        y: oy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: ribbon ? 2 + Math.random() * 1.4 : 3.4 + Math.random() * 3,
        h: ribbon ? 9 + Math.random() * 6 : 4 + Math.random() * 3.4,
        tilt: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.16,
        flip: Math.random() * Math.PI * 2,
        flipV: 0.13 + Math.random() * 0.16,
        drag: 0.975 + Math.random() * 0.016,
        sway: Math.random() * Math.PI * 2,
        swayV: 0.05 + Math.random() * 0.06,
        front,
        back,
      });
    }
  }

  let frame = 0;
  let raf = 0;
  const fadeFrom = CONFETTI_FRAMES * CONFETTI_FADE_FROM;
  const step = (): void => {
    ctx.clearRect(0, 0, W, H);
    const fade =
      frame < fadeFrom ? 1 : Math.max(0, 1 - (frame - fadeFrom) / (CONFETTI_FRAMES - fadeFrom));
    for (const b of bits) {
      b.sway += b.swayV;
      b.vx = b.vx * b.drag + Math.sin(b.sway) * 0.07;
      b.vy = b.vy * b.drag + 0.2;
      b.x += b.vx;
      b.y += b.vy;
      b.tilt += b.spin;
      b.flip += b.flipV;
      if (b.y > H + 18) continue;
      const face = Math.cos(b.flip);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.tilt);
      ctx.scale(1, Math.max(0.06, Math.abs(face))); // 翻到侧面时收成一条线
      ctx.fillStyle = face >= 0 ? b.front : b.back;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (++frame < CONFETTI_FRAMES) raf = win.requestAnimationFrame(step);
    else ctx.clearRect(0, 0, W, H);
  };
  raf = win.requestAnimationFrame(step);

  return () => {
    win.cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, W, H);
  };
}
