// Hokusai's marks, as procedures. Everything in the print is built from a few of them:
//
//  - a lobed edge: where blue water meets white foam, the blue rises in rounded fingers that lean
//    forward with the wave, and white foam fingers drip back down into the blue;
//  - a talon: a finger of foam that curls over at its end, outlined underneath by a dark hook,
//    with a pale-indigo shadow behind it. Big talons split into smaller ones, like a claw;
//  - strands: long slivers of lighter blue running with the water inside the dark body;
//  - flecks: white spots of foam scattered over the blue.
//
// Each mark is cut into the block of one ink. A wave is printed by laying its blocks down in
// order, so the marks of one ink always join into a single impression.

import { css, type RGB } from '../core/color';
import { Path } from '../core/curve';
import { clamp, lerp } from '../core/math';
import { polyPath, type Ctx, type Pt } from '../core/print';
import { Rng } from '../core/rng';

export type Ink = 'paper' | 'aqua' | 'blue' | 'deep' | 'key' | 'shade' | 'boat' | 'boatDark' | 'cloth' | 'skin' | 'hair' | 'snow';
export type Palette = Record<Ink, RGB>;

/** One impression: shapes filled in one ink, or polylines stroked in it. */
export interface Layer { ink: Ink; fill?: Pt[][]; line?: { pts: Pt[]; w: number }[]; alpha?: number; }

export function paintLayers(ctx: Ctx, layers: Layer[], pal: Palette) {
  for (const l of layers) {
    const col = css(pal[l.ink], l.alpha);
    if (l.fill?.length) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (const s of l.fill) if (s.length > 2) polyPath(ctx, s);
      ctx.fill('nonzero');
    }
    if (l.line?.length) {
      ctx.strokeStyle = col;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const { pts, w } of l.line) {
        if (pts.length < 2) continue;
        ctx.lineWidth = w;
        ctx.beginPath();
        polyPath(ctx, pts, false);
        ctx.stroke();
      }
    }
  }
}

/** A lobe or finger tip on an edge: where it is, the way the edge runs, and outward from the edge. */
export interface Tip { p: Pt; t: Pt; n: Pt; size: number; }

export interface LobeOpts {
  /** Distance between fingers, and how far they reach. */
  period: number; amp: number;
  /** +1: fingers rise to the right of the path's direction (screen), -1: to its left. */
  side: 1 | -1;
  /** Below 1, fat round tips with pinched valleys; above 1, thin fingers. */
  sharp?: number;
  /** How far each finger leans forward along the path, as a share of its reach. */
  lean?: number;
  /** How much the reach of each finger varies, 0..1. */
  vary?: number;
}

/**
 * The edge from fraction a to b of a path, pushed out into fingers. Returns the edge and the tip
 * of each finger, where foam talons can grow.
 */
export function lobed(path: Path, a: number, b: number, o: LobeOpts, rng: Rng): { edge: Pt[]; tips: Tip[] } {
  const span = Math.abs(b - a) * path.total, n = Math.max(2, Math.ceil(span / 2.5));
  const sharp = o.sharp ?? 0.7, lean = o.lean ?? 0.35, vary = o.vary ?? 0.5;
  const reach: number[] = [];
  const count = Math.ceil(span / o.period) + 2;
  for (let k = 0; k < count; k++) reach.push(o.amp * (1 - vary + vary * rng.random() * 1.6));
  // Fingers are spaced unevenly too.
  const marks: number[] = [0];
  for (let k = 1; k < count + 1; k++) marks.push(marks[k - 1] + o.period * (0.7 + rng.random() * 0.6));
  const dir = Math.sign(b - a) || 1;
  const at = (s: number, k: number): { q: Pt; t: Pt; n: Pt; ends: number } => {
    const f = a + (b - a) * (s / span), ph = (s - marks[k]) / (marks[k + 1] - marks[k]);
    // Fade the fingers in and out at the ends so the edge joins whatever it continues.
    const ends = clamp(Math.min(s, span - s) / (o.period * 0.6), 0, 1);
    const d = reach[k] * Math.pow(Math.max(0, Math.sin(Math.PI * ph)), sharp) * ends;
    const p = path.at(f), t = path.dir(f), nr = path.normal(f);
    const nx = nr[0] * o.side, ny = nr[1] * o.side;
    return { q: [p[0] + nx * d + t[0] * dir * d * lean, p[1] + ny * d + t[1] * dir * d * lean], t: [t[0] * dir, t[1] * dir], n: [nx, ny], ends };
  };
  const edge: Pt[] = [], tips: Tip[] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * span;
    while (k < marks.length - 2 && marks[k + 1] < s) k++;
    edge.push(at(s, k).q);
  }
  for (let j = 0; j < marks.length - 1; j++) {
    const s = (marks[j] + marks[j + 1]) / 2;
    if (s > span) break;
    const e = at(s, j);
    if (e.ends > 0.6) tips.push({ p: e.q, t: e.t, n: e.n, size: reach[j] });
  }
  return { edge, tips };
}

/** The three blocks a talon prints in: its pale shadow, its white body and its dark hook. */
export interface Talons { halo: Pt[][]; body: Pt[][]; hook: Pt[][]; }
export const talons = (): Talons => ({ halo: [], body: [], hook: [] });

/**
 * A talon of foam from (x, y), heading `ang`, curling round by `curl` radians at its end, toward
 * the screen's clockwise if `turn` is +1. Bigger ones split at the end into smaller talons.
 */
export function talon(out: Talons, rng: Rng, x: number, y: number, ang: number, len: number, wid: number, turn: number, curl: number, depth = 1) {
  const n = Math.max(12, Math.min(40, Math.round(len / 3))), px: number[] = [], py: number[] = [], hd: number[] = [];
  let cx = x, cy = y;
  for (let i = 0; i <= n; i++) {
    // The curl gathers toward the end, so the finger reaches out and then rolls over.
    const t = i / n, a = ang + turn * curl * Math.pow(t, 2);
    px.push(cx); py.push(cy); hd.push(a);
    cx += Math.cos(a) * len / n;
    cy += Math.sin(a) * len / n;
  }
  // Swelling a little toward the end, then rounding off at the tip.
  const half = (t: number) => wid * 0.5 * (0.6 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.2))) * Math.pow(Math.max(0, 1 - t), 0.4);
  /** Points offset from the spine by d(t) toward side k (+1 right of travel, -1 left), from t0 to t1. */
  const edge = (k: number, d: (t: number) => number, t0 = 0, t1 = 1): Pt[] => {
    const o: Pt[] = [];
    for (let i = Math.round(t0 * n); i <= Math.round(t1 * n); i++) {
      const t = i / n, a = hd[i], dd = d(t) * k;
      o.push([px[i] - Math.sin(a) * dd, py[i] + Math.cos(a) * dd]);
    }
    return o;
  };
  const outer = -turn, inner = turn;
  // The pale shadow sits inside the curl, fuller than the finger.
  out.halo.push(edge(inner, (t) => half(t) * 0.2, 0, 0.62).concat(edge(inner, (t) => half(t) + wid * 0.5 * Math.sin(Math.PI * Math.min(1, t / 0.62)), 0, 0.62).reverse()));
  out.body.push(edge(1, half).concat(edge(-1, half).reverse()));
  // The dark hook: a line along the outside of the curl that thickens and wraps round the tip.
  const h0 = Math.max(0.15, 1 - 26 / Math.max(1, len)), hw = Math.min(wid * 0.26, 3.6);
  const th = (t: number) => hw * Math.pow(Math.sin(Math.PI * clamp((t - h0) / (1.04 - h0), 0, 1)), 0.6);
  out.hook.push(edge(outer, half, h0).concat(edge(outer, (t) => half(t) + th(t), h0).reverse()));
  if (depth > 0 && len > 14) {
    const kids = depth > 1 ? rng.int(2, 3) : rng.int(1, 2);
    for (let j = 0; j < kids; j++) {
      const i = Math.round(n * rng.range(depth > 1 ? 0.35 : 0.3, 0.7)), a = hd[i], d = half(i / n) * 0.7 * outer;
      talon(out, rng, px[i] - Math.sin(a) * d, py[i] + Math.cos(a) * d, a - turn * rng.range(0.5, 1.1) * (0.6 + j * 0.4),
        len * rng.range(0.32, 0.5), wid * 0.72, turn, curl * rng.range(1, 1.3), depth - 1);
    }
  }
}

/** Grow talons from the tips of a lobed edge, leaning forward along it and curling over. */
export function talonsOnTips(out: Talons, rng: Rng, tips: Tip[], size: number, turn: number, o: { curl?: number; lift?: number; every?: number; depth?: number } = {}) {
  const lift = o.lift ?? 0.6, every = o.every ?? 1;
  for (const tip of tips) {
    if (!rng.chance(every)) continue;
    const s = size * rng.range(0.75, 1.25);
    const dx = tip.t[0] + tip.n[0] * lift, dy = tip.t[1] + tip.n[1] * lift;
    talon(out, rng, tip.p[0] - tip.n[0] * s * 0.15, tip.p[1] - tip.n[1] * s * 0.15, Math.atan2(dy, dx) + rng.range(-0.25, 0.25), s, s * rng.range(0.42, 0.55), turn, (o.curl ?? 2.4) * rng.range(0.85, 1.15), o.depth ?? (s > 22 ? 1 : 0));
  }
}

/**
 * The crown of foam on a breaking crest: fingers rising from path b out toward path a, each
 * splitting into curling talons, in `rows` staggered layers, one every `step` px along.
 */
export function crown(out: Talons, rng: Rng, a: Path, b: Path, o: { rows: number; step: number; size: number; turn: number; curl?: number; from?: number; to?: number; grow?: number }) {
  const f0 = o.from ?? 0, f1 = o.to ?? 1;
  const n = Math.max(1, Math.round((b.total + a.total) / 2 * (f1 - f0) / o.step));
  for (let r = 0; r < o.rows; r++) {
    const layer = r / o.rows;
    for (let i = 0; i < n; i++) {
      const f = f0 + (f1 - f0) * clamp((i + 0.5 + (r % 2) * 0.5 + rng.range(-0.25, 0.25)) / n, 0, 1);
      const pb = b.at(f), pa = a.at(f);
      const dx = pa[0] - pb[0], dy = pa[1] - pb[1], reach = Math.hypot(dx, dy);
      if (reach < 4) continue;
      // Later layers start further out and reach less far, so the crown thins toward its edge.
      const s0 = layer * 0.45 * rng.range(0.6, 1.2), len = reach * (1 - s0) * rng.range(0.75, 1.08);
      const x = pb[0] + dx * s0, y = pb[1] + dy * s0, g = lerp(1, o.grow ?? 1, f);
      const wid = o.size * 0.55 * g * rng.range(0.8, 1.2);
      const along = a.dir(f), ang = Math.atan2(dy + along[1] * reach * 0.3, dx + along[0] * reach * 0.3);
      talon(out, rng, x, y, ang - o.turn * rng.range(0.1, 0.5), len, wid, o.turn, (o.curl ?? 2.2) * rng.range(0.8, 1.15), len > o.size * 1.6 ? 2 : 1);
    }
  }
}

/**
 * Slivers running between two paths (matched by fraction along each): `u` across from a (0) to
 * b (1), from fraction v0 to v1 along, `w` wide as a share of the gap, tapering to points.
 */
export function sliver(a: Path, b: Path, u: number, w: number, v0: number, v1: number, o: { wave?: number; ph?: number; minW?: number } = {}): Pt[] {
  const n = Math.max(6, Math.ceil(Math.abs(v1 - v0) * Math.max(a.total, b.total) / 5));
  const top: Pt[] = [], bot: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, v = lerp(v0, v1, t), pa = a.at(v), pb = b.at(v);
    const gap = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
    const taper = Math.pow(Math.sin(Math.PI * t), 0.55);
    const uu = u + (o.wave ?? 0) * Math.sin(t * 6 + (o.ph ?? 0)) / gap;
    const hw = Math.max(w * taper, (o.minW ?? 0) * taper / gap) / 2;
    top.push([lerp(pa[0], pb[0], uu - hw), lerp(pa[1], pb[1], uu - hw)]);
    bot.push([lerp(pa[0], pb[0], uu + hw), lerp(pa[1], pb[1], uu + hw)]);
  }
  return top.concat(bot.reverse());
}

/** Whether a point lies inside a polygon (even-odd). */
export function inside(poly: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Round flecks of foam scattered over a region, roughly `per10k` to every 100x100 px. */
export function flecks(poly: Pt[], per10k: number, r0: number, r1: number, rng: Rng, keep?: (x: number, y: number) => boolean): Pt[][] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const n = Math.round(((x1 - x0) * (y1 - y0) / 10000) * per10k), out: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const x = rng.range(x0, x1), y = rng.range(y0, y1);
    if (!inside(poly, x, y) || (keep && !keep(x, y))) continue;
    out.push(blob(x, y, rng.range(r0, r1), rng));
  }
  return out;
}

/** A slightly irregular round spot, as a gouge leaves it. */
export function blob(x: number, y: number, r: number, rng: Rng, k = 9): Pt[] {
  const out: Pt[] = [], ph = rng.random() * 6, sq = rng.range(0.75, 1.1);
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2, rr = r * (1 + 0.12 * Math.sin(a * 3 + ph));
    out.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * sq]);
  }
  return out;
}

/** A band of even width along a polyline, as a polygon (for outlines printed as shapes). */
export function band(pts: Pt[], w: (t: number) => number, shift = 0): Pt[] {
  const n = pts.length, l: Pt[] = [], r: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], d = Math.hypot(tx, ty) || 1, nx = -ty / d, ny = tx / d;
    const h = w(i / Math.max(1, n - 1)) / 2;
    l.push([pts[i][0] + nx * (shift + h), pts[i][1] + ny * (shift + h)]);
    r.push([pts[i][0] + nx * (shift - h), pts[i][1] + ny * (shift - h)]);
  }
  return l.concat(r.reverse());
}
