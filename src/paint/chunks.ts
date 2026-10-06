// Plans a world chunk as an ordered list of draw operations. Runs in a worker or on the page.
import { Rng } from '../core/rng';
import { CW, H, World } from '../world/world';
import { planBoats } from './boats';
import { context2d, makeCanvas, type AnyCanvas } from './canvas';
import { planPrint } from './kanagawa';
import type { ChunkPlan, Op } from './plan';
import { planSea } from './sea';
import { planShore } from './shore';
import { planSky } from './sky';

const PAD = 40;

export function planChunk(world: World, c: number): Op[] {
  const p: ChunkPlan = { world, c, x0: c * CW, x1: (c + 1) * CW, pad: PAD, near: world.near(c), items: [] };
  if (c === 0 || c === 1) planPrint(p);
  else {
    planSky(p);
    planShore(p);
    planSea(p);
    planBoats(p);
  }
  p.items.sort((a, b) => a.layer - b.layer || a.key - b.key);
  const ops = p.items.map((i) => i.op);
  ops.push((ctx) => paper(ctx, p.x0, p.x1));
  return ops;
}

let paperTile: AnyCanvas | null = null;

/**
 * Washi: long pale fibres and the faint mottling a baren leaves when it rubs pigment into the
 * sheet. The pattern is anchored to world coordinates, so it tiles across chunks.
 */
function paper(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
  if (!paperTile) {
    const S = 256, rng = new Rng(9182);
    paperTile = makeCanvas(S, S);
    const tc = context2d(paperTile), img = tc.createImageData(S, S), d = img.data;
    // Mottling: low-frequency value noise from a coarse random grid, smoothly interpolated.
    const G = 16, grid: number[] = [];
    for (let i = 0; i < G * G; i++) grid.push(rng.random());
    const at = (i: number, j: number) => grid[((j + G) % G) * G + ((i + G) % G)];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const gx = (x / S) * G, gy = (y / S) * G, ix = Math.floor(gx), iy = Math.floor(gy);
        const fx = gx - ix, fy = gy - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const m = (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
        const v = 236 + m * 16 + (rng.random() - 0.5) * 10;
        const i = (y * S + x) * 4;
        d[i] = v; d[i + 1] = v - 2; d[i + 2] = v - 6; d[i + 3] = 255;
      }
    }
    tc.putImageData(img, 0, 0);
    // Fibres: short curved hairs, a little darker and a little lighter than the sheet.
    tc.lineCap = 'round';
    for (let k = 0; k < 220; k++) {
      const x = rng.random() * S, y = rng.random() * S, a = rng.random() * Math.PI * 2, l = rng.range(6, 26);
      tc.strokeStyle = rng.chance(0.5) ? 'rgba(150,130,100,0.12)' : 'rgba(255,255,250,0.5)';
      tc.lineWidth = rng.range(0.4, 1.1);
      tc.beginPath();
      tc.moveTo(x, y);
      tc.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      tc.stroke();
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = ctx.createPattern(paperTile as CanvasImageSource, 'repeat')!;
  ctx.fillRect(x0, 0, x1 - x0, H);
  ctx.restore();
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
  const canvas = makeCanvas(w, h), ctx = context2d(canvas);
  ctx.setTransform(s, 0, 0, s, -c * CW * s, 0);
  const ops = planChunk(world, c);
  let i = 0, last = performance.now();
  await report(canvas, 0, ops.length, false);
  while (i < ops.length) {
    const t0 = performance.now();
    while (i < ops.length && performance.now() - t0 < sliceMs) ops[i++](ctx);
    if (i < ops.length && performance.now() - last > reportEveryMs) {
      last = performance.now();
      await report(canvas, i / ops.length, ops.length, false);
    }
    // A short rest between slices leaves CPU time for the page to keep animating smoothly.
    await new Promise((r) => setTimeout(r, restMs));
  }
  await report(canvas, 1, ops.length, true);
}
