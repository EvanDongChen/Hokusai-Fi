// Plans a world chunk as an ordered list of draw operations. Runs in a worker or on the page.
import { CW, H, World } from '../world/world';
import { context2d, makeCanvas, type AnyCanvas } from './canvas';
import { planPrint, planPrintSkyFade } from './kanagawa';
import type { ChunkPlan, Op } from './plan';
import { Press } from './press';
import { planSea } from './sea';
import { planShore } from './shore';
import { planSky } from './sky';
import { planSurf } from './surf';

const PAD = 40;

export function planChunk(world: World, c: number): Op[] {
  const p: ChunkPlan = { world, c, x0: c * CW, x1: (c + 1) * CW, pad: PAD, near: world.near(c), items: [] };
  // Hokusai's own print is his composition; every other sea, and every other edition, is the field's.
  if ((c === 0 || c === 1) && world.original) planPrint(p);
  else {
    planSky(p);
    planPrintSkyFade(p);
    planShore(p);
    planSea(p);
    planSurf(p);
  }
  p.items.sort((a, b) => a.layer - b.layer || a.key - b.key);
  return p.items.map((i) => i.op);
}

/** Pixel size of a chunk canvas at a render scale; the scale is snapped so the width is whole. */
export function chunkPixels(scale: number) {
  const w = Math.round(CW * scale), s = w / CW;
  return { w, h: Math.round(H * s), scale: s };
}

/**
 * Prints one chunk in time slices, yielding between them. Reports partial images so the print can
 * be watched as it forms. Shared by the worker and the main-thread fallback.
 */
export async function paintChunk(
  world: World, c: number, scale: number,
  report: (canvas: AnyCanvas, progress: number, strokes: number, done: boolean) => Promise<void> | void,
  sliceMs = 14, reportEveryMs = 160, restMs = 3,
) {
  const { w, h, scale: s } = chunkPixels(scale);
  const canvas = makeCanvas(w, h), out = context2d(canvas);
  // The blocks are cut first, then pulled onto the sheet in one impression (see press.ts).
  const press = new Press(w, h, s, c * CW, world.s), ctx = press.ctx;
  const ops = planChunk(world, c);
  let i = 0, last = performance.now();
  await report(canvas, 0, ops.length, false);
  while (i < ops.length) {
    const t0 = performance.now();
    while (i < ops.length && performance.now() - t0 < sliceMs) ops[i++](ctx);
    if (i < ops.length && performance.now() - last > reportEveryMs) {
      last = performance.now();
      press.preview(out);
      await report(canvas, i / ops.length, ops.length, false);
    }
    // A short rest between slices leaves CPU time for the page to keep animating smoothly.
    await new Promise((r) => setTimeout(r, restMs));
  }
  press.pull(out);
  await report(canvas, 1, ops.length, true);
}
