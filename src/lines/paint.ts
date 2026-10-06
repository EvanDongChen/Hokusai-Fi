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
  sky: '#ead9b8', dark: '#203e71', mid: '#3268ab', blue: '#4680c6', light: '#79a6d8', pale: '#a9c9d9', white: '#f5f0e3', key: '#152448',
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
  } else {
    // A peak: nested chevrons, the wave's own outline shifted straight down one below another
    // until they reach its foot. Each is sharp under the point and runs out along both flanks, so
    // the strands lie parallel to the flanks and fill the wave right through, the middle under
    // its point included. Each strand swells and thins along its length, now and then to nothing.
    const L = P.map((_, i) => i).filter((i) => P[i][0] >= -50 && P[i][0] <= sea.W + 50);
    // Strands the same size as the great wave's, whatever the peak's size: a small peak simply
    // has fewer. Each is the surface offset straight into the water, so it keeps its width on a
    // steep flank as on a gentle one; under the point, where the two flanks' offsets cross, the
    // loop they make is cut away, leaving a clean V.
    const W0 = sea.H * r.range(0.021, 0.025), G0 = sea.H * r.range(0.016, 0.02);
    let off = W0 * 0.6;
    for (let k = 0; off < h * 1.1; k++) {
      const grow = 1 + k * 0.03, w = W0 * grow;
      // Split where the strand thins to nothing, so it swells and breaks along its length.
      let run: number[] = [];
      const flush = () => {
        if (run.length > 2) {
          const top = untangle(run.map((i): Pt => [P[i][0] + N[i][0] * off, P[i][1] + N[i][1] * off]));
          const bot = untangle(run.map((i) => {
            const ww = w * Math.max(0, 0.85 + 0.5 * along(i, h * 0.5, 30 + k));
            return [P[i][0] + N[i][0] * (off + ww), P[i][1] + N[i][1] * (off + ww)] as Pt;
          }));
          out.push({ pts: top.concat(bot.reverse()), col: k % 2 === 0 ? INK.blue : INK.mid });
        }
        run = [];
      };
      for (const i of L) {
        if (w * Math.max(0, 0.85 + 0.5 * along(i, h * 0.5, 30 + k)) < 0.6) flush();
        else run.push(i);
      }
      flush();
      off += w + G0 * grow;
    }
  }
  return out;
}

/**
 * A polyline with the loops cut out of it: where it crosses itself (as an offset of a sharp point
 * does), the stretch between the crossing's two segments is replaced by the crossing point.
 */
function untangle(Q: Pt[]): Pt[] {
  const out = Q.slice();
  for (let i = 0; i < out.length - 3; i++) {
    for (let j = Math.min(out.length - 2, i + 150); j >= i + 2; j--) {
      const x = cross(out[i], out[i + 1], out[j], out[j + 1]);
      if (x) {
        out.splice(i + 1, j - i, x);
        break;
      }
    }
  }
  return out;
}

/** Where segments ab and cd cross, if they do. */
function cross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + ry * t] : null;
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
