// The splashes on the crests, as the print cuts them: claws of foam. A claw is a finger of white
// that reaches out and curls over, ever more tightly toward its tip, like a hook. Smaller claws
// branch from its outer side and curl the same way, and smaller ones again from theirs, so a
// crest breaks into a fractal of hooks. Each claw has a pale-blue shadow pooled in the hollow of
// its curl, and most are outlined in the key block's dark line along their outer side, which
// thickens through the middle of the curl and thins away at both ends.

import type { Rng } from '../core/rng';
import type { Pt } from './waves';

export interface ClawInk { white: string; pale: string; key: string; }

export interface ClawOpts {
  /** Length of the claw's spine, and its width at the root. */
  len: number; w: number;
  /** 1 curls clockwise on the sheet, -1 anticlockwise. */
  turn: 1 | -1;
  /** How many generations of smaller claws branch from it. */
  depth: number;
  /** Width of the key line at its thickest. */
  line: number;
}

/** A claw rooted at (x, y), setting out at angle `a` (radians, y down). */
export function claw(ctx: CanvasRenderingContext2D, r: Rng, x: number, y: number, a: number, o: ClawOpts, ink: ClawInk) {
  const n = 16, curl = r.range(2.6, 3.6), spine: Pt[] = [], head: number[] = [];
  let px = x, py = y;
  for (let k = 0; k <= n; k++) {
    const t = k / n, h = a + o.turn * curl * Math.pow(t, 2.2);
    spine.push([px, py]);
    head.push(h);
    px += (Math.cos(h) * o.len) / n;
    py += (Math.sin(h) * o.len) / n;
  }
  /** The side the claw curls toward, at sample k. */
  const inward = (k: number): Pt => [-Math.sin(head[k]) * o.turn, Math.cos(head[k]) * o.turn];
  const half = (t: number) => Math.max(0.35, (o.w / 2) * Math.pow(1 - t, 0.6) * (0.85 + 0.3 * Math.sin(Math.PI * t)));
  const edge = (side: number, d: (t: number) => number, t0 = 0, t1 = 1): Pt[] => {
    const out: Pt[] = [];
    for (let k = Math.round(t0 * n); k <= Math.round(t1 * n); k++) {
      const v = inward(k), dd = d(k / n) * side;
      out.push([spine[k][0] + v[0] * dd, spine[k][1] + v[1] * dd]);
    }
    return out;
  };

  // The smaller claws first, so the parent covers their roots.
  if (o.depth > 0 && o.len > 10) {
    const kids = r.int(2, 3);
    for (let j = 0; j < kids; j++) {
      const t = 0.18 + (j / kids) * 0.5 + r.range(0, 0.08), k = Math.round(t * n), v = inward(k), d = half(t) * 0.6;
      claw(ctx, r, spine[k][0] - v[0] * d, spine[k][1] - v[1] * d, head[k] - o.turn * r.range(0.7, 1.2), {
        ...o, len: o.len * r.range(0.42, 0.58), w: o.w * 0.58, depth: o.depth - 1, line: Math.max(0.8, o.line * 0.7),
      }, ink);
    }
  }

  // The pale shadow in the hollow of the curl.
  const pw = (t: number) => o.w * 0.75 * Math.sin((Math.PI * (t - 0.35)) / 0.6);
  fill(ctx, edge(1, half, 0.35, 0.95).concat(edge(1, (t) => half(t) + Math.max(0, pw(t)), 0.35, 0.95).reverse()), ink.pale);
  // The white of the claw.
  fill(ctx, edge(-1, half).concat(edge(1, half).reverse()), ink.white);
  // The key line along its outer side, wrapping round the tip.
  if (r.chance(0.8)) {
    const lw = (t: number) => o.line * (0.25 + Math.sin(Math.PI * Math.min(1, 0.1 + t)));
    fill(ctx, edge(-1, half, 0.08, 1).concat(edge(-1, (t) => half(t) + lw(t), 0.08, 1).reverse()), ink.key);
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
