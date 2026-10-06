// Shared types for planning a chunk as an ordered list of draw operations.
//
// Chunks are printed independently into their own canvases. To make them tile with no seams,
// every shape is generated from global coordinates and gets a global sort key: two neighbouring
// chunks that both include a wave near their shared edge draw it with the same shape, the same
// colours, and in the same order relative to its neighbours.
//
// Waves, boats and islets are ordered by depth: each takes the layer WAVE + z, so everything
// belonging to one wave prints together, and nearer water always lands on top of farther water.

import type { Ctx } from '../core/print';
import { hashFloat } from '../core/rng';
import type { Nearby, Tint, World } from '../world/world';

export type Op = (ctx: Ctx) => void;

export const L = {
  SKY: 0, WEATHER: 0.5, CLOUD: 1, ORB: 1.5, LAND: 2, SEA: 3, RIPPLE: 3.2, SAIL: 3.5, WAVE: 4,
} as const;

export interface Item { layer: number; key: number; op: Op; }

export interface ChunkPlan {
  world: World;
  c: number;
  /** Chunk x range, plus padding wide enough for any line that could reach inside. */
  x0: number; x1: number; pad: number;
  near: Nearby;
  items: Item[];
}

/** The layer of something at depth z; a tiny per-id offset keeps any two things in a fixed order. */
export const depthLayer = (z: number, id: number) => L.WAVE + z + hashFloat(id, 77) * 1e-6;

/** Global grid cells i whose jittered point could land within the padded chunk. */
export function cellRange(p: ChunkPlan, sp: number, reach = 0): [number, number] {
  return [Math.floor((p.x0 - p.pad - reach) / sp) - 1, Math.ceil((p.x1 + p.pad + reach) / sp) + 1];
}

/**
 * Vertical runs across the padded chunk that share one set of colour blocks: a single run over
 * settled weather, narrow strips where two weathers blend. Runs overlap their neighbour so no
 * hairline shows between them; an opaque fill should be drawn with `w`, a translucent one with `exact`.
 */
export function tintRuns(p: ChunkPlan, step = 6): { x: number; w: number; exact: number; t: Tint }[] {
  const out: { x: number; w: number; exact: number; t: Tint }[] = [];
  for (let x = Math.floor((p.x0 - p.pad) / step) * step; x < p.x1 + p.pad; x += step) {
    const t = p.world.tintAt(x + step / 2), last = out[out.length - 1];
    if (last && last.t === t) { last.exact += step; last.w += step; } else out.push({ x, w: step * 2, exact: step, t });
  }
  return out;
}

export const inPad = (p: ChunkPlan, x: number, reach = 0) => x + reach >= p.x0 - p.pad && x - reach <= p.x1 + p.pad;
export const spanInPad = (p: ChunkPlan, a: number, b: number) => b >= p.x0 - p.pad && a <= p.x1 + p.pad;
