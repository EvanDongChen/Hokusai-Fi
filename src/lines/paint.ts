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

import { Noise } from '../core/noise';
import { resample } from '../core/print';
import { Rng } from '../core/rng';
import type { Pt, Sea, Wave } from './waves';

export const LAYERS = ['body', 'stripes', 'pale', 'foam', 'drips', 'splotches', 'outline'] as const;
export type LayerName = (typeof LAYERS)[number];

export const INK = {
  sky: '#ead9b8', dark: '#1f3768', blue: '#3f72a8', pale: '#a9c9d9', white: '#f5f0e3', key: '#152448',
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

/** A wave's surface, resampled evenly, with its length along and inward normal at each point. */
interface Frame { P: Pt[]; S: number[]; N: Pt[]; back: number[]; }

function frame(sea: Sea, wv: Wave): Frame {
  const P = resample(wv.line, 5), S = [0], N: Pt[] = [], back: number[] = [];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    // The water lies to the right of the line, which runs left to right over its top.
    N.push([-ty / l, tx / l]);
    // How much this stretch is the wave's back: rising toward the crest, the way the wave breaks.
    back.push(Math.max(0, Math.min(1, (-ty / l) * sea.dir * 1.6)));
  }
  return { P, S, N, back };
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

  // How deep the white lies under the surface: deep on the back, a thin rim on the face.
  const foam = P.map((_, i) => {
    const v = 0.5 + 0.5 * along(i, h * 0.35, 1);
    return big ? h * (0.018 + 0.32 * f.back[i] * v + 0.025 * v) : h * (0.1 + 0.18 * f.back[i] * v + 0.08 * v);
  });
  const pale = P.map((_, i) => foam[i] + h * (big ? 0.025 : 0.06) * (0.6 + 0.6 * (0.5 + 0.5 * along(i, h * 0.25, 2))));

  if (show.has('body')) {
    // Big waves are dark through; small ones blue above, deepening to dark toward their foot.
    ctx.fillStyle = tint ?? INK.dark;
    ctx.fill(water);
    if (!big && !tint) band(ctx, P, (i) => pale[i] + h * 0.3, INK.blue);
  }

  if (big && show.has('stripes')) {
    // Streaks of lighter blue parallel to the surface, laid deepest first: each is painted down to
    // its lower edge, then the dark laid back over everything above it, leaving a streak. Where a
    // streak's width falls to nothing it ends, so they run in long tapering strands.
    // Measured from the wave's front only (its face, the hood's underside, the trough), so they run
    // round the curl and the hollow rather than meeting the back's in creases.
    const front = (i: number) => f.back[i] < 0.3;
    const start = h * 0.09, gap = h * r.range(0.045, 0.06), K = Math.round((h * 0.75) / gap);
    for (let k = K - 1; k >= 0; k--) {
      const top = P.map((_, i) => start + k * gap + gap * 0.35 * along(i, h * 0.5, 10 + k));
      const width = P.map((_, i) => gap * 0.55 * Math.max(0, along(i, h * 0.3, 40 + k) + 0.25));
      band(ctx, P, (i) => top[i] + width[i], k % 3 === 2 ? INK.pale : INK.blue, front);
      band(ctx, P, (i) => top[i], INK.dark, front);
    }
  }

  if (show.has('pale')) band(ctx, P, (i) => pale[i], INK.pale);
  if (show.has('foam')) band(ctx, P, (i) => foam[i], INK.white);

  if (show.has('drips')) {
    // White leaking down from the foam: fingers falling from its lower edge, pale-blue edged.
    const n = Math.round(S[S.length - 1] / (h * (big ? 0.12 : 0.16)));
    const drops: { at: Pt; dir: Pt; len: number; w: number }[] = [];
    for (let k = 0; k < n; k++) {
      const i = r.int(1, P.length - 2), d = foam[i] * 0.85, nx = N[i][0], ny = N[i][1] + 0.5, l = Math.hypot(nx, ny) || 1;
      drops.push({ at: [P[i][0] + N[i][0] * d, P[i][1] + N[i][1] * d], dir: [nx / l, ny / l], len: h * r.range(0.03, big ? 0.1 : 0.08), w: h * r.range(0.025, 0.05) });
    }
    for (const [col, grow] of [[INK.pale, 1.6], [INK.white, 1]] as const) {
      ctx.fillStyle = col;
      for (const dr of drops) finger(ctx, dr.at, dr.dir, dr.len * (grow > 1 ? 1.1 : 1), dr.w * grow);
    }
  }

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

/** A finger of colour from `at` along `dir`, `len` long, `w` wide at its root, rounded at its end. */
function finger(ctx: CanvasRenderingContext2D, at: Pt, dir: Pt, len: number, w: number) {
  const n = 10, nx = -dir[1], ny = dir[0], left: Pt[] = [], right: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    // Swelling a little, then rounding off at the end like a drop.
    const t = k / n, half = (w / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 3))) * (0.85 + 0.3 * Math.sin(Math.PI * t));
    const x = at[0] + dir[0] * len * t, y = at[1] + dir[1] * len * t;
    left.push([x + nx * half, y + ny * half]);
    right.push([x - nx * half, y - ny * half]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  for (const p of right.reverse()) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
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
