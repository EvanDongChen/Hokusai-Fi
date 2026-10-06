// The shape of a wave. Every wave in the world, from the great one off Kanagawa to the little
// crests near the horizon, is the same construction at a different size and degree of curl:
//
//   - the back rises from its foot to the crest, a steep wall for big waves;
//   - the lip leaves the crest and curls over as a tapering spiral, thinning to a point;
//   - the face falls from under the lip, wraps round the hollow and runs out to the front foot.
//
// It is built in local coordinates (u forward along the breaking direction, v up from the foot)
// and mapped into the world. The hollow under the lip is left open, so whatever lies behind the
// wave (sky, a far sea, Fuji) shows through it, as it does in the print.

import { lerp, smoothstep } from '../core/math';
import type { Pt } from '../core/print';

export interface Wave {
  id: number;
  /** Crest x and the y of its foot. */
  x: number; base: number;
  /** Crest height above the foot. */
  h: number;
  /** Depth into the picture: 0 at the horizon, 1 in front. Nearer waves are drawn later. */
  z: number;
  dir: 1 | -1;
  /** 0: a rounded swell; 1: a full breaking curl. */
  curl: number;
  /** Length of the back slope and of the face, from the crest. */
  back: number; front: number;
  /** 0..1: how much foam, how many claws, how much spray. */
  foam: number;
}

/** A point on the outer edge of the lip. */
export interface LipSample {
  p: Pt;
  /** Outward normal and direction of travel (along the curl), in world coordinates. */
  n: Pt; t: Pt;
  /** Lip thickness here, and progress from crest (0) to tip (1). */
  th: number; s: number;
}

export interface WaveShape {
  /** Closed polygon of the whole body of water. */
  body: Pt[];
  /** Back slope then outer lip edge: the wave's silhouette from the foot to the tip. */
  top: Pt[];
  /** Index in `top` where the lip begins. */
  lipAt: number;
  lip: LipSample[];
  /** Inner edge of the lip, crest to tip. */
  inner: Pt[];
  /** From under the crest, round the hollow, to the front foot. */
  face: Pt[];
  /** Centre and radius of the curl. */
  center: Pt; R: number; T0: number;
  crestY: number; bottom: number;
  x0: number; x1: number;
  tip: Pt;
}

const cache = new Map<number, WaveShape>();

/**
 * The farthest a wave may reach from its crest. Planners look two chunks (2 x 740) either side
 * for features, so anything reaching further could be printed in one chunk and missed by its
 * neighbour, leaving a seam.
 */
const MAX_REACH = 1380;

export function waveShape(w: Wave): WaveShape {
  let s = cache.get(w.id);
  if (!s) {
    if (cache.size > 1500) cache.clear();
    s = build(w);
    cache.set(w.id, s);
  }
  return s;
}

/** The body runs on below its foot, fading out into the sea (see planWave). */
export const bodyDepth = (w: Wave) => w.h * 0.45 + 30;

/** Depth into the picture of water whose foot is at y: 0 at the horizon, 1 just below the frame. */
export const zOf = (y: number) => Math.min(1, Math.max(0, (y - 800) / 320));

function build(w: Wave): WaveShape {
  const { h, curl, dir } = w;
  const R = h * (0.1 + 0.15 * curl);
  const T0 = R * (0.86 - 0.2 * curl);
  const phi = lipSweep(curl);
  const cx = R * 0.3 * curl, cy = h - R - T0 / 2;
  const rIn = R - T0 / 2;
  // The face wraps only partway round, so the hollow stays open below the tip of the lip.
  const psi = Math.PI * 0.5 * curl;
  const g = 0.35;
  const ph = (w.id % 1000) * 0.37;

  const W = (u: number, v: number): Pt => [w.x + dir * u, w.base - v];
  const Wn = (nu: number, nv: number): Pt => [dir * nu, -nv];

  // Lip, crest to tip.
  const NL = Math.max(14, Math.round(10 + R / 5));
  const lipC: { u: number; v: number; th: number; th0: number; r: number; s: number }[] = [];
  for (let i = 0; i <= NL; i++) {
    const s = i / NL, th0 = Math.PI / 2 - phi * s;
    const r = R * (1 - 0.4 * Math.pow(s, 1.2));
    lipC.push({ u: cx + r * Math.cos(th0), v: cy + r * Math.sin(th0), th: T0 * Math.pow(1 - s, 0.85), th0, r, s });
  }

  // Face: from under the crest, round the hollow (its radius widening as it goes), to the front foot.
  const faceL: [number, number][] = [];
  const NF = Math.max(6, Math.round(4 + psi * R / 12));
  for (let i = 0; i <= NF; i++) {
    const a = Math.PI / 2 + (psi * i) / NF, r = rIn * (1 + g * (a - Math.PI / 2));
    faceL.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const reach = cx + R + T0 / 2;
  const front = Math.min(MAX_REACH / 2, Math.max(w.front, reach * 1.25 + 8));
  const e = faceL[faceL.length - 1], foot: [number, number] = [cx + front, 0];
  const ctrl: [number, number] = [e[0] + 0.15 * (foot[0] - e[0]), 0.1 * e[1]];
  for (let i = 1; i <= 12; i++) {
    const t = i / 12, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
    faceL.push([a * e[0] + b * ctrl[0] + c * foot[0], a * e[1] + b * ctrl[1] + c * foot[1]]);
  }

  // Back: from the foot up to the crest, arriving level. Lengthen it until it clears the face.
  const ex = 0.75 + (w.id % 7) * 0.05;
  const backAt = (B: number) => {
    const out: [number, number][] = [];
    const NB = Math.max(10, Math.round(B / 14));
    for (let i = 0; i <= NB; i++) {
      const t = i / NB;
      let v = h * Math.pow(smoothstep(0, 1, t), ex);
      v += h * 0.015 * Math.sin(t * 9 + ph) * t * (1 - t) * 4;
      out.push([cx - B * (1 - t), v]);
    }
    return out;
  };
  const uOnBack = (pts: [number, number][], v: number) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][1] >= v) {
        const a = pts[i - 1], b = pts[i], t = (v - a[1]) / Math.max(1e-6, b[1] - a[1]);
        return lerp(a[0], b[0], t);
      }
    }
    return pts[pts.length - 1][0];
  };
  let B = Math.min(MAX_REACH, Math.max(w.back, R * 2.2 + 10));
  let backL = backAt(B);
  for (let k = 0; k < 8 && B < MAX_REACH; k++) {
    const ok = faceL.every(([u, v]) => v < 1 || uOnBack(backL, v) < u - Math.max(6, h * 0.1));
    if (ok) break;
    B = Math.min(MAX_REACH, B * 1.18);
    backL = backAt(B);
  }

  const D = bodyDepth(w);
  const back = backL.map(([u, v]) => W(u, v));
  const lip: LipSample[] = lipC.map((c) => {
    const nu = Math.cos(c.th0), nv = Math.sin(c.th0);
    return { p: W(c.u + nu * c.th / 2, c.v + nv * c.th / 2), n: Wn(nu, nv), t: Wn(nv, -nu), th: c.th, s: c.s };
  });
  const inner = lipC.map((c) => W(c.u - Math.cos(c.th0) * c.th / 2, c.v - Math.sin(c.th0) * c.th / 2));
  const face = faceL.map(([u, v]) => W(u, v));
  const top = back.slice(0, -1).concat(lip.map((l) => l.p));
  const body = top.concat(inner.slice().reverse(), face, [W(foot[0], -D), W(cx - B, -D)]);
  const xs = body.map((p) => p[0]);

  return {
    body, top, lipAt: back.length - 1, lip, inner, face,
    center: W(cx, cy), R, T0, crestY: w.base - h, bottom: w.base + D,
    x0: Math.min(...xs), x1: Math.max(...xs), tip: lip[lip.length - 1].p,
  };
}

/**
 * Where the water's surface is at x, and its slope as an undirected angle: on the back slope up
 * to the crest, then on the lower face in front of it. Null if x is off the wave.
 */
export function surfaceAt(s: WaveShape, w: Wave, x: number): { y: number; angle: number } | null {
  const onSeg = (pts: Pt[], i: number) => (pts[i][0] - x) * (pts[i + 1][0] - x) <= 0 && pts[i][0] !== pts[i + 1][0];
  const at = (pts: Pt[], i: number) => {
    const a = pts[i], b = pts[i + 1], t = (x - a[0]) / (b[0] - a[0]);
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    return { y: lerp(a[1], b[1], t), angle: ang };
  };
  const ahead = (x - w.x) * w.dir > 0;
  if (!ahead) for (let i = 0; i < s.lipAt; i++) if (onSeg(s.top, i)) return at(s.top, i);
  for (let i = s.face.length - 2; i >= 0; i--) if (onSeg(s.face, i)) return at(s.face, i);
  return null;
}

/** Whether a point lies inside a polygon (even-odd). */
export function inPoly(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** How far round the lip curls, in radians from the crest to its tip. */
export const lipSweep = (curl: number) => Math.PI * (0.2 + 0.74 * curl);

/** Horizontal reach of a wave from its crest, before building it: used to find who can touch a chunk. */
export const waveReach = (w: Wave) => Math.min(MAX_REACH, Math.max(w.back * 1.6, w.h * 2.4)) + w.h * 0.3;
