// The sea as one body of water. Nothing here is drawn; it is the water the print is cut from.
//
// The sea is a stack of bands, from the horizon to the foot of the sheet, as Hokusai stacks his
// masses of water one behind another. Each band's surface is a snapshot of a forced sea:
//
//  - a swell, as a sum of trochoidal (Gerstner) waves, the closed-form motion of deep water: each
//    particle of the surface turns in a circle, so crests sharpen and troughs flatten;
//  - packets of energy the wind has thrown into it, one perhaps in each stretch of each band,
//    each lifting the surface into a crest with a long back and a steep front, sheared forward
//    in proportion to its height;
//  - where a packet is steep enough, it breaks. Its lip is simulated: water is thrown off the
//    crest as a jet and rolled up by the vortex that forms under it, and the streak it leaves is
//    the curling lip, with the hollow open beneath.
//
// Everything is a function of world position and the seed (no time-stepping across the world),
// so any stretch of the sea can be computed on its own, and two chunks always agree.

import type { Pt } from '../core/print';
import { clamp, lerp, smoothstep } from '../core/math';
import { Noise } from '../core/noise';
import { hash, hashFloat, Rng } from '../core/rng';
import { zOf } from './wave';
import { H, HZ, type World } from './world';

/** Distance between samples along a surface, in world px. Samples sit on a world grid. */
export const STEP = 3;
/** How far anything in a band (packet, sheared crest, curl) may reach from its cell's centre. */
export const FIELD_REACH = 1300;

export interface Band {
  j: number;
  /** The water's rest level, and how big the band's sea is (perspective: 0 far, 1 in front). */
  base: number; s: number;
  /** Depth into the picture, for ordering: farther bands print first. */
  z: number;
  /** Width of the stretches that may each hold one packet. */
  cell: number;
}

export type Kind = 'swell' | 'spill' | 'plunge';

/** A packet of energy thrown into a band: a crest with a long back and a steep front. */
export interface Packet {
  id: number; band: number;
  /** Where it peaks, along the band, and how high. */
  c: number; E: number;
  /** Width of its back and of its front. */
  back: number; front: number;
  /** How far its top is pushed forward, as a share of its height. */
  shear: number;
  dir: 1 | -1;
  kind: Kind;
}

/** A simulated lip: its spine from the crest to the tip, its thickness along it, and its edges. */
export interface Curl {
  spine: Pt[]; outer: Pt[]; inner: Pt[];
  /** Radius of the roll, and the centre it rolled round. */
  R: number; eye: Pt;
}

/** One sample of a band's surface. */
export interface Sample {
  /** Where the water at rest was (world x), and where it is now. */
  a: number; p: Pt;
  /** Height above rest, and the packet lifting it most (if any) with its share of that packet's height. */
  h: number; packet: Packet | null; f: number;
}

const BANDS = 11;

export function bands(): Band[] {
  const out: Band[] = [];
  for (let j = 0; j < BANDS; j++) {
    const f = (j + 0.5) / BANDS, d = Math.pow(f, 1.5);
    const base = HZ + 4 + (H * 1.05 - HZ - 4) * d;
    out.push({ j, base, s: lerp(0.05, 1, Math.pow(f, 1.45)), z: zOf(base) + j * 1e-4, cell: lerp(130, 1150, Math.pow(f, 1.25)) });
  }
  return out;
}

/** How rough the sea is at x: great waves off Kanagawa, glassy in the bay. */
export function roughness(world: World, x: number): number {
  const b = world.biomeWeights(x);
  return b.kanagawa * 1 + b.swell * 0.8 + b.fuji * 0.35 + b.coast * 0.5 + b.isles * 0.6 + world.moodWeight(x, 'storm') * 0.3;
}

// ------------------------------------------------------------ forcing

/** The packet thrown into stretch k of a band, if any. */
export function packetAt(world: World, band: Band, k: number): Packet | null {
  const key = hash(world.s, 0xf1, band.j, k);
  const memo = packetMemo.get(key);
  if (memo !== undefined) return memo;
  const r = new Rng(key), c = (k + r.range(0.2, 0.8)) * band.cell, rough = roughness(world, c);
  let p: Packet | null = null;
  if (r.chance(0.3 + 0.55 * rough)) {
    // Mostly modest crests; now and then a great one, more often in front and in rough water.
    const big = Math.pow(r.random(), 2.2) * rough;
    const E = band.s * lerp(40, 640, big) * r.range(0.8, 1.2);
    const steep = big * r.range(0.8, 1.25);
    const kind: Kind = steep > 0.6 && band.s > 0.3 ? 'plunge' : steep > 0.1 ? 'spill' : 'swell';
    p = {
      id: key, band: band.j, c, E,
      back: E * r.range(1.5, 2.6) + band.s * 60, front: E * r.range(0.45, 0.8) + band.s * 25,
      shear: kind === 'plunge' ? r.range(0.25, 0.45) : r.range(0.1, 0.3),
      dir: world.dir, kind,
    };
  }
  if (packetMemo.size > 20000) packetMemo.clear();
  packetMemo.set(key, p);
  return p;
}
const packetMemo = new Map<number, Packet | null>();

/** The packets that can reach [x0, x1] of a band. */
export function packetsNear(world: World, band: Band, x0: number, x1: number): Packet[] {
  const out: Packet[] = [];
  for (let k = Math.floor((x0 - FIELD_REACH) / band.cell); k <= Math.ceil((x1 + FIELD_REACH) / band.cell); k++) {
    const p = packetAt(world, band, k);
    if (p && p.c + p.front * 3 + p.E > x0 - FIELD_REACH * 0.2 && p.c - p.back * 3 < x1 + FIELD_REACH * 0.2) out.push(p);
  }
  return out;
}

/** A packet's lift at rest position a, as a share of its height: long behind, short in front. */
function lift(p: Packet, a: number): number {
  const u = (a - p.c) * p.dir, w = u < 0 ? p.back : p.front;
  return Math.exp(-(u / w) * (u / w));
}

// ------------------------------------------------------------ the swell

interface Swell { k: number; A: number; Q: number; ph: number; }
const swellMemo = new Map<number, { comps: Swell[]; noise: Noise }>();

function swellOf(world: World, band: Band) {
  const key = hash(world.s, 0xf0, band.j);
  let m = swellMemo.get(key);
  if (!m) {
    const r = new Rng(key), comps: Swell[] = [];
    for (let i = 0; i < 4; i++) {
      const lambda = band.s * r.range(260, 900) + 30, A = lambda * r.range(0.012, 0.03), k = (Math.PI * 2) / lambda;
      comps.push({ k, A, Q: r.range(0.5, 0.9) / (k * A * 4), ph: r.range(0, Math.PI * 2) });
    }
    m = { comps, noise: new Noise(r) };
    if (swellMemo.size > 200) swellMemo.clear();
    swellMemo.set(key, m);
  }
  return m;
}

// ------------------------------------------------------------ the surface

/**
 * A band's surface over rest positions [a0, a1], sampled on the world grid. Breaking packets
 * are not spliced in here: their lips are separate (see `curlOf`), and the face under each is
 * drawn back into the hollow.
 */
export function surface(world: World, band: Band, a0: number, a1: number): Sample[] {
  // Assembled from world tiles, each computed once: neighbouring chunks share most of theirs.
  const out: Sample[] = [], m0 = Math.floor(a0 / STEP), m1 = Math.ceil(a1 / STEP);
  for (let k = Math.floor(m0 / TILE); k <= Math.floor(m1 / TILE); k++) {
    const t = tile(world, band, k);
    for (let i = Math.max(0, m0 - k * TILE); i < TILE && k * TILE + i <= m1; i++) out.push(t[i]);
  }
  return out;
}

/** Samples per tile. */
const TILE = 240;
const tileMemo = new Map<number, Sample[]>();

function tile(world: World, band: Band, k: number): Sample[] {
  const key = hash(world.s, 0xf3, band.j, k);
  let t = tileMemo.get(key);
  if (!t) {
    t = sampleRange(world, band, k * TILE, (k + 1) * TILE - 1);
    if (tileMemo.size > 600) tileMemo.clear();
    tileMemo.set(key, t);
  }
  return t;
}

function sampleRange(world: World, band: Band, m0: number, m1: number): Sample[] {
  const sw = swellOf(world, band), packets = packetsNear(world, band, m0 * STEP, m1 * STEP), out: Sample[] = [];
  for (let m = m0; m <= m1; m++) {
    const a = m * STEP, rough = 0.45 + 0.55 * roughness(world, a);
    // The swell rises and falls in long sets.
    const set = rough * (0.55 + 0.45 * sw.noise.noise2(a / 2200, band.j * 7.1));
    let x = a, y = band.base;
    for (const c of sw.comps) {
      const th = c.k * a + c.ph;
      x += c.Q * c.A * set * Math.sin(th);
      y -= c.A * set * Math.cos(th);
    }
    let h = 0, best: Packet | null = null, bf = 0;
    for (const p of packets) {
      const f = lift(p, a), dh = p.E * f;
      if (dh < 0.01) continue;
      h += dh;
      // Sheared forward in proportion to height: the top of a crest runs ahead of its foot.
      x += p.dir * p.shear * p.E * f * f;
      if (dh > (best ? best.E * bf : 0)) { best = p; bf = f; }
    }
    // Under a breaking lip, the face is drawn back into the hollow.
    if (best && best.kind === 'plunge') {
      const u = (a - best.c) * best.dir;
      if (u > 0) x -= best.dir * curlRadius(best) * 1.1 * Math.sin(Math.PI * clamp(bf, 0, 1)) * smoothstep(0, best.front * 0.25, u);
    }
    out.push({ a, p: [x, y - h], h: band.base - (y - h), packet: best, f: bf });
  }
  return out;
}

// ------------------------------------------------------------ breaking

export const curlRadius = (p: Packet) => p.E * 0.3;

const curlMemo = new Map<number, Curl>();

/**
 * The lip of a breaking packet. The water thrown off the crest reaches forward first, and only
 * then is rolled over by the vortex that forms under it, ever more tightly toward the tip: so
 * the lip's curvature grows along it, from nothing at the crest to its tightest at the tip, and
 * it turns through a little more than half a circle.
 */
export function curlOf(p: Packet, crest: Pt): Curl {
  let c = curlMemo.get(p.id);
  if (c) return c;
  const r = new Rng(hash(p.id, 0xc1)), R = curlRadius(p);
  // In the lip's own frame: x forward, y up, the crest at the origin.
  const L = R * r.range(2.7, 3.4), turn = r.range(2.7, 3.1), k = r.range(1.5, 2.1), n = 48;
  let x = 0, y = 0, a = r.range(0.15, 0.35);
  const local: Pt[] = [[0, 0]];
  for (let i = 1; i < n; i++) {
    const s0 = (i - 1) / (n - 1), s1 = i / (n - 1);
    // Turned so far: turn * s^k, so the curvature grows as s^(k-1).
    const a1 = a - turn * (Math.pow(s1, k) - Math.pow(s0, k));
    x += Math.cos((a + a1) / 2) * L / (n - 1);
    y += Math.sin((a + a1) / 2) * L / (n - 1);
    a = a1;
    local.push([x, y]);
  }
  const eye: Pt = [R, -R * 0.6];
  // The spine runs crest to tip. Its root sinks into the crest so the lip's outer edge carries on
  // from the back of the wave.
  const T0 = R * r.range(0.55, 0.75);
  for (let i = 0; i < local.length; i++) local[i][1] -= (T0 / 2) * Math.pow(1 - i / (local.length - 1), 2);
  const toWorld = ([x, y]: Pt): Pt => [crest[0] + p.dir * x, crest[1] - y];
  const spine = local.map(toWorld);
  const outer: Pt[] = [], inner: Pt[] = [];
  for (let i = 0; i < local.length; i++) {
    const s = i / (local.length - 1), a = local[Math.max(0, i - 1)], b = local[Math.min(local.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    // Outward from the eye is to the left of travel (the lip turns clockwise round it).
    const nx = -ty / l, ny = tx / l, th = T0 * Math.pow(1 - s, 0.8) / 2;
    outer.push(toWorld([local[i][0] + nx * th, local[i][1] + ny * th]));
    inner.push(toWorld([local[i][0] - nx * th, local[i][1] - ny * th]));
  }
  c = { spine, outer, inner, R, eye: toWorld(eye) };
  if (curlMemo.size > 500) curlMemo.clear();
  curlMemo.set(p.id, c);
  return c;
}

/** The crest of a packet in a sampled surface: the highest sample it lifts. */
export function crestOf(samples: Sample[], p: Packet): number {
  let best = -1, h = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.packet === p && s.h > h) { h = s.h; best = i; }
  }
  return best;
}

/** A stable unit value for anything in a band, from the world grid. */
export const bandFloat = (world: World, band: Band, ...v: number[]) => hashFloat(world.s, 0xf2, band.j, ...v);
