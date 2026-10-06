// Waves as lines only. Each wave is one stroke, as a hand would draw it: up its back, over its
// crest, and down its front into a long trough that runs on until it leaves the sheet. Nearer
// strokes hide farther ones, and that is all the layering there is.
//
// The crests are Hokusai's:
//  - the great wave: a broad round dome whose hood bulges forward and tucks under, its face then
//    falling in a long concave sweep into the trough;
//  - a dome: the same mass not yet breaking, rounded over;
//  - a peak: hollow flanks rising to a sharp point, sometimes with a small hook at the tip;
//  - and the nearest water, a long trough sagging across the foot of the sheet.
//
// A seed composes a few of them: one great wave or dome, two or three peaks of different sizes at
// different depths, and sometimes the trough in front.

import { spline } from '../core/curve';
import { hashString, Rng } from '../core/rng';

export type Pt = [number, number];
export type Kind = 'great' | 'dome' | 'peak' | 'hook' | 'trough';

export interface Wave {
  kind: Kind;
  /** Depth: farther waves (smaller z) are drawn first and hidden by nearer ones. */
  z: number;
  /** The stroke, left to right, running off the sheet at both ends. */
  line: Pt[];
}

export interface Sea { seed: string; W: number; H: number; waves: Wave[]; }

export const W = 1480, H = 1000;

/** Beyond the sheet's edges, where every stroke begins and ends. */
const OFF = 60;

/** A stroke running on from a wave's foot to the sheet's edge, sagging a little as a trough does. */
function runOff(foot: Pt, end: Pt): Pt[] {
  const sag = Math.abs(end[0] - foot[0]) * 0.07;
  return [[(foot[0] + end[0]) / 2, (foot[1] + end[1]) / 2 + sag], end];
}

/**
 * The great wave (or, not yet breaking, a dome) with its crest at (x, top), `h` tall, `w` wide,
 * breaking right: back, dome, hood bulging forward and tucking in, face sweeping into the trough.
 */
function great(r: Rng, x: number, top: number, h: number, w: number, breaking: boolean): Pt[] {
  const b = top + h, tuck = breaking ? r.range(0.1, 0.18) : r.range(0.02, 0.06), bulge = r.range(0.5, 0.62);
  return [
    ...runOff([x - w * 1.2, b - h * 0.02], [-OFF, b + (H + OFF - b) * r.range(0.1, 0.6)]).reverse(),
    [x - w * 1.2, b - h * 0.02],
    [x - w * 0.85, b - h * 0.35],
    [x - w * 0.55, b - h * 0.72],
    [x - w * 0.25, b - h * 0.96],
    [x, top],
    [x + w * 0.28, top + h * 0.05],
    [x + w * bulge, b - h * 0.8],
    [x + w * (bulge + 0.04), b - h * 0.66],
    // The hood tucks in under itself, then the face falls away, hollow, into the trough.
    [x + w * (bulge - tuck), b - h * 0.52],
    [x + w * (bulge - tuck - 0.02), b - h * 0.4],
    [x + w * (bulge - tuck + 0.06), b - h * 0.2],
    [x + w * (bulge + 0.3), b - h * 0.04],
    [x + w * (bulge + 0.9), b + h * 0.02],
    // The trough runs on, gently, to the sheet's edge.
    ...runOff([x + w * (bulge + 0.9), b + h * 0.02], [W + OFF, b + (H - b) * r.range(-0.2, 0.4)]),
  ];
}

/** A peak: hollow flanks rising to a point at (x, top), `h` tall; with `hook`, its tip turns over. */
function peak(r: Rng, x: number, top: number, h: number, w: number, hook: boolean): Pt[] {
  const b = top + h, lean = r.range(-0.04, 0.08) * w;
  const pts: Pt[] = [
    // The flanks keep falling away as they run off the sheet, rather than levelling out.
    ...runOff([x - w * 1.6, b + h * 0.05], [-OFF, b + (H + OFF - b) * r.range(0.3, 0.8)]).reverse(),
    [x - w * 1.6, b + h * 0.05],
    [x - w * 0.8, b - h * 0.2],
    [x - w * 0.32, b - h * 0.55],
    [x - w * 0.08 + lean, b - h * 0.9],
    [x + lean, top], [x + lean, top],
  ];
  if (hook) {
    // The tip turns forward and down, and the front drops sheer beneath it before flaring out.
    pts.push([x + lean + w * 0.06, top + h * 0.06], [x + lean + w * 0.02, top + h * 0.2], [x + lean + w * 0.04, top + h * 0.45]);
  } else {
    pts.push([x + lean + w * 0.08, top + h * 0.12], [x + lean + w * 0.3, top + h * 0.48]);
  }
  pts.push([x + w * 0.8, b - h * 0.12], [x + w * 1.7, b + h * 0.05], ...runOff([x + w * 1.7, b + h * 0.05], [W + OFF, b + (H + OFF - b) * r.range(0.2, 0.7)]));
  return pts;
}

/** The nearest water: a long trough sagging across the foot of the sheet. */
function trough(r: Rng): Pt[] {
  const low = H * r.range(0.86, 0.96), at = W * r.range(0.35, 0.7);
  return [[-OFF, H * r.range(0.6, 0.78)], [W * 0.15, H * r.range(0.74, 0.84)], [at, low], [W * 0.85, H * r.range(0.74, 0.84)], [W + OFF, H * r.range(0.58, 0.74)]];
}

export function generate(seed: string): Sea {
  const r = new Rng(hashString(seed)), waves: Wave[] = [];
  const dir: 1 | -1 = r.chance(0.75) ? 1 : -1;

  // The great wave (or a dome), up and to one side.
  const gh = H * r.range(0.5, 0.7), gw = gh * r.range(0.7, 0.95), gx = W * r.range(0.15, 0.32);
  const breaking = r.chance(0.75);
  waves.push({ kind: breaking ? 'great' : 'dome', z: r.range(0.3, 0.45), line: great(r, gx, H * r.range(0.04, 0.16), gh, gw, breaking) });

  // Two or three peaks: big ones farther back, small ones in front, spread across the rest.
  const n = r.int(2, 3);
  for (let i = 0; i < n; i++) {
    const z = r.range(0.2, 0.95), h = H * r.range(0.14, 0.32) * (0.7 + z * 0.5), w = h * r.range(0.7, 1.1);
    const x = i === 0 ? gx + gw * r.range(-0.3, 0.2) : W * r.range(0.5, 0.92);
    const top = H * (0.25 + z * 0.55) - h * 0.3;
    const hook = r.chance(0.35);
    waves.push({ kind: hook ? 'hook' : 'peak', z, line: peak(r, x, top, h, w, hook) });
  }
  if (r.chance(0.45)) waves.push({ kind: 'trough', z: 1, line: trough(r) });

  waves.sort((a, b) => a.z - b.z);
  for (const wv of waves) {
    // Breaking left: the whole sea mirrored.
    if (dir < 0) wv.line = wv.line.map(([x, y]): Pt => [W - x, y]).reverse();
    wv.line = spline(wv.line, 4);
  }
  return { seed, W, H, waves };
}

/** Draw a sea: each stroke back to front, each one's water hiding the strokes behind it. */
export function draw(ctx: CanvasRenderingContext2D, sea: Sea, o: { paper?: string; ink?: string; layers?: boolean } = {}) {
  const paper = o.paper ?? '#f6e7b0', ink = o.ink ?? '#141414';
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, sea.W, sea.H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  sea.waves.forEach((wv, j) => {
    ctx.fillStyle = o.layers ? `hsl(${200 + j * 25}, 45%, ${88 - j * 5}%)` : paper;
    ctx.beginPath();
    ctx.moveTo(wv.line[0][0], sea.H + OFF);
    for (const p of wv.line) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(wv.line[wv.line.length - 1][0], sea.H + OFF);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(wv.line[0][0], wv.line[0][1]);
    for (const p of wv.line) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  });
}
