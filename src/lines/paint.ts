// The base colouring of the waves, painted in layers as the print's blocks are laid down.
//
// Every layer is a band measured down from the wave's surface. A band is painted by stroking the
// surface line itself with a broad brush and keeping only what falls inside the wave's water, so
// each band follows the surface exactly, round the hood and into the hollow, and can never fold
// over itself. A band's depth varies along the wave, so its lower edge rolls.
//
// Big waves (the great wave, the domes, the trough in front) are Prussian blue, streaked along
// their length with lighter blue running parallel to the surface; a band of white foam lies along
// the top, deep on the wave's back and thin on its face, edged with pale blue, and the white drips
// down from it in fingers. Small waves are white above and blue below, mottled where they meet
// with splotches of white, pale blue and dark blue.
//
// Layers, in the order they are painted (each can be hidden in the debug panel):
//   body       the wave's water, dark blue
//   stripes    lighter-blue streaks along big waves
//   pale       the pale-blue band just under the foam
//   foam       the white band along the top
//   drips      white fingers leaking down from the foam
//   splotches  mottling where white meets blue (small waves)
//   outline    the key line along the surface

import { smoothstep } from '../core/math';
import { Noise } from '../core/noise';
import { resample } from '../core/print';
import { Rng } from '../core/rng';
import type { Pt, Sea, Wave } from './waves';

export const LAYERS = ['body', 'stripes', 'pale', 'foam', 'drips', 'splotches', 'outline'] as const;
export type LayerName = (typeof LAYERS)[number];

export const INK = {
  sky: '#ead9b8', dark: '#1d3a6c', mid: '#3264a6', blue: '#4a80c4', light: '#79a6d8', pale: '#a9c9d9', white: '#f5f0e3', key: '#152448',
} as const;

export interface PaintOpts {
  /** Layers to paint; all of them if not given. */
  show?: Set<LayerName>;
  /** Paint only this wave (its index in `sea.waves`). */
  only?: number | null;
  /** Paint each wave's body in its own tint, to tell the waves apart. */
  tint?: boolean;
}

export function paint(ctx: CanvasRenderingContext2D, sea: Sea, o: PaintOpts = {}) {
  const show = o.show ?? new Set(LAYERS);
  ctx.fillStyle = INK.sky;
  ctx.fillRect(0, 0, sea.W, sea.H);
  sea.waves.forEach((wv, i) => {
    if (o.only != null && o.only !== i) return;
    paintWave(ctx, sea, wv, show, o.tint ? `hsl(${(i * 67) % 360}, 45%, 35%)` : null);
  });
}

/** Big waves are streaked; small ones are mottled. */
export const isBig = (sea: Sea, wv: Wave) => wv.kind === 'great' || wv.kind === 'dome' || wv.kind === 'trough' || wv.h > sea.H * 0.3;

/**
 * A wave's surface, resampled evenly: the points, their length along, the inward normal, how high
 * each stands as a share of the wave's height, and which side of the crest it lies on.
 */
interface Frame { P: Pt[]; S: number[]; N: Pt[]; up: number[]; back: boolean[]; }

function frame(sea: Sea, wv: Wave): Frame {
  const P = resample(wv.line, 5), S = [0], N: Pt[] = [], up: number[] = [], back: boolean[] = [];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  let crest = 0;
  for (let i = 1; i < P.length; i++) if (P[i][1] < P[crest][1]) crest = i;
  const foot = P[crest][1] + wv.h;
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    // The water lies to the right of the line, which runs left to right over its top.
    N.push([-ty / l, tx / l]);
    up.push((foot - P[i][1]) / wv.h);
    // The back is the side the wave breaks away from.
    back.push(sea.dir > 0 ? i < crest : i > crest);
  }
  return { P, S, N, up, back };
}

function paintWave(ctx: CanvasRenderingContext2D, sea: Sea, wv: Wave, show: Set<LayerName>, tint: string | null) {
  const f = frame(sea, wv), { P, S, N } = f, r = new Rng(wv.id), noise = new Noise(r), h = wv.h, big = isBig(sea, wv);
  /** Smooth noise along the wave, -1..1, a different strand for each salt. */
  const along = (i: number, scale: number, salt: number) => noise.fbm(S[i] / scale, salt * 7.31, 2);

  ctx.save();
  // Everything stays inside the wave's water: under its line, down to the foot of the sheet.
  const water = new Path2D();
  water.moveTo(P[0][0], sea.H + 60);
  for (const p of P) water.lineTo(p[0], p[1]);
  water.lineTo(P[P.length - 1][0], sea.H + 60);
  water.closePath();
  ctx.clip(water);

  // How deep the white lies under the surface. On a big wave it caps the whole upper back and
  // the top of the hood, and is only a thin rim down the face; its lower edge is cut by narrow
  // fingers of blue rising into it. On a small wave it is a white cap over the top.
  const period = h * r.range(0.07, 0.1);
  const foam = P.map((_, i) => {
    const v = 0.5 + 0.5 * along(i, h * 0.35, 1), u = f.up[i];
    const d = big
      ? f.back[i] ? h * (0.02 + (0.24 + 0.16 * v) * smoothstep(0.12, 0.55, u)) : u > 0.68 ? h * (0.05 + 0.06 * v) : h * 0.018
      : h * (0.1 + 0.18 * (f.back[i] ? 1 : 0.5) * v + 0.06 * v);
    const finger = Math.pow(Math.max(0, Math.sin((S[i] / period) * Math.PI * 2 + 3 * along(i, h * 0.6, 3))), 8);
    return d * (1 - (big ? 0.6 : 0.35) * finger * smoothstep(h * 0.06, h * 0.15, d));
  });
  const pale = P.map((_, i) => foam[i] + h * (big ? 0.025 : 0.06) * (0.6 + 0.6 * (0.5 + 0.5 * along(i, h * 0.25, 2))));

  if (show.has('body')) {
    ctx.fillStyle = tint ?? INK.dark;
    ctx.fill(water);
  }

  if (show.has('stripes')) {
    ctx.save();
    ctx.clip(water);
    for (const b of bandsOf(sea, wv, f, r, along)) {
      ctx.save();
      if (b.half) {
        ctx.beginPath();
        const x0 = Math.max(-1e5, b.half[0]), x1 = Math.min(1e5, b.half[1]);
        ctx.rect(x0, -1e5, x1 - x0, 2e5);
        ctx.clip();
      }
      ctx.fillStyle = b.col;
      ctx.beginPath();
      ctx.moveTo(b.pts[0][0], b.pts[0][1]);
      for (const p of b.pts) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // White leaking down from the foam like paint: a narrow neck ending in a round drop, in all
  // lengths, hanging from the foam's lower edge only where it is thick. Their pale-blue halos go
  // down before the foam, so the white covers them except where a drop hangs below it.
  const drops: { at: Pt; dir: Pt; len: number; w: number }[] = [];
  if (show.has('drips')) {
    const n = Math.round(S[S.length - 1] / (h * (big ? 0.05 : 0.09)));
    for (let k = 0; k < n; k++) {
      const i = r.int(1, P.length - 2);
      if (foam[i] < h * 0.06) continue;
      const d = foam[i] * 0.97, nx = N[i][0], ny = N[i][1] + 0.8, l = Math.hypot(nx, ny) || 1;
      drops.push({ at: [P[i][0] + N[i][0] * d, P[i][1] + N[i][1] * d], dir: [nx / l, ny / l], len: h * Math.pow(r.random(), 1.6) * (big ? 0.12 : 0.07) + h * 0.015, w: h * r.range(0.018, 0.035) });
    }
    ctx.fillStyle = INK.pale;
    for (const dr of drops) drop(ctx, dr.at, dr.dir, dr.len, dr.w * 1.5);
  }
  if (show.has('pale')) band(ctx, P, (i) => pale[i], INK.pale);
  if (show.has('foam')) band(ctx, P, (i) => foam[i], INK.white);
  ctx.fillStyle = INK.white;
  for (const dr of drops) drop(ctx, dr.at, dr.dir, dr.len, dr.w);

  if (!big && show.has('splotches')) {
    // Mottling where the white meets the blue: rounded splotches of all three, scattered about
    // the foam's lower edge, the dark ones a little deeper, the white a little higher.
    const n = Math.round(S[S.length - 1] / (h * 0.05));
    for (let k = 0; k < n; k++) {
      const i = r.int(0, P.length - 1), pick = r.random();
      const [col, depth] = pick < 0.35 ? [INK.white, foam[i] * r.range(0.7, 1.15)] : pick < 0.7 ? [INK.pale, pale[i] * r.range(0.85, 1.25)] : [INK.dark, pale[i] * r.range(1.1, 1.6)];
      ctx.fillStyle = col;
      splotch(ctx, [P[i][0] + N[i][0] * depth, P[i][1] + N[i][1] * depth], h * r.range(0.025, 0.07), r);
    }
  }
  ctx.restore();

  if (show.has('outline')) {
    ctx.strokeStyle = INK.key;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (const p of P) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
}

/**
 * The stripes of a wave, as the print draws them: bands of lighter blue lying along one side of
 * the wave like contour lines, each a polygon offset from the surface into the water. Every band
 * comes to a point at the top, toward the crest, widens and moves further from the surface as it
 * goes down, and thins out where its side runs on into the trough.
 *
 *  - On the great wave the front bands start at the hood's tip, so they run up the hood's
 *    underside into it, round the hollow and down the face: three to five, evenly spaced.
 *    One or two broader bands rise up its back, widest at the foot.
 *  - On a peak, two or three thin slivers lie along each flank, converging on the point.
 */
/** A band: its outline, its ink, and (for a peak's flank) the span of x it is kept within. */
interface Band { pts: Pt[]; col: string; half?: [number, number]; }

function bandsOf(sea: Sea, wv: Wave, f: Frame, r: Rng, along: (i: number, scale: number, salt: number) => number): Band[] {
  const { P, S, N } = f, h = wv.h, out: Band[] = [];
  let crest = 0;
  for (let i = 1; i < P.length; i++) if (P[i][1] < P[crest][1]) crest = i;
  const fwd = sea.dir, great = wv.kind === 'great' || wv.kind === 'dome';

  /** Indices from `from` stepping by `step` (away from the crest) to the end of the line. */
  const walk = (from: number, step: 1 | -1) => {
    const o: number[] = [];
    for (let i = from; i >= 0 && i < P.length; i += step) o.push(i);
    return o;
  };
  /** Bands along one side, starting at index list L[0]; `foot` is how far along L the side meets the sea. */
  const side = (L: number[], o: { n: number; gap: number; first: number; width: number; start: number; spread: number; run: number; salt: number; D?: number }) => {
    if (L.length < 3) return;
    const d = L.map((i) => Math.abs(S[i] - S[L[0]]));
    const footAt = L.findIndex((i, j) => j > 2 && (P[i][1] - P[crest][1]) / h > 0.92);
    const D = o.D ?? (d[footAt > 0 ? footAt : L.length - 1] || 1);
    for (let k = o.n - 1; k >= 0; k--) {
      const a = o.start + k * o.spread, inner: Pt[] = [], outer: Pt[] = [];
      for (let j = 0; j < L.length; j++) {
        const i = L[j], u = d[j] / D;
        // Where the line runs off the sheet it turns down; bands offset from there would fold.
        if (P[i][0] < 0 || P[i][0] > sea.W) break;
        if (u < a) continue;
        // Pointed at the top, full width a little way down, thinning out along the trough.
        const w = o.width * h * Math.pow(smoothstep(a, a + 0.4, u), 1.3) * (1 - smoothstep(1, 1 + o.run, u)) * (0.85 + 0.3 * along(i, h * 0.7, o.salt + 20 + k));
        const off = (o.first + k * o.gap) * h * (0.75 + 0.45 * Math.min(1.2, u)) + o.gap * h * 0.15 * along(i, h * 0.8, o.salt + k);
        inner.push([P[i][0] + N[i][0] * off, P[i][1] + N[i][1] * off]);
        outer.push([P[i][0] + N[i][0] * (off + w), P[i][1] + N[i][1] * (off + w)]);
        if (u > 1 + o.run) break;
      }
      if (inner.length > 2) out.push({ pts: inner.concat(outer.reverse()), col: k % 2 === 0 ? INK.blue : INK.mid });
    }
  };

  if (great) {
    // The hood's tip: the most forward point of the line above the lower face.
    let tip = crest;
    for (let i = 0; i < P.length; i++) if ((P[i][1] - P[crest][1]) / h < 0.7 && (fwd > 0 ? i > crest : i < crest) && P[i][0] * fwd > P[tip][0] * fwd) tip = i;
    side(walk(tip, fwd > 0 ? 1 : -1), { n: r.int(3, 5), gap: r.range(0.085, 0.11), first: 0.035, width: r.range(0.045, 0.06), start: 0.03, spread: 0.035, run: r.range(0.8, 1.6), salt: 1 });
    side(walk(crest, fwd > 0 ? -1 : 1), { n: r.int(1, 2), gap: 0.16, first: r.range(0.22, 0.3), width: r.range(0.07, 0.1), start: 0.3, spread: 0.1, run: 0.6, salt: 2 });
  } else if (wv.kind === 'trough') {
    // The long trough: bands along its whole width, pointed where they start on the left.
    const L = P.map((_, i) => i).filter((i) => P[i][0] >= 0 && P[i][0] <= sea.W);
    if (L.length > 2) side(L, { n: 3, gap: 0.14, first: 0.08, width: 0.06, start: 0.05, spread: 0.12, run: 0.05, salt: 5, D: Math.abs(S[L[L.length - 1]] - S[L[0]]) * 0.9 });
  } else {
    // A peak: slivers along each flank, converging on its point, each flank's kept to its own
    // side of the point so they never cross under it.
    const n = r.int(2, 3), thin = r.range(0.06, 0.08), cx = P[crest][0];
    for (const [dir, salt] of [[1, 3], [-1, 4]] as const) {
      const from = out.length;
      // Starting a little below the point, so the two flanks' slivers do not cross under it.
      side(walk(crest, dir), { n, gap: r.range(0.12, 0.16), first: 0.05, width: thin, start: 0.16, spread: 0.07, run: 0.5, salt });
      for (const b of out.slice(from)) b.half = dir > 0 ? [cx, Infinity] : [-Infinity, cx];
    }
  }
  return out;
}

/**
 * Paint everything within depth d(i) of the surface: the surface stroked with a brush twice as
 * wide, a short stretch at a time (stretches of the same width share one stroke). Only the
 * stretches `from` keeps are measured from.
 */
function band(ctx: CanvasRenderingContext2D, P: Pt[], d: (i: number) => number, col: string, from: (i: number) => boolean = () => true) {
  const groups = new Map<number, Path2D>();
  for (let i = 0; i < P.length - 1; i++) {
    if (!from(i) || !from(i + 1)) continue;
    const w = Math.round(Math.max(0, d(i) + d(i + 1)));
    if (w < 1) continue;
    let g = groups.get(w);
    if (!g) groups.set(w, (g = new Path2D()));
    g.moveTo(P[i][0], P[i][1]);
    g.lineTo(P[i + 1][0], P[i + 1][1]);
  }
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, g] of groups) {
    ctx.lineWidth = w;
    ctx.stroke(g);
  }
}

/** A drop of colour hanging from `at` along `dir`: a narrow neck `len` long ending in a round drop `w` across. */
function drop(ctx: CanvasRenderingContext2D, at: Pt, dir: Pt, len: number, w: number) {
  const nx = -dir[1], ny = dir[0], end: Pt = [at[0] + dir[0] * len, at[1] + dir[1] * len], neck = w * 0.28, root = w * 0.45;
  ctx.beginPath();
  ctx.moveTo(at[0] + nx * root, at[1] + ny * root);
  ctx.lineTo(end[0] + nx * neck, end[1] + ny * neck);
  ctx.lineTo(end[0] - nx * neck, end[1] - ny * neck);
  ctx.lineTo(at[0] - nx * root, at[1] - ny * root);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(end[0], end[1], w / 2, 0, Math.PI * 2);
  ctx.fill();
}

/** An irregular rounded splotch. */
function splotch(ctx: CanvasRenderingContext2D, c: Pt, rad: number, r: Rng) {
  const k = 9, ph = r.random() * 6, sq = r.range(0.6, 1);
  ctx.beginPath();
  for (let j = 0; j <= k; j++) {
    const a = (j / k) * Math.PI * 2, rr = rad * (1 + 0.22 * Math.sin(a * 2 + ph) + 0.12 * Math.sin(a * 3 - ph));
    const x = c[0] + Math.cos(a) * rr, y = c[1] + Math.sin(a) * rr * sq;
    if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
