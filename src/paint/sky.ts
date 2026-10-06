// The sky: a graded ground with the dark band printed across the top of the sheet (ichimonji
// bokashi), long flat banks of cloud, a red sun or a pale moon, and the weather: stars, snow or
// slanting rain.

import { css, mix } from '../core/color';
import { lerp } from '../core/math';
import { keyline, smoothPath, type Pt } from '../core/print';
import { hash, Rng } from '../core/rng';
import { H, HZ } from '../world/world';
import { cellRange, inPad, L, tintRuns, type ChunkPlan } from './plan';

export function planSky(p: ChunkPlan) {
  const w = p.world;
  p.items.push({
    layer: L.SKY, key: 0, op: (ctx) => {
      for (const { x, w: rw, t } of tintRuns(p)) {
        const g = ctx.createLinearGradient(0, 0, 0, HZ);
        g.addColorStop(0, css(t.skyTop));
        g.addColorStop(0.17, css(mix(t.skyTop, t.sky, 0.82)));
        g.addColorStop(0.32, css(t.sky));
        g.addColorStop(1, css(t.skyLow));
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, rw, HZ + 2);
      }
    },
  });

  // Banks of cloud: long, flat, rounded at the ends, slightly darker beneath.
  for (let row = 0; row < 7; row++) {
    const y0 = H * lerp(0.07, 0.62, row / 6), sp = 520;
    const [i0, i1] = cellRange(p, sp, 320);
    for (let i = i0; i <= i1; i++) {
      const seed = hash(w.s, 41, row, i), r = new Rng(seed);
      if (!r.chance(0.34)) continue;
      const x = (i + r.random()) * sp, y = y0 + r.range(-24, 24), len = r.range(260, 640), th = r.range(7, 18);
      if (!inPad(p, x, len / 2 + th)) continue;
      // A long band tapering to points, its upper edge in soft billows, its underside nearly flat.
      const t = w.tintAt(x), n = 40, upper: Pt[] = [], lower: Pt[] = [];
      const ph = r.range(0, 6), bill = r.range(3, 7), tilt = r.range(-0.02, 0.02);
      for (let k = 0; k <= n; k++) {
        const f = k / n, lx = x - len / 2 + f * len, taper = Math.pow(Math.sin(f * Math.PI), 0.6);
        const ly = y + (lx - x) * tilt;
        upper.push([lx, ly - th * taper * (1 + 0.35 * Math.abs(Math.sin(f * bill * Math.PI + ph)))]);
        lower.push([lx, ly + th * 0.35 * taper]);
      }
      const shape = upper.concat(lower.reverse());
      const a = r.range(0.3, 0.55), lit = row < 3 ? 0.06 : 0.12;
      p.items.push({
        layer: L.CLOUD, key: r.random(), op: (ctx) => {
          const g = ctx.createLinearGradient(0, y - th * 1.4, 0, y + th * 0.4);
          g.addColorStop(0, css(mix(t.cloud, t.skyLow, lit), a * 0.7));
          g.addColorStop(1, css(mix(t.cloud, t.skyTop, 0.15), a));
          ctx.fillStyle = g;
          ctx.beginPath();
          smoothPath(ctx, shape, true);
          ctx.fill();
        },
      });
    }
  }

  // Sun or moon.
  for (const o of w.orbsNear(p.x0 - p.pad - 120, p.x1 + p.pad + 120)) {
    if (!inPad(p, o.x, o.r * 3)) continue;
    const t = w.tintAt(o.x);
    p.items.push({
      layer: L.ORB, key: 0, op: (ctx) => {
        const glow = ctx.createRadialGradient(o.x, o.y, o.r * 0.8, o.x, o.y, o.r * 3);
        const gc = o.kind === 'sun' ? [232, 120, 72] as const : [236, 226, 180] as const;
        glow.addColorStop(0, css(gc, 0.35));
        glow.addColorStop(1, css(gc, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(o.x - o.r * 3, o.y - o.r * 3, o.r * 6, o.r * 6);
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fillStyle = o.kind === 'sun' ? '#c8402a' : '#efe6c4';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = css(o.kind === 'sun' ? [140, 40, 26] as const : t.key, 0.7);
        ctx.stroke();
      },
    });
  }

  // Weather printed into the sky: stars at night, snow, slanting rain.
  const sp = 46, [i0, i1] = cellRange(p, sp);
  for (let i = i0; i <= i1; i++) {
    for (let j = 0; j * sp < HZ; j++) {
      const seed = hash(w.s, 42, i, j), r = new Rng(seed);
      const x = (i + r.random()) * sp, y = (j + r.random()) * sp;
      if (!inPad(p, x, 30) || y > HZ - 4) continue;
      const night = w.moodWeight(x, 'night'), snow = w.moodWeight(x, 'snow'), rain = w.moodWeight(x, 'storm');
      if (night > 0.05 && y < HZ * 0.7 && r.chance(0.35)) {
        const rad = r.range(0.7, 1.9), a = night * r.range(0.5, 1);
        p.items.push({ layer: L.WEATHER, key: r.random(), op: (ctx) => { ctx.fillStyle = css([240, 232, 200], a); ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); } });
      }
      if (snow > 0.05 && r.chance(0.8)) {
        const rad = r.range(1.2, 3.2), a = snow * 0.95;
        p.items.push({ layer: L.WEATHER, key: r.random(), op: (ctx) => { ctx.fillStyle = css([250, 249, 244], a); ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); } });
      }
      if (rain > 0.05) {
        for (let k = 0; k < 3; k++) {
          const xx = x + r.range(-20, 20), yy = y + r.range(-20, 20), l = r.range(20, 60), a = rain * r.range(0.25, 0.5);
          const pts: Pt[] = [[xx, yy], [xx - l * 0.28, yy + l]];
          p.items.push({ layer: L.WEATHER, key: r.random(), op: (ctx) => keyline(ctx, pts, 0.9, [40, 46, 60], a) });
        }
      }
    }
  }
}
