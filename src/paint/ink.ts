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
import { carvedLine, onKey, polyPath, type Ctx, type Pt } from '../core/print';
import { Rng } from '../core/rng';

export type Ink = 'paper' | 'aqua' | 'blue' | 'deep' | 'key' | 'shade' | 'boat' | 'boatDark' | 'cloth' | 'skin' | 'hair' | 'snow';
export type Palette = Record<Ink, RGB>;

/** One impression: shapes filled in one ink, or polylines stroked in it. */
export interface Layer { ink: Ink; fill?: Pt[][]; line?: { pts: Pt[]; w: number; closed?: boolean }[]; alpha?: number; }

export function paintLayers(ctx: Ctx, layers: Layer[], pal: Palette) {
  for (const l of layers) {
    if (l.ink === 'key') onKey(ctx, () => paintLayer(ctx, l, pal));
    else paintLayer(ctx, l, pal);
  }
}

function paintLayer(ctx: Ctx, l: Layer, pal: Palette) {
  ctx.fillStyle = css(pal[l.ink], l.alpha);
  if (l.fill?.length) {
    ctx.beginPath();
    for (const s of l.fill) if (s.length > 2) polyPath(ctx, s);
    ctx.fill('nonzero');
  }
  if (l.line?.length) {
    // Lines are carved as the brush drew them: filled bands that swell and taper.
    ctx.beginPath();
    for (const { pts, w, closed } of l.line) if (pts.length > 1) polyPath(ctx, carvedLine(pts, w, closed));
    ctx.fill('nonzero');
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

/**
 * The blocks talons print in: the foam they grow from and the edge of it that is outlined (its
 * rim), their pale shadows, white bodies and dark hooks.
 */
export interface Talons { mass: Pt[][]; rim: Pt[][]; halo: Pt[][]; body: Pt[][]; hook: Pt[][]; }
export const talons = (): Talons => ({ mass: [], rim: [], halo: [], body: [], hook: [] });

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
  // A narrow pale shadow along the finger's inner side, under the curl.
  out.halo.push(edge(inner, () => 0, 0.1, 0.75).concat(edge(inner, (t) => half(t) + wid * 0.28 * Math.sin(Math.PI * clamp((t - 0.1) / 0.65, 0, 1)), 0.1, 0.75).reverse()));
  out.body.push(edge(1, half).concat(edge(-1, half).reverse()));
  // The key block outlines the whole finger as the brush drew it: a fine line along its inner
  // side, and along its outer side one that thickens into the dark hook wrapping round the tip.
  const hw = Math.min(wid * 0.3, 3.8), h0 = 0.06;
  const th = (t: number) => hw * (0.22 + 0.78 * Math.pow(clamp((t - 0.45) / 0.45, 0, 1), 1.5)) * Math.pow(Math.sin(Math.PI * clamp((t - h0) / (1.03 - h0), 0, 1)), 0.5);
  out.hook.push(edge(outer, half, h0).concat(edge(outer, (t) => half(t) + th(t), h0).reverse()));
  const ti = (t: number) => hw * 0.2 * Math.sin(Math.PI * clamp((t - 0.12) / 0.7, 0, 1));
  out.hook.push(edge(inner, half, 0.12, 0.82).concat(edge(inner, (t) => half(t) + ti(t), 0.12, 0.82).reverse()));
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
    // A finger of foam longer than it is wide, reaching on from the blue and curling over.
    const s = size * rng.range(0.75, 1.25), len = s * rng.range(1.4, 1.9);
    const dx = tip.t[0] + tip.n[0] * lift, dy = tip.t[1] + tip.n[1] * lift;
    talon(out, rng, tip.p[0] - tip.n[0] * s * 0.25, tip.p[1] - tip.n[1] * s * 0.25, Math.atan2(dy, dx) + rng.range(-0.25, 0.25), len, s * rng.range(0.34, 0.42), turn, (o.curl ?? 2.6) * rng.range(0.85, 1.15), o.depth ?? (s > 16 ? 1 : 0));
  }
}

/**
 * The crown of foam on a breaking crest, between its inner edge (path b) and its outer edge
 * (path a). The foam is one mass reaching out to the crest, and from its edge long fingers grow
 * out and forward, each splitting into smaller ones that curl over into claws, so the whole crest
 * breaks as one branching hand of foam. Over the mass itself lie a few rows of smaller claws, of
 * which only the dark hooks show.
 */
export function crown(out: Talons, rng: Rng, a: Path, b: Path, o: { rows: number; step: number; size: number; turn: number; curl?: number; from?: number; to?: number; grow?: number; out?: number }) {
  const f0 = o.from ?? 0, f1 = o.to ?? 1, curl = o.curl ?? 2.6, outward = o.out ?? 0.75;
  // The mass: out to the crown's edge, rising and falling in rounded swells along it.
  const m = 64, inner: Pt[] = [], outer: Pt[] = [], ph = rng.random() * 6, wl = rng.range(5, 8);
  for (let i = 0; i <= m; i++) {
    const f = f0 + (f1 - f0) * (i / m), pb = b.at(f), pa = a.at(f);
    const u = 0.72 + 0.14 * Math.sin(i / m * wl * Math.PI * 2 + ph) * Math.min(1, i / 6, (m - i) / 6);
    inner.push(pb);
    outer.push([lerp(pb[0], pa[0], u), lerp(pb[1], pa[1], u)]);
  }
  out.mass.push(inner.concat(outer.slice().reverse()));
  out.rim.push(outer);
  const O = new Path(outer), n = Math.max(1, Math.round(O.total / o.step));
  // Fingers from the mass's edge, out and forward, each a little bigger toward the crown's end.
  for (let i = 0; i < n; i++) {
    const v = clamp((i + rng.range(0.25, 0.75)) / n, 0, 1), f = f0 + (f1 - f0) * v;
    const pb = b.at(f), pa = a.at(f), dx = pa[0] - pb[0], dy = pa[1] - pb[1], reach = Math.hypot(dx, dy) || 1;
    const p = O.at(v), along = a.dir(f), g = lerp(1, o.grow ?? 1, f);
    const sz = o.size * g * rng.range(0.85, 1.25), len = sz * rng.range(2.3, 3.3);
    // Rooted well inside the mass so neighbouring fingers join at the base.
    const x = p[0] - dx / reach * len * 0.3, y = p[1] - dy / reach * len * 0.3;
    const ang = Math.atan2(dy / reach * outward + along[1] * 0.65, dx / reach * outward + along[0] * 0.65) - o.turn * rng.range(0, 0.4);
    talon(out, rng, x, y, ang, len, sz * rng.range(0.36, 0.46), o.turn, curl * rng.range(0.9, 1.2), sz > 12 ? 2 : 1);
  }
  // Claws lying over the mass, smaller toward the crest's root.
  for (let k = 0; k < o.rows - 1; k++) {
    const u = 0.25 + 0.4 * (k / Math.max(1, o.rows - 1)), nn = Math.max(1, Math.round(n * 0.8));
    for (let i = 0; i < nn; i++) {
      const f = f0 + (f1 - f0) * clamp((i + rng.range(0.1, 0.9)) / nn, 0, 1), pb = b.at(f), pa = a.at(f), along = a.dir(f);
      const dx = pa[0] - pb[0], dy = pa[1] - pb[1], reach = Math.hypot(dx, dy) || 1, sz = o.size * (0.5 + 0.4 * u) * rng.range(0.8, 1.15);
      const ang = Math.atan2(dy / reach * 0.5 + along[1], dx / reach * 0.5 + along[0]) - o.turn * rng.range(0.2, 0.6);
      talon(out, rng, pb[0] + dx * u, pb[1] + dy * u, ang, sz, sz * 0.42, o.turn, curl * rng.range(0.9, 1.2), 0);
    }
  }
}

/**
 * The blocks talons print in, in order: the key block's outline round the whole foam (mass and
 * talons as one silhouette), the foam, the pale shadows, the talons, and their dark hooks. The
 * foam is laid over the outline, so only its outer edge stays.
 */
export function talonLayers(tl: Talons, w = 1.4): Layer[] {
  return [
    { ink: 'key', line: tl.rim.map((pts) => ({ pts, w: w * 2 })).concat(tl.body.map((pts) => ({ pts, w: w * 2, closed: true }))) },
    { ink: 'paper', fill: tl.mass },
    { ink: 'aqua', fill: tl.halo },
    { ink: 'paper', fill: tl.body },
    { ink: 'key', fill: tl.hook },
  ];
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
