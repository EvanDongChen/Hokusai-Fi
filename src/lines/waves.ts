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
  /** Its own seed, for everything painted on it. */
  id: number;
  /** How tall it stands, crest above foot. */
  h: number;
  /** Depth: farther waves (smaller z) are drawn first and hidden by nearer ones. */
  z: number;
  /** The stroke, left to right, running off the sheet at both ends. */
  line: Pt[];
}

export interface Sea {
  seed: string; W: number; H: number;
  /** Which way the waves break: 1 to the right, -1 to the left. */
  dir: 1 | -1;
  waves: Wave[];
}

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

/**
 * A peak: hollow flanks rising to a sharp point at (x, top), `h` tall, as the print's small waves
 * are drawn. Each flank is a power curve, so it is concave and steepens all the way to the point,
 * which is a true corner rather than a rounded top. The front flank is shorter and steeper; with
 * `hook`, the point leans forward over it.
 */
function peak(r: Rng, x: number, top: number, h: number, w: number, hook: boolean): Pt[] {
  const b = top + h, wb = w * r.range(1.3, 1.8), wf = w * r.range(0.8, 1.15);
  const pb = r.range(1.9, 2.5), pf = r.range(1.7, 2.3), lean = w * (hook ? r.range(0.12, 0.2) : r.range(0, 0.08));
  const n = 24, pts: Pt[] = [];
  // Up the back flank to the point, then down the front.
  for (let k = 0; k <= n; k++) {
    // t: distance from the point, as a share of the flank. Height (1 - t)^p is concave.
    const t = 1 - k / n, v = Math.pow(1 - t, pb);
    pts.push([x - wb * t + lean * Math.pow(1 - t, 6), b - h * v]);
  }
  for (let k = 1; k <= n; k++) {
    const t = k / n, v = Math.pow(1 - t, pf);
    pts.push([x + wf * t + lean * Math.pow(1 - t, 6), b - h * v]);
  }
  // The flanks keep falling away as they run off the sheet, rather than levelling out.
  return [
    ...runOff([x - wb, b], [-OFF, b + (H + OFF - b) * r.range(0.3, 0.8)]).reverse(),
    ...pts,
    ...runOff([x + wf, b], [W + OFF, b + (H + OFF - b) * r.range(0.2, 0.7)]),
  ];
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
  waves.push({ kind: breaking ? 'great' : 'dome', id: r.int(0, 1e9), h: gh, z: r.range(0.3, 0.45), line: great(r, gx, H * r.range(0.04, 0.16), gh, gw, breaking) });

  // Two or three peaks: big ones farther back, small ones in front, spread across the rest.
  const n = r.int(2, 3);
  for (let i = 0; i < n; i++) {
    const z = r.range(0.2, 0.95), h = H * r.range(0.14, 0.32) * (0.7 + z * 0.5), w = h * r.range(0.7, 1.1);
    const x = i === 0 ? gx + gw * r.range(-0.3, 0.2) : W * r.range(0.5, 0.92);
    const top = H * (0.25 + z * 0.55) - h * 0.3;
    const hook = r.chance(0.35);
    waves.push({ kind: hook ? 'hook' : 'peak', id: r.int(0, 1e9), h, z, line: peak(r, x, top, h, w, hook) });
  }
  if (r.chance(0.45)) waves.push({ kind: 'trough', id: r.int(0, 1e9), h: H * 0.3, z: 1, line: trough(r) });

  waves.sort((a, b) => a.z - b.z);
  for (const wv of waves) {
    // Breaking left: the whole sea mirrored.
    if (dir < 0) wv.line = wv.line.map(([x, y]): Pt => [W - x, y]).reverse();
    // Peaks are already finely drawn, and keep their sharp points; the rest are smoothed.
    if (wv.kind !== 'peak' && wv.kind !== 'hook') wv.line = spline(wv.line, 4);
  }
  return { seed, W, H, dir, waves };
}
