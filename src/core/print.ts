// Woodblock printing primitives. A print is flat areas of colour, each from its own block, held
// together by the key block: thin Prussian-blue lines carved around every shape.
import { css, type RGB } from './color';

export type Pt = [number, number];
export type Ctx = CanvasRenderingContext2D;

/** Smooth path through points using midpoint quadratic curves. */
export function smoothPath(ctx: Ctx, pts: Pt[], closed = false) {
  const n = pts.length;
  if (n < 2) return;
  if (closed && n > 2) {
    const m = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = m(pts[n - 1], pts[0]);
    ctx.moveTo(s[0], s[1]);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = m(p, pts[(i + 1) % n]);
      ctx.quadraticCurveTo(p[0], p[1], q[0], q[1]);
    }
    ctx.closePath();
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
}

/** Straight-segment path, for polygons that are already finely sampled. */
export function polyPath(ctx: Ctx, pts: Pt[], closed = true) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

export function fillPoly(ctx: Ctx, pts: Pt[], col: RGB | string | CanvasGradient, alpha?: number) {
  ctx.fillStyle = Array.isArray(col) ? css(col as RGB, alpha) : (col as string | CanvasGradient);
  ctx.beginPath();
  polyPath(ctx, pts);
  ctx.fill();
}

/** A carved line from the key block. */
export function keyline(ctx: Ctx, pts: Pt[], w: number, col: RGB, alpha?: number, closed = false) {
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = w;
  ctx.strokeStyle = css(col, alpha);
  ctx.beginPath();
  smoothPath(ctx, pts, closed);
  ctx.stroke();
}

/**
 * Fill a group of shapes as one, with a single carved outline around their union: stroke every
 * shape at twice the line width first, then fill them all, so inner edges vanish under the fill.
 */
export function inkedUnion(ctx: Ctx, shapes: Pt[][], fill: RGB, line: RGB, w: number, dots: [number, number, number][] = []) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of shapes) polyPath(ctx, s);
  for (const [x, y, r] of dots) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
  ctx.lineWidth = w * 2;
  ctx.strokeStyle = css(line);
  ctx.stroke();
  ctx.fillStyle = css(fill);
  ctx.fill('nonzero');
}

/** Shift a polyline sideways along its normal by distance d (positive: right of travel, y-down). */
export function offset(pts: Pt[], d: number | ((i: number) => number)): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    const k = typeof d === 'number' ? d : d(i);
    return [p[0] - (ty / l) * k, p[1] + (tx / l) * k];
  });
}

/** Cumulative arc length along a polyline. */
export function arcLengths(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** Resample a polyline at a fixed spacing. */
export function resample(pts: Pt[], step: number): Pt[] {
  const L = arcLengths(pts), total = L[L.length - 1];
  const n = Math.max(2, Math.round(total / step) + 1), out: Pt[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (n - 1);
    while (j < L.length - 2 && L[j + 1] < s) j++;
    const t = (s - L[j]) / Math.max(1e-6, L[j + 1] - L[j]);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

export function bbox(pts: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
