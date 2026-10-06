// Waves as lines only. A seed lays a sea out as a few layers of water, from the horizon to the
// foot of the sheet, each one a single line running across: a chain of crests, each crest one of
// Hokusai's shapes.
//
//  - round: a smooth swell, its top rounded;
//  - pointy: hollow sides rising to a peak, like the small wave in the print that echoes Fuji;
//  - curl: a crest leaning forward whose lip throws out and rolls over, the face falling away
//    beneath it into the hollow.
//
// Nearer layers are bigger and drawn later, and each fills the paper below its line, so it hides
// the farther lines behind it. Nothing else: no colour, no foam, just the shapes of the water.

import { hashString, Rng } from '../core/rng';

export type Pt = [number, number];
export type Kind = 'round' | 'pointy' | 'curl';

/** One crest: where it stands between its two troughs, how high, which shape, how far it leans. */
export interface Crest { x0: number; x1: number; h: number; kind: Kind; lean: number; sharp: number; }

export interface Layer {
  /** Depth: 0 at the horizon, 1 in front. */
  z: number;
  /** Rest level of the water. */
  base: number;
  crests: Crest[];
  /** The line: the surface, from left to right. Curling lips are separate strokes. */
  surface: Pt[];
  lips: Pt[][];
  /** Line width. */
  w: number;
}

export interface Sea { seed: string; W: number; H: number; horizon: number; layers: Layer[]; }

export const W = 1480, H = 1000;

export function generate(seed: string): Sea {
  const r = new Rng(hashString(seed));
  const horizon = H * r.range(0.62, 0.74), n = r.int(5, 8), dir = r.chance(0.75) ? 1 : -1;
  // One great wave in one of the nearer layers.
  const heroLayer = n - 1 - r.int(0, 2);
  const layers: Layer[] = [];
  for (let j = 0; j < n; j++) {
    const z = (j + 1) / n, d = Math.pow(z, 1.6);
    const base = horizon + (H * 1.04 - horizon) * d, s = 0.08 + 0.92 * Math.pow(z, 1.4);
    const crests = crestsFor(r, s, j === heroLayer, dir);
    const { surface, lips } = shape(crests, base, dir);
    layers.push({ z, base, crests, surface, lips, w: 0.8 + 2.4 * s });
  }
  return { seed, W, H, horizon, layers };
}

/** The crests of one layer, trough to trough across the sheet and a little beyond. */
function crestsFor(r: Rng, s: number, hero: boolean, dir: 1 | -1): Crest[] {
  const out: Crest[] = [];
  const heroAt = hero ? r.range(0.25, 0.65) * W : -1;
  let x = -r.range(0.1, 0.6) * 500 * s - 40;
  while (x < W + 40) {
    let w = r.range(160, 520) * s + 30, h = w * r.range(0.18, 0.34);
    let kind: Kind = r.pick(['round', 'round', 'pointy', 'pointy', 'curl'] as const);
    // Far off, the sea is small rounded and pointed crests; curls need room to show.
    if (s < 0.25 && kind === 'curl') kind = 'pointy';
    if (hero && x < heroAt && x + w > heroAt) {
      w = r.range(700, 1000);
      h = r.range(0.42, 0.6) * H;
      kind = 'curl';
    }
    out.push({ x0: x, x1: x + w, h, kind, lean: kind === 'curl' ? r.range(0.08, 0.2) : kind === 'pointy' ? r.range(0, 0.25) : r.range(0, 0.15), sharp: r.range(0, 1) });
    x += w;
  }
  // Breaking left: the same sea mirrored, its crests still in order from left to right.
  if (dir < 0) {
    for (const c of out) [c.x0, c.x1] = [W - c.x1, W - c.x0];
    out.reverse();
  }
  return out;
}

/** Height of a crest as a share of its own, at u from its back trough (0) to its front one (1). */
function profile(c: Crest, u: number): number {
  if (c.kind === 'round') {
    // A rounded top, flanks easing into the troughs.
    return Math.pow(Math.sin(Math.PI * u), 1.2 + c.sharp * 0.8);
  }
  if (c.kind === 'curl') {
    // A long concave back sweeping up, rounding over at the top into the lip; a steep front.
    const peak = 0.6 + c.sharp * 0.08;
    if (u < peak) {
      const v = u / peak;
      return Math.pow(v, 1.8 + c.sharp);
    }
    return Math.pow((1 - u) / (1 - peak), 0.9);
  }
  // Pointy crests rise on hollow sides to a peak, the front a little steeper than the back.
  const peak = 0.5 + c.sharp * 0.1, k = 1.6 + c.sharp * 1.2;
  const v = u < peak ? u / peak : (1 - u) / (1 - peak);
  return Math.pow(v, k);
}

/** The surface of a layer, and the lips of its curling crests. */
function shape(crests: Crest[], base: number, dir: 1 | -1) {
  const surface: Pt[] = [], lips: Pt[][] = [];
  for (const c of crests) {
    const span = c.x1 - c.x0, n = Math.max(12, Math.round(span / 4));
    // Walk the crest from its back trough to its front one (in the breaking direction).
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, f = profile(c, u), y = base - c.h * f;
      // Leaning forward: the higher, the further.
      const x = (dir > 0 ? c.x0 + span * u : c.x1 - span * u) + dir * c.lean * c.h * f * f;
      pts.push([x, y]);
    }
    if (c.kind === 'curl') {
      // The lip leaves the crest and rolls over; the face below it is drawn back into the hollow,
      // most at half height, so it leaves the crest smoothly and meets the trough again.
      const top = pts.reduce((b, p, i) => (p[1] < pts[b][1] ? i : b), 0), R = c.h * 0.32;
      for (let i = top + 1; i < pts.length; i++) {
        const f = (base - pts[i][1]) / c.h;
        pts[i] = [pts[i][0] - dir * R * 0.85 * Math.pow(Math.sin(Math.PI * Math.min(1, f)), 0.8), pts[i][1]];
      }
      lips.push(lip(pts[top], R, dir));
    }
    if (dir < 0) pts.reverse();
    surface.push(...(surface.length ? pts.slice(1) : pts));
  }
  return { surface, lips };
}

/**
 * A curling lip from the crest, as a band: its outer edge reaching forward and turning ever more
 * tightly to the tip, its inner edge returning from the tip to just under the crest.
 */
function lip(from: Pt, R: number, dir: 1 | -1): Pt[] {
  const n = 40, L = R * 2.6, turn = 2.8, T = R * 0.55, spine: Pt[] = [from];
  let x = from[0], y = from[1], a = 0.25;
  for (let i = 1; i < n; i++) {
    const s0 = (i - 1) / (n - 1), s1 = i / (n - 1), a1 = a - turn * (s1 * s1 - s0 * s0);
    x += dir * Math.cos((a + a1) / 2) * (L / (n - 1));
    y -= Math.sin((a + a1) / 2) * (L / (n - 1));
    a = a1;
    spine.push([x, y]);
  }
  // Outer edge is the spine; the inner edge lies inside the turn, the lip thinning to its tip.
  const inner: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = spine[Math.max(0, i - 1)], q = spine[Math.min(n - 1, i + 1)], tx = q[0] - p[0], ty = q[1] - p[1], l = Math.hypot(tx, ty) || 1;
    // Inside the turn is to the right of travel for a wave breaking right, to the left otherwise.
    const nx = (-ty / l) * dir, ny = (tx / l) * dir, th = T * Math.pow(1 - i / (n - 1), 0.8);
    inner.push([spine[i][0] + nx * th, spine[i][1] + ny * th]);
  }
  return spine.concat(inner.reverse());
}

/** Draw a sea: each layer, back to front, hiding what lies behind it. */
export function draw(ctx: CanvasRenderingContext2D, sea: Sea, o: { paper?: string; ink?: string; layers?: boolean } = {}) {
  const paper = o.paper ?? '#f3ebd6', ink = o.ink ?? '#1f3556';
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, sea.W, sea.H);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, sea.horizon);
  ctx.lineTo(sea.W, sea.horizon);
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  sea.layers.forEach((l, j) => {
    // The paper of this layer's water covers the lines of the layers behind it.
    ctx.fillStyle = o.layers ? `hsl(${210 + j * 12}, 40%, ${92 - j * 4}%)` : paper;
    ctx.beginPath();
    ctx.moveTo(l.surface[0][0], sea.H + 10);
    for (const p of l.surface) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(l.surface[l.surface.length - 1][0], sea.H + 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = l.w;
    stroke(ctx, l.surface);
    for (const lp of l.lips) {
      ctx.fillStyle = o.layers ? `hsl(${210 + j * 12}, 40%, ${92 - j * 4}%)` : paper;
      ctx.beginPath();
      ctx.moveTo(lp[0][0], lp[0][1]);
      for (const p of lp) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.fill();
      stroke(ctx, lp, true);
    }
  });
}

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[], closed = false) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
  ctx.stroke();
}
