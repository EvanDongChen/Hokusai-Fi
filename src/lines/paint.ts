// The base colouring of the waves, painted in layers as the print's blocks are laid down.
//
// Every layer is a band measured down from the wave's surface. A band is painted by stroking the
// surface line itself with a broad brush and keeping only what falls inside the wave's water, so
// each band follows the surface exactly, round the hood and into the hollow, and can never fold
// over itself. A band's depth varies along the wave, so its lower edge rolls.
//
// Below its foam a wave is Prussian blue, streaked with lighter blue (the stripes). Over its top
// lies the foam, as in the print: white, tinted pale aqua toward the blue, deep on the backs of the
// waves and over the small peaks, only a rim down the great wave's face. The blue shows through
// the foam as dashes lying along the surface, short and sparse near the crest, longer and denser
// toward the blue, until they merge into it. On the big waves the blue also rises into the foam in
// rounded fingers, flecked with white. On the crests the foam breaks into claws (claws.ts).
//
// Layers, in the order they are painted (each can be hidden in the debug panel):
//   body      the wave's water, dark blue
//   stripes   lighter-blue strands below the foam
//   foam      the white cap along the top, tinted pale toward the blue
//   dashes    blue showing through the foam in long tapering dashes
//   fingers   the blue rising into the foam in rounded fingers, with white specks (big waves)
//   outline   the key line along the surface
//   claws     the fractal splashes on the crests

import { smoothstep } from '../core/math';
import { Noise } from '../core/noise';
import { resample } from '../core/print';
import { Rng } from '../core/rng';
import { claw } from './claws';
import type { Pt, Sea, Wave } from './waves';

export const LAYERS = ['body', 'stripes', 'foam', 'dashes', 'fingers', 'outline', 'claws'] as const;
export type LayerName = (typeof LAYERS)[number];

export const INK = {
  sky: '#ead9b8', dark: '#203e71', mid: '#3268ab', blue: '#4680c6', light: '#79a6d8', pale: '#b4d0d8', tint: '#cfe1dc', white: '#f4f1e4', key: '#152448',
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
  const f = frame(sea, wv), { P, S, N } = f, r = new Rng(wv.id), noise = new Noise(r), h = wv.h;
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

  let crest = 0;
  for (let i = 1; i < P.length; i++) if (P[i][1] < P[crest][1]) crest = i;
  const great = wv.kind === 'great' || wv.kind === 'dome', peaky = wv.kind === 'peak' || wv.kind === 'hook';

  // How deep the foam lies under the surface. The great wave's back and the top of its hood are
  // capped deep in white, its face only rimmed; a peak is white over most of its upper part,
  // deepest under its point; the long trough has a thin cap.
  // The hood's tip: the most forward point of the line above the lower face. Only the hood's
  // outer surface, from the crest to here, is foamed; its underside, over the hollow, is not.
  const fwd = sea.dir, ahead = (i: number) => (fwd > 0 ? i > crest : i < crest);
  let tip = crest;
  for (let i = 0; i < P.length; i++) if (great && ahead(i) && f.up[i] > 0.3 && f.up[i] < 0.8 && P[i][0] * fwd > P[tip][0] * fwd) tip = i;
  const onHood = (i: number) => (fwd > 0 ? i > crest && i <= tip : i < crest && i >= tip);
  const foam = P.map((_, i) => {
    const v = 0.5 + 0.5 * along(i, h * 0.35, 1), u = f.up[i];
    if (great) {
      // Deep on the back, but shallowing toward the crest, so it does not bulge round into the hood.
      if (f.back[i]) return h * (0.03 + (0.24 + 0.14 * v) * smoothstep(0.15, 0.65, u) * (0.4 + 0.6 * smoothstep(0, h * 0.45, Math.abs(S[crest] - S[i]))));
      // Near the crest it meets the back's foam, so no blue wedge opens between them.
      return onHood(i) ? (h * (0.04 + 0.04 * v) + h * 0.12 * (1 - smoothstep(0, h * 0.3, Math.abs(S[i] - S[crest])))) * (1 - 0.7 * smoothstep(0.75, 1, (S[i] - S[crest]) * fwd / ((S[tip] - S[crest]) * fwd || 1))) : h * 0.014;
    }
    // A peak is white most of the way down its flanks, as the print's swells are.
    if (peaky) return h * (0.3 + 0.5 * smoothstep(0, 1, u)) * (0.8 + 0.2 * v);
    return h * (0.06 + 0.06 * v);
  });

  if (show.has('body')) {
    ctx.fillStyle = tint ?? INK.dark;
    ctx.fill(water);
  }

  if (show.has('stripes')) {
    ctx.save();
    ctx.clip(water);
    if (peaky) peakStripes(ctx, sea, wv, f, r, along);
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

  if (show.has('foam')) {
    // Pale aqua down to the foam's lower edge, then white over its upper part.
    band(ctx, P, (i) => foam[i], INK.tint);
    band(ctx, P, (i) => foam[i] * (0.5 + 0.2 * along(i, h * 0.3, 4)), INK.white);
  }

  if (show.has('dashes')) {
    // The blue showing through the foam: dashes lying along the surface, each tapering at both
    // ends, dark blue with a mid-blue rim in a pale halo. Near the crest they are short, thin and
    // few; toward the foam's lower edge longer, broader and more, till they merge into the blue.
    // Sized in sheet units, like the stripes, so small waves get fewer rather than finer ones.
    const n = Math.round(S[S.length - 1] / (sea.H * (great ? 0.01 : 0.008)));
    for (let k = 0; k < n; k++) {
      const i = r.int(1, P.length - 2);
      // Not where the line drops steeply away off the sheet's edge.
      if (foam[i] < sea.H * 0.035 || Math.abs(N[i][1]) < 0.35 || P[i][0] < 0 || P[i][0] > sea.W) continue;
      const t = Math.pow(r.random(), 0.6), d = t * foam[i] * 1.05;
      const len = sea.H * (0.04 + 0.16 * Math.pow(t, 1.3)) * r.range(0.6, 1.4), w = sea.H * (0.005 + 0.014 * t) * r.range(0.7, 1.3);
      // The run of samples it lies along, kept to one side of a peak's point.
      let i0 = i, i1 = i;
      while (i0 > 0 && S[i] - S[i0 - 1] < len / 2 && !(peaky && i0 - 1 === crest)) i0--;
      while (i1 < P.length - 1 && S[i1 + 1] - S[i] < len / 2 && !(peaky && i1 + 1 === crest)) i1++;
      if (i1 - i0 < 2) continue;
      for (const [col, grow] of [[INK.tint, 1.6], [INK.mid, 1.3], [INK.dark, 1]] as const) {
        const top: Pt[] = [], bot: Pt[] = [];
        for (let j = i0; j <= i1; j++) {
          const u = (j - i0) / (i1 - i0), hw = ((w * grow) / 2) * Math.pow(Math.sin(Math.PI * u), 0.7);
          // Under a peak's point the two flanks' normals cross, so there a dash lies straight below
          // the surface rather than along its normal (the line is a function of x on a peak).
          const c: Pt = peaky ? [P[j][0], P[j][1] + d] : [P[j][0] + N[j][0] * d, P[j][1] + N[j][1] * d];
          top.push([c[0] - N[j][0] * hw, c[1] - N[j][1] * hw]);
          bot.push([c[0] + N[j][0] * hw, c[1] + N[j][1] * hw]);
        }
        fill(ctx, top.concat(bot.reverse()), col);
      }
    }
  }

  if (great && show.has('fingers')) {
    // Where the foam lies deep, the blue rises into it in rounded fingers leaning forward, with
    // narrow runs of white between them; and the blue below is flecked with white.
    const period = Math.max(16, h * r.range(0.045, 0.06));
    ctx.lineCap = 'round';
    for (let s0 = r.range(0, period); s0 < S[S.length - 1]; s0 += period * r.range(0.8, 1.2)) {
      const i = S.findIndex((v) => v >= s0);
      if (i < 1 || foam[i] < h * 0.1) continue;
      // Broad, short and rounded, packed side by side, so only narrow white runs between them.
      const L = foam[i] * r.range(0.2, 0.45), fw = period * r.range(0.6, 0.72);
      const root: Pt = [P[i][0] + N[i][0] * (foam[i] + fw), P[i][1] + N[i][1] * (foam[i] + fw)];
      const tip: Pt = [P[i][0] + N[i][0] * (foam[i] - L) + sea.dir * L * 0.35, P[i][1] + N[i][1] * (foam[i] - L)];
      const mid: Pt = [(root[0] + tip[0]) / 2 - sea.dir * L * 0.1, (root[1] + tip[1]) / 2];
      ctx.strokeStyle = INK.dark;
      ctx.lineWidth = fw;
      ctx.beginPath();
      ctx.moveTo(root[0], root[1]);
      ctx.quadraticCurveTo(mid[0], mid[1], tip[0], tip[1]);
      ctx.stroke();
    }
    ctx.fillStyle = INK.white;
    const n = Math.round(S[S.length - 1] / (h * 0.012));
    for (let k = 0; k < n; k++) {
      const i = r.int(1, P.length - 2);
      if (foam[i] < h * 0.06) continue;
      const d = foam[i] * r.range(0.6, 1.4) + h * r.range(0, 0.12), rad = Math.min(3.5, Math.max(1.2, h * r.range(0.003, 0.007)));
      ctx.beginPath();
      ctx.ellipse(P[i][0] + N[i][0] * d, P[i][1] + N[i][1] * d, rad, rad * r.range(0.6, 1), r.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
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

  if (show.has('claws')) clawsOf(ctx, sea, wv, f, r, foam, crest);
}

/**
 * The splashes along a wave's crest. The great wave breaks into claws all along the top of its
 * hood, from the dome to the tip, in two rows: the inner ones rooted in the foam, the outer ones
 * on its edge over them, so the crest's whole silhouette is claws. A dome and the peaks only break
 * into a few small ones about their tops.
 */
function clawsOf(ctx: CanvasRenderingContext2D, sea: Sea, wv: Wave, f: Frame, r: Rng, foam: number[], crest: number) {
  const { P, S, N } = f, h = wv.h, fwd = sea.dir;
  const ink = { white: INK.white, pale: INK.pale, key: INK.key };
  /** Claws every `step` along the line between indices a and b, rooted `depth` (a share of the foam) in. */
  const row = (a: number, b: number, size: number, step: number, depth: number, gen: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let s0 = S[lo] + r.range(0, step); s0 < S[hi]; s0 += step * r.range(0.75, 1.25)) {
      const i = S.findIndex((v) => v >= s0);
      if (i < 0) break;
      // Out of the surface and forward, the way the wave breaks.
      const ox = -N[i][0] * 0.75 + fwd * 0.6, oy = -N[i][1] * 0.75 - 0.15;
      const d = depth * foam[i] + size * 0.2, len = size * r.range(0.8, 1.2);
      claw(ctx, r, P[i][0] + N[i][0] * d, P[i][1] + N[i][1] * d, Math.atan2(oy, ox) + r.range(-0.25, 0.25),
        { len, w: len * r.range(0.32, 0.42), turn: fwd, depth: gen, line: Math.min(2.6, Math.max(1, len * 0.045)) }, ink);
    }
  };
  if (wv.kind === 'great') {
    // From the top of the back, over the dome, to the hood's tip.
    const ahead = (i: number) => (fwd > 0 ? i > crest : i < crest);
    let tip = crest;
    for (let i = 0; i < P.length; i++) if (ahead(i) && f.up[i] > 0.3 && f.up[i] < 0.8 && P[i][0] * fwd > P[tip][0] * fwd) tip = i;
    let from = crest;
    while (from - fwd >= 0 && from - fwd < P.length && f.up[from - fwd] > 0.78) from -= fwd;
    const size = Math.min(80, Math.max(22, h * 0.13));
    row(from, tip, size * 0.85, size * 0.75, 0.55, 2);
    row(from, tip, size, size * 0.6, 0, 2);
  } else if (wv.kind !== 'trough') {
    let a = crest, b = crest;
    while (a > 0 && f.up[a - 1] > 0.72) a--;
    while (b < P.length - 1 && f.up[b + 1] > 0.72) b++;
    const size = Math.min(40, Math.max(12, h * 0.12));
    row(a, b, size, size * 0.8, 0, 1);
  }
}

/**
 * The stripes of a wave, as the print draws them: a bundle of broad strands of lighter blue lying
 * along one side of the wave. They gather to a point at the top, where the side begins, and fan
 * out going down, each strand and each dark gap between them widening as they go, until they run
 * out along the trough. A strand is about as wide as the gap beside it.
 *
 *  - The great wave's front bundle starts where its face meets the underside of the hood (the
 *    curl itself stays solid dark) and fans down the face into the trough. A second, wider
 *    bundle rises up its back from the lower left, meeting the face's outer strand in a V.
 *  - A peak has a bundle along each flank, gathered at its point.
 *  - The long trough in front has a few strands along it.
 */
/** A band: its outline, its ink, and (for a peak's flank) the span of x it is kept within. */
interface Band { pts: Pt[]; col: string; half?: [number, number]; }

function bandsOf(sea: Sea, wv: Wave, f: Frame, r: Rng, along: (i: number, scale: number, salt: number) => number): Band[] {
  const { P, S, N } = f, h = wv.h, out: Band[] = [];
  let crest = 0;
  for (let i = 1; i < P.length; i++) if (P[i][1] < P[crest][1]) crest = i;
  const fwd = sea.dir, up = (i: number) => (P[crest][1] + h - P[i][1]) / h;

  /** Indices from `from` stepping by `step` to the end of the line. */
  const walk = (from: number, step: 1 | -1) => {
    const o: number[] = [];
    for (let i = from; i >= 0 && i < P.length; i += step) o.push(i);
    return o;
  };

  /**
   * A bundle of strands along the line L (ordered from the top down). `D` is how far along L the
   * side reaches the sea; past it the strands run on for `run` more and thin away.
   */
  const bundle = (L: number[], o: { n: number; rim: number; W: number; G: number; D: number; run: number; salt: number; half?: [number, number] }): Pt[][] => {
    if (L.length < 3) return [];
    const d = L.map((i) => Math.abs(S[i] - S[L[0]]));
    // The strand nearest the surface reaches highest; each further one starts a little lower.
    const ends = Array.from({ length: o.n }, (_, k) => k * 0.06 + r.range(0, 0.04));
    const inner: Pt[][] = ends.map(() => []), outer: Pt[][] = ends.map(() => []);
    for (let j = 0; j < L.length; j++) {
      const i = L[j], u = d[j] / o.D;
      // Run on a little past the sheet's edge, so the sheet cuts them cleanly; further out the
      // line turns down off the sheet and strands offset from there would fold.
      if (P[i][0] < -50 || P[i][0] > sea.W + 50 || u > 1 + o.run) break;
      // Closer together at the top, fanning out down the side, thinning away along the trough.
      // Spacing keeps fanning out; only the strands' widths thin away along the trough.
      const fan = 0.45 + 0.9 * Math.min(1.4, u), fade = 1 - smoothstep(1, 1 + o.run, u);
      let off = o.rim * h;
      for (let k = 0; k < o.n; k++) {
        const wob = 1 + 0.18 * along(i, h * 0.8, o.salt * 10 + k);
        // Each strand comes to its own point at its top end.
        const w = o.W * h * fan * fade * Math.pow(smoothstep(ends[k], ends[k] + 0.32, u), 0.8) * wob;
        if (w > 0.3) {
          inner[k].push([P[i][0] + N[i][0] * off, P[i][1] + N[i][1] * off]);
          outer[k].push([P[i][0] + N[i][0] * (off + w), P[i][1] + N[i][1] * (off + w)]);
        }
        off += w + o.G * h * fan * (1 + 0.15 * along(i, h * 0.9, o.salt * 10 + k + 5));
      }
    }
    for (let k = 0; k < o.n; k++) {
      if (inner[k].length > 2) out.push({ pts: inner[k].concat(outer[k].slice().reverse()), col: k % 2 === 0 ? INK.blue : INK.mid, half: o.half });
    }
    // Each strand's edge nearest the surface, from its top down.
    return inner;
  };
  /** A strand along a curve: full width `w` at its start, tapering to a point at its end. */
  const strand = (curve: Pt[], w: number, col: string) => {
    const a: Pt[] = [], b: Pt[] = [], n = curve.length;
    for (let j = 0; j < n; j++) {
      const p = curve[Math.max(0, j - 1)], q = curve[Math.min(n - 1, j + 1)], tx = q[0] - p[0], ty = q[1] - p[1], l = Math.hypot(tx, ty) || 1;
      const half = (w / 2) * Math.pow(1 - j / (n - 1), 0.75);
      a.push([curve[j][0] - (ty / l) * half, curve[j][1] + (tx / l) * half]);
      b.push([curve[j][0] + (ty / l) * half, curve[j][1] - (tx / l) * half]);
    }
    out.push({ pts: a.concat(b.reverse()), col });
  };
  /** Points along the quadratic curve a -> c -> b, up to fraction `to`. */
  const quad = (a: Pt, c: Pt, b: Pt, to = 1): Pt[] => Array.from({ length: 41 }, (_, k) => {
    const t = (k / 40) * to, m = 1 - t;
    return [m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]] as Pt;
  });
  /** How far along L the side comes down to `level` (as a share of the wave's height). */
  const reach = (L: number[], level: number) => {
    const j = L.findIndex((i, j) => j > 2 && up(i) < level);
    return Math.abs(S[L[j > 0 ? j : L.length - 1]] - S[L[0]]) || 1;
  };

  if (wv.kind === 'great' || wv.kind === 'dome') {
    // The hood's tip (its most forward point above the lower face), and where the face meets the
    // hood's underside (the hollow's innermost point between them). The strands start halfway
    // along the underside from the one to the other, so they curve up in under the curl, which
    // itself stays solid dark.
    const step: 1 | -1 = fwd > 0 ? 1 : -1, ahead = (i: number) => (fwd > 0 ? i > crest : i < crest);
    let tip = -1;
    for (let i = 0; i < P.length; i++) if (ahead(i) && up(i) > 0.3 && up(i) < 0.75 && (tip < 0 || P[i][0] * fwd > P[tip][0] * fwd)) tip = i;
    if (tip < 0) return out;
    let top = tip;
    for (let i = tip; i >= 0 && i < P.length && up(i) > 0.25; i += step) if (P[i][0] * fwd < P[top][0] * fwd) top = i;
    let start = top;
    while (start - step !== tip && Math.abs(S[start - step] - S[top]) < Math.abs(S[tip] - S[top]) * 0.55) start -= step;
    const face = walk(start, step);
    const strands = bundle(face, { n: r.int(6, 7), rim: 0.02, W: r.range(0.04, 0.048), G: r.range(0.032, 0.04), D: reach(face, 0.06), run: r.range(0.5, 0.8), salt: 1 });
    // Up the back: a broad band rising from the lower edge of the sheet, parallel to the back at
    // first, then curving in to meet the face's outermost strand partway down, making a V; and a
    // second, shorter band below it.
    const back = walk(crest, (-step) as 1 | -1).filter((i) => P[i][0] >= 0 && P[i][0] <= sea.W);
    const outerStrand = strands[strands.length - 1] ?? [];
    if (back.length > 3 && outerStrand.length > 4) {
      const inward = (i: number, d: number): Pt => [P[i][0] + N[i][0] * d * h, P[i][1] + N[i][1] * d * h];
      // The V: where the face's outermost strand comes down to about half the wave's height.
      const foot = back[back.length - 1], level = r.range(0.36, 0.44);
      const meet = outerStrand.find((p) => (P[crest][1] + h - p[1]) / h < level) ?? outerStrand[outerStrand.length >> 1];
      // Where the band comes up from: low down, at the back's foot if it reaches the sea on the
      // sheet, otherwise at the sheet's edge, well under where the back runs off it.
      const cut = P[foot][0] < 4 || P[foot][0] > sea.W - 4;
      const low = (d: number): Pt => !cut
        ? inward(foot, d)
        : [fwd > 0 ? 0 : sea.W, Math.max(P[foot][1] + h * (0.25 + d), P[crest][1] + h * (0.88 + d))];
      // Sagging a little, so it runs in low and then climbs to the V.
      const bow = (a: Pt): Pt => [(a[0] + meet[0]) / 2, (a[1] + meet[1]) / 2 + h * 0.06];
      // A few bands, one below another, each a little shorter, the first reaching the V.
      for (let k = 0, n = r.int(3, 4); k < n; k++) {
        const a = low(k * 0.11);
        strand(quad(a, bow(a), meet, 1 - k * 0.14), h * r.range(0.05, 0.065) * (1 - k * 0.1), k % 2 === 0 ? INK.blue : INK.mid);
      }
    }
  } else if (wv.kind === 'trough') {
    const L = P.map((_, i) => i).filter((i) => P[i][0] >= 0 && P[i][0] <= sea.W);
    // The long trough in front: a scatter of streaks lying along it at different depths, each
    // tapering away at both ends, as the print streaks the water in the foreground.
    if (L.length > 2) {
      const len = L.length - 1;
      for (let k = 0, n = r.int(8, 10); k < n; k++) {
        const a = r.range(-0.1, 0.75), b = a + r.range(0.2, 0.45), d = h * r.range(0.05, 0.4), w = h * r.range(0.03, 0.055);
        const up_: Pt[] = [], dn: Pt[] = [];
        for (let j = Math.max(0, Math.round(a * len)); j <= Math.min(len, Math.round(b * len)); j++) {
          const i = L[j], t = (j / len - a) / (b - a), hw = (w / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.7);
          up_.push([P[i][0] + N[i][0] * (d - hw), P[i][1] + N[i][1] * (d - hw)]);
          dn.push([P[i][0] + N[i][0] * (d + hw), P[i][1] + N[i][1] * (d + hw)]);
        }
        if (up_.length > 2) out.push({ pts: up_.concat(dn.reverse()), col: k % 2 === 0 ? INK.blue : INK.mid });
      }
    }
  }
  // A peak's strands are painted by peakStripes().
  return out;
}

/**
 * A peak's stripes: strands lying parallel to the surface one below another, from just under it
 * down to its foot, so they fill the wave right through, the middle under its point included.
 * They are the same size as the great wave's, whatever the peak's size (a small peak simply has
 * fewer), and each swells and thins along its length, now and then to nothing.
 *
 * Each is painted as a distance from the surface, the deepest first: its colour down to its
 * lower edge, then the dark laid back over everything above it, which leaves the strand. Measured
 * so, a strand keeps its width on a steep flank as on a gentle one, can never fold over where
 * the surface bends sharply, and under the point its two flanks meet in a clean V.
 */
function peakStripes(ctx: CanvasRenderingContext2D, sea: Sea, wv: Wave, f: Frame, r: Rng, along: (i: number, scale: number, salt: number) => number) {
  const { P, N } = f, h = wv.h;
  // Not from where a flank drops steeply away off the sheet: that would stripe the sheet's edge.
  const from = (i: number) => P[i][0] >= -50 && P[i][0] <= sea.W + 50 && (f.up[i] > 0.3 || Math.abs(N[i][1]) > 0.3);
  const W0 = sea.H * r.range(0.021, 0.025), G0 = sea.H * r.range(0.016, 0.02);
  const strands: { off: number; w: number; k: number }[] = [];
  for (let k = 0, off = W0 * 0.6; off < h * 1.1; k++) {
    const grow = 1 + k * 0.03, w = W0 * grow;
    strands.push({ off, w, k });
    off += w + G0 * grow;
  }
  for (const { off, w, k } of strands.reverse()) {
    const ww = (i: number) => w * Math.max(0, 0.85 + 0.5 * along(i, h * 0.5, 30 + k));
    band(ctx, P, (i) => off + ww(i), k % 2 === 0 ? INK.blue : INK.mid, from);
    band(ctx, P, () => off, INK.dark, from);
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

function fill(ctx: CanvasRenderingContext2D, pts: Pt[], col: string) {
  if (pts.length < 3) return;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
}
