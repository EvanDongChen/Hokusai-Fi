// The sea's ground, under the waves: a graded bokashi from the pale far sea to the deep blue in
// front, a dark line at the horizon, and fine carved ripples across it. The waves themselves are
// the field's (src/world/field.ts), carved in surf.ts.

import { css, mix } from '../core/color';
import { lerp } from '../core/math';
import { keyline, type Pt } from '../core/print';
import { hash, Rng } from '../core/rng';
import { zOf } from '../world/wave';
import { H, HZ } from '../world/world';
import { cellRange, depthLayer, inPad, L, tintRuns, type ChunkPlan } from './plan';

export function planSea(p: ChunkPlan) {
  const w = p.world;

  // The ground: world-aligned strips, each graded top to bottom with the tint at its x.
  p.items.push({
    layer: L.SEA, key: 0, op: (ctx) => {
      for (const { x, w: rw, t } of tintRuns(p)) {
        const g = ctx.createLinearGradient(0, HZ, 0, H);
        g.addColorStop(0, css(t.seaFar));
        g.addColorStop(0.45, css(t.sea));
        g.addColorStop(1, css(t.seaNear));
        ctx.fillStyle = g;
        ctx.fillRect(x, HZ, rw, H - HZ + 2);
      }
    },
  });

  // The dark line where sea meets sky (ichimonji bokashi), printed over the farthest crests.
  p.items.push({
    layer: L.WAVE + zOf(HZ + 22), key: 0, op: (ctx) => {
      for (const { x, exact, t } of tintRuns(p)) {
        const d = ctx.createLinearGradient(0, HZ - 1, 0, HZ + 26);
        d.addColorStop(0, css(t.deep, 0.8));
        d.addColorStop(1, css(t.deep, 0));
        ctx.fillStyle = d;
        ctx.fillRect(x, HZ - 1, exact, 27);
      }
    },
  });

  // Carved ripples on the open water: short flat arcs, finer toward the horizon.
  for (let row = 0; row < 26; row++) {
    const f = row / 25, y = HZ + 8 + Math.pow(f, 1.7) * (H - HZ - 8), sp = lerp(26, 110, f);
    const [i0, i1] = cellRange(p, sp);
    for (let i = i0; i <= i1; i++) {
      const seed = hash(w.s, 21, row, i), r = new Rng(seed);
      if (!r.chance(0.55)) continue;
      const x = (i + r.random()) * sp, yy = y + r.range(-3, 3) * lerp(0.5, 3, f), len = sp * r.range(0.35, 0.7);
      if (!inPad(p, x, len)) continue;
      const t = w.tintAt(x), lw = lerp(0.6, 1.6, f), sag = len * 0.08;
      const pts: Pt[] = [[x - len / 2, yy], [x, yy + sag], [x + len / 2, yy]];
      p.items.push({ layer: depthLayer(zOf(yy) - 0.002, seed), key: 0, op: (ctx) => keyline(ctx, pts, lw, mix(t.key, t.sea, 0.35), 0.55) });
    }
  }
}
