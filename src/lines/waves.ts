// Waves as lines only, composed the way the print is. Hokusai's sea is only a few masses of water
// in three layers:
//
//  - far: the horizon, and Fuji small beneath it;
//  - middle: the great wave, its long back rising to a broad round dome that carries on forward
//    as a heavy hood, curling down at its front over the hollow beneath; sometimes a swell behind
//    it, cut off by the edge of the sheet;
//  - near: the small pointed wave that echoes Fuji, standing in front of the great wave's foot,
//    and the long swell rising out of the sheet at its far edge.
//
// Each mass is a smooth line through a handful of control points, taken from the shapes of the
// print, which the seed stretches and bends: how far the hood reaches, how round the dome is, how
// far the tip curls under, how big each wave is, where it stands and which way it breaks.
// Nearer layers fill the paper below their line, so they hide whatever lies behind them.

import { spline } from '../core/curve';
import { hashString, Rng } from '../core/rng';

export type Pt = [number, number];
export type Kind = 'great' | 'pointed' | 'swell';

export interface Wave {
  kind: Kind;
  /** The outline from its back foot to its front foot, in sheet coordinates. */
  line: Pt[];
  w: number;
}

export interface Layer { name: 'far' | 'middle' | 'near'; waves: Wave[]; }

export interface Sea { seed: string; W: number; H: number; horizon: number; fuji: Pt[] | null; layers: Layer[]; }

export const W = 1480, H = 1000;

/** A wave's control points in its own frame: u forward (the way it breaks), v up, its height 1. */
type Shape = Pt[];

/**
 * The great wave. Its back rises from far behind to a round dome; the top carries on forward as
 * a thick hood whose front bulges and curls down and back under itself; beneath the hood, the
 * hollow, and the face falling from it to the front foot.
 */
function great(r: Rng): Shape {
  const B = r.range(1.3, 1.8), dome = r.range(0.85, 1.2);
  // Taken from the print, in units of the wave's height: the hood reaches about 0.8 forward of the
  // crest, its tip hangs at about 0.45, the hollow beneath arches to about 0.66, and the face
  // falls about 0.31 forward of the crest.
  const R = r.range(0.7, 0.95), T = r.range(0.36, 0.46), A = r.range(0.54, 0.64), F = r.range(0.26, 0.36), curl = r.range(0, 0.06), k = R / 0.8;
  return [
    [-B, 0], [-B * 0.62, 0.28], [-B * 0.3, 0.66], [-0.14 * dome, 0.94],
    // The dome, and the hood running on from it.
    [0.05 * dome, 1], [0.24 * k, 0.97], [0.48 * k, 0.89], [0.7 * k, 0.78], [R * 0.96, 0.66], [R, 0.56],
    // Its front hanging down to the tip, which turns in a little.
    [R * 0.97, T + 0.05], [R * 0.9 - curl, T + curl * 0.4],
    // The hollow: the hood's underside arching back from the tip...
    [R * 0.84, T + 0.08], [R * 0.68, (T + A) / 2 + 0.03], [R * 0.52, A - 0.02], [F + 0.11, A], [F + 0.02, A - 0.05],
    // ...and the face falling from it to the front foot.
    [F, 0.5], [F + 0.03, 0.32], [F + 0.13, 0.16], [F + 0.34, 0],
  ];
}

/** The small pointed wave that echoes Fuji: hollow flanks rising to a peak, leaning a little. */
function pointed(r: Rng): Shape {
  const w = r.range(0.8, 1.25), lean = r.range(-0.04, 0.12), sharp = r.range(0.08, 0.16);
  return [
    [-w * 1.7, 0], [-w * 0.85, 0.16], [-w * 0.38, 0.48], [-w * sharp, 0.84],
    [lean, 1], [lean, 1],
    [w * sharp + lean * 0.5, 0.8], [w * 0.45, 0.44], [w * 0.95, 0.14], [w * 1.8, 0],
  ];
}

/** A long swell: a gentle back rising to a round crest, falling away in front. */
function swell(r: Rng): Shape {
  const L = r.range(1.6, 2.4), round = r.range(0.2, 0.45);
  return [
    [-L, 0], [-L * 0.55, 0.16], [-L * 0.22, 0.56], [-round * 0.5, 0.94],
    [round * 0.5, 1], [round + 0.25, 0.88], [round + 0.6, 0.5], [round + 1.1, 0.12], [round + 1.6, 0],
  ];
}

/** Set a shape on the sheet: its crest (u = 0) at x, its foot at y, `h` tall, breaking toward dir. */
function place(shape: Shape, x: number, foot: number, h: number, stretch: number, dir: 1 | -1): Pt[] {
  const pts = shape.map(([u, v]): Pt => [x + dir * u * h * stretch, foot - v * h]);
  // Lines run left to right on the sheet.
  return spline(dir > 0 ? pts : pts.reverse(), 4);
}

export function generate(seed: string): Sea {
  const r = new Rng(hashString(seed));
  const dir: 1 | -1 = r.chance(0.75) ? 1 : -1;
  /** x measured from the sheet's edge the waves break away from. */
  const X = (x: number) => (dir > 0 ? x : W - x);
  const horizon = H * r.range(0.62, 0.7);
  const middle: Wave[] = [], near: Wave[] = [];

  // The great wave.
  const gx = W * r.range(0.24, 0.42), gh = H * r.range(0.7, 0.86), gFoot = H * r.range(0.95, 1.03), gs = r.range(0.85, 1.1);
  // Sometimes a swell behind it, rising off the sheet's back edge.
  if (r.chance(0.5)) middle.push({ kind: 'swell', line: place(swell(r), X(-W * r.range(0.02, 0.12)), gFoot, H * r.range(0.35, 0.5), r.range(0.7, 1), dir), w: 2 });
  middle.push({ kind: 'great', line: place(great(r), X(gx), gFoot, gh, gs, dir), w: 2.6 });

  // In front: the pointed wave before the great wave's foot, and the long swell off the far edge.
  const fg = r.random();
  if (fg < 0.8) {
    const px = gx + gh * gs * r.range(0.05, 0.35);
    near.push({ kind: 'pointed', line: place(pointed(r), X(px), H * r.range(1.02, 1.08), H * r.range(0.36, 0.5), r.range(0.8, 1.1), dir), w: 2.2 });
  }
  if (fg > 0.3) {
    near.push({ kind: 'swell', line: place(swell(r), X(W * r.range(1.0, 1.15)), H * r.range(1.02, 1.1), H * r.range(0.45, 0.62), r.range(0.8, 1.1), dir), w: 2.2 });
  }

  // Fuji, small and far, under the hollow of the great wave.
  let fuji: Pt[] | null = null;
  if (r.chance(0.85)) {
    const fx = X(gx + gh * gs * r.range(0.55, 0.95)), fw = H * r.range(0.06, 0.1), fh = fw * r.range(0.45, 0.6);
    fuji = [[fx - fw, horizon], [fx - fw * 0.12, horizon - fh], [fx + fw * 0.12, horizon - fh], [fx + fw, horizon]];
  }

  return { seed, W, H, horizon, fuji, layers: [{ name: 'far', waves: [] }, { name: 'middle', waves: middle }, { name: 'near', waves: near }] };
}

/** Draw a sea: the far layer, then each nearer one, hiding what lies behind it. */
export function draw(ctx: CanvasRenderingContext2D, sea: Sea, o: { paper?: string; ink?: string; layers?: boolean } = {}) {
  const paper = o.paper ?? '#f3ebd6', ink = o.ink ?? '#1f3556';
  const fill = ['#e6edf0', '#d9e4ec', '#c9d8e6'];
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, sea.W, sea.H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  stroke(ctx, [[0, sea.horizon], [sea.W, sea.horizon]]);
  if (sea.fuji) stroke(ctx, sea.fuji);
  sea.layers.forEach((l, j) => {
    for (const wv of l.waves) {
      ctx.fillStyle = o.layers ? fill[j] : paper;
      ctx.beginPath();
      ctx.moveTo(wv.line[0][0], sea.H + 20);
      for (const p of wv.line) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(wv.line[wv.line.length - 1][0], sea.H + 20);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = wv.w;
      stroke(ctx, wv.line);
    }
  });
}

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}
