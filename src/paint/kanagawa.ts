// Prints the frame: the sky, then each traced block in turn, as a printer pulls a print: the paper
// of the waves, shell white, pale indigo, Prussian blue, grey and deep indigo, and last the
// cartouche. Each block is one impression, so the print visibly builds colour by colour.

import { css } from '../core/color';
import { FRAME_W, H, type World } from '../world/world';
import { loadSky, printBlocks, type PrintBlock } from '../world/kanagawa';
import { L, type ChunkPlan } from './plan';
import { planOrbs, planWeather } from './sky';

let skyImage: ImageBitmap | null = null;

/** Decode what the print needs before its chunks can be planned. */
export async function preparePrint() {
  skyImage ??= await loadSky();
}
const paths = new WeakMap<PrintBlock, Path2D>();

/** A block's rings as one path, each ring smoothed through the midpoints of its edges. */
function pathOf(b: PrintBlock): Path2D {
  let p = paths.get(b);
  if (p) return p;
  p = new Path2D();
  for (const r of b.rings) {
    const n = r.length / 2;
    if (n < 3) continue;
    p.moveTo((r[2 * n - 2] + r[0]) / 2, (r[2 * n - 1] + r[1]) / 2);
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      p.quadraticCurveTo(r[2 * k], r[2 * k + 1], (r[2 * k] + r[2 * j]) / 2, (r[2 * k + 1] + r[2 * j + 1]) / 2);
    }
    p.closePath();
  }
  paths.set(b, p);
  return p;
}

function sky(ctx: CanvasRenderingContext2D, world: World) {
  if (skyImage) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (world.flipped) {
      ctx.translate(FRAME_W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(skyImage, 0, 0, FRAME_W, H);
    ctx.restore();
  }
  // Another weather recolours the sky, keeping a little of the original's grading underneath.
  if (world.mood !== 'day') {
    const t = world.tintAt(FRAME_W / 2), g = ctx.createLinearGradient(0, 0, 0, H * 0.8);
    g.addColorStop(0, css(t.skyTop, 0.85));
    g.addColorStop(0.3, css(t.sky, 0.82));
    g.addColorStop(1, css(t.skyLow, 0.82));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FRAME_W, H);
  }
}

export function planPrint(p: ChunkPlan) {
  const w = p.world;
  p.items.push({ layer: L.SKY, key: 0, block: 'sky', op: (ctx) => sky(ctx, w) });
  planOrbs(p);
  planWeather(p);
  printBlocks(w).forEach((b, i) => {
    p.items.push({
      layer: L.WAVE + i * 0.01, key: 0, block: b.name, op: (ctx) => {
        const path = pathOf(b);
        ctx.fillStyle = css(b.color);
        ctx.fill(path, 'evenodd');
        // A hair of the same ink around every shape, so neighbouring blocks meet without a gap.
        ctx.strokeStyle = css(b.color);
        ctx.lineWidth = 0.5;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      },
    });
  });
}
