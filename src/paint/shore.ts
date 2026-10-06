// Land and things on the horizon: Fuji with its snow running down in streaks, low far hills,
// pine-covered headlands, rocky islets with a shrine gate, and the sails of distant boats.

import { css, mix, type RGB } from '../core/color';
import { lerp } from '../core/math';
import { fillPoly, inkedUnion, keyline, polyPath, type Ctx, type Pt } from '../core/print';
import { hash, Rng } from '../core/rng';
import { HZ, type Isle, type Peak, type Tint } from '../world/world';
import { depthLayer, inPad, L, type ChunkPlan } from './plan';

const VERMILION: RGB = [200, 64, 42];

export function planShore(p: ChunkPlan) {
  const w = p.world;
  for (const pk of p.near.peaks) {
    if (!inPad(p, pk.x, pk.w + 4)) continue;
    const t = w.tintAt(pk.x);
    p.items.push({ layer: L.LAND, key: pk.fuji ? 1 + pk.h * 1e-4 : pk.h * 1e-4, op: (ctx) => (pk.fuji ? fuji(ctx, pk, t) : hill(ctx, pk, t)) });
  }
  for (const hd of p.near.heads) {
    if (!inPad(p, hd.x, hd.w / 2 + 30)) continue;
    const t = w.tintAt(hd.x), r = new Rng(hash(hd.id, 51));
    const ridge: Pt[] = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = hd.x - hd.w / 2 + f * hd.w;
      const y = HZ + 1 - hd.h * Math.pow(Math.sin(f * Math.PI), 0.6) * (0.8 + 0.2 * Math.sin(f * 7 + hd.id % 10));
      ridge.push([x, y]);
    }
    const pines: [number, number, number][] = [];
    for (let k = 0; k < hd.pines; k++) {
      const f = r.range(0.12, 0.88), i = Math.round(f * n);
      pines.push([ridge[i][0], ridge[i][1] + 2, r.range(9, 16)]);
    }
    p.items.push({
      layer: L.LAND, key: 2 + r.random(), op: (ctx) => {
        const shape = ridge.concat([[hd.x + hd.w / 2, HZ + 4], [hd.x - hd.w / 2, HZ + 4]]);
        const g = ctx.createLinearGradient(0, HZ - hd.h, 0, HZ);
        g.addColorStop(0, css(t.land));
        g.addColorStop(1, css(mix(t.land, t.skyLow, 0.45)));
        fillPoly(ctx, shape, g);
        keyline(ctx, ridge, 1, t.key, 0.75);
        for (const [x, y, s] of pines) pine(ctx, x, y, s, t, hash(hd.id, x | 0));
      },
    });
  }
  for (const is of p.near.isles) if (inPad(p, is.x, is.w + 40)) planIsle(p, is);
  for (const s of p.near.sails) {
    if (!inPad(p, s.x, s.size * 2)) continue;
    const t = w.tintAt(s.x);
    p.items.push({ layer: L.SAIL, key: s.id / 4294967296, op: (ctx) => sail(ctx, s.x, s.y, s.size, s.dir, t) });
  }
}

function fuji(ctx: Ctx, pk: Peak, t: Tint) {
  const r = new Rng(hash(pk.id, 52)), top = HZ - pk.h, wt = pk.w * 0.1, n = 26;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    // Concave slopes: gentle at the foot, steepening toward the summit.
    const u = i / n, y = HZ + 2 - pk.h * Math.pow(u, 1.55), d = lerp(pk.w, wt, u);
    left.push([pk.x - d, y]);
    right.push([pk.x + d, y]);
  }
  // A flat summit with the notches of the crater.
  const summit: Pt[] = [[pk.x - wt * 0.5, top + 1.5], [pk.x - wt * 0.15, top - 1], [pk.x + wt * 0.2, top + 1.2], [pk.x + wt * 0.55, top - 0.6]];
  const outline = left.concat(summit, right.slice().reverse());

  const g = ctx.createLinearGradient(0, top, 0, HZ);
  g.addColorStop(0, css(t.fuji));
  g.addColorStop(1, css(t.fujiLow));
  fillPoly(ctx, outline, g);

  // Snow: the cap reaches down the slopes in long tongues.
  const line = top + pk.h * r.range(0.3, 0.42), teeth = 9 + Math.round(pk.w / 18);
  const snow: Pt[] = [];
  const wAt = (y: number) => lerp(pk.w, wt, Math.pow((HZ + 2 - y) / pk.h, 1 / 1.55));
  for (let k = 0; k <= teeth; k++) {
    const f = k / teeth, y = k % 2 ? line + pk.h * r.range(0.08, 0.26) * Math.sin(f * Math.PI) : line - pk.h * r.range(0, 0.04);
    const half = wAt(Math.min(y, HZ)) * 0.98;
    snow.push([pk.x - half + f * half * 2, y]);
  }
  const cap = left.filter(([, y]) => y < line).concat(summit, right.filter(([, y]) => y < line).reverse());
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, outline);
  ctx.clip();
  fillPoly(ctx, [cap[0], ...cap, ...snow.slice().reverse()].filter((q) => q[1] <= HZ), t.snow);
  keyline(ctx, snow, 0.9, t.key, 0.6);
  ctx.restore();
  keyline(ctx, outline, 1.2, t.key, 0.9);
}

function hill(ctx: Ctx, pk: Peak, t: Tint) {
  const pts: Pt[] = [];
  for (let i = 0; i <= 20; i++) {
    const f = i / 20;
    pts.push([pk.x - pk.w + f * pk.w * 2, HZ + 2 - pk.h * Math.pow(Math.sin(f * Math.PI), 0.8)]);
  }
  fillPoly(ctx, pts, mix(t.land, t.skyLow, 0.55));
  keyline(ctx, pts, 0.8, t.key, 0.5);
}

/** An umbrella pine: a leaning trunk carrying flat, layered tiers of needles. */
function pine(ctx: Ctx, x: number, y: number, s: number, t: Tint, seed: number) {
  const r = new Rng(seed), lean = r.range(-0.5, 0.5), tx = x + lean * s, ty = y - s * 1.3;
  keyline(ctx, [[x, y], [x + lean * s * 0.4, y - s * 0.7], [tx, ty]], Math.max(1, s * 0.12), mix(t.pine, [60, 40, 30], 0.5));
  const tiers: Pt[][] = [];
  const n = r.int(2, 3);
  for (let k = 0; k < n; k++) {
    const cx = tx + r.range(-s * 0.4, s * 0.4), cy = ty - k * s * 0.4 + r.range(-1, 1), rx = s * r.range(0.6, 0.9) * (1 - k * 0.15), ry = s * 0.24;
    const e: Pt[] = [];
    for (let a = 0; a <= 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      e.push([cx + Math.cos(th) * rx, cy + Math.sin(th) * ry * (Math.sin(th) > 0 ? 0.6 : 1)]);
    }
    tiers.push(e);
  }
  inkedUnion(ctx, tiers, t.pine, mix(t.pine, [0, 0, 0], 0.5), 0.6);
}

function planIsle(p: ChunkPlan, is: Isle) {
  const t = p.world.tintAt(is.x), r = new Rng(hash(is.id, 53));
  const n = 18, left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, y = is.base + 6 - f * is.h;
    const bulge = Math.sin(f * Math.PI * 0.9) * 0.2 + 1 - f * 0.45;
    left.push([is.x - is.w / 2 * bulge + r.range(-3, 3), y]);
    right.push([is.x + is.w / 2 * bulge + r.range(-3, 3), y]);
  }
  const outline = left.concat(right.slice().reverse());
  const strata: Pt[][] = [];
  for (let k = 0; k < 7; k++) {
    const f = r.range(0.1, 0.9), x = is.x + (f - 0.5) * is.w * 0.8;
    strata.push([[x, is.base - is.h * r.range(0.6, 0.9)], [x + r.range(-6, 6), is.base - is.h * r.range(0.2, 0.5)], [x + r.range(-6, 6), is.base]]);
  }
  const topY = is.base + 6 - is.h, pines: [number, number, number][] = [];
  for (let k = 0; k < is.pines; k++) pines.push([is.x + r.range(-0.3, 0.3) * is.w * 0.55, topY + 3, r.range(10, 18) * (is.w / 90 + 0.4)]);
  p.items.push({
    layer: depthLayer(is.z, is.id), key: 0, op: (ctx) => {
      const g = ctx.createLinearGradient(is.x - is.w / 2, 0, is.x + is.w / 2, 0);
      g.addColorStop(0, css(mix(t.rock, t.skyLow, 0.2)));
      g.addColorStop(1, css(mix(t.rock, t.key, 0.35)));
      fillPoly(ctx, outline, g);
      ctx.save();
      ctx.beginPath();
      polyPath(ctx, outline);
      ctx.clip();
      for (const s of strata) keyline(ctx, s, 1, t.key, 0.45);
      ctx.restore();
      keyline(ctx, outline, 1.2, t.key, 0.9);
      for (const [x, y, s] of pines) pine(ctx, x, y, s, t, hash(is.id, x | 0));
      if (is.torii) torii(ctx, is.x + is.w * 0.18, topY + 4, Math.min(22, is.w * 0.25), t);
    },
  });
}

function torii(ctx: Ctx, x: number, y: number, s: number, t: Tint) {
  const c = VERMILION, k = t.key;
  for (const dx of [-0.36, 0.36]) {
    const post: Pt[] = [[x + dx * s - s * 0.05, y], [x + dx * s + s * 0.05, y], [x + dx * s + s * 0.04, y - s], [x + dx * s - s * 0.04, y - s]];
    fillPoly(ctx, post, c);
  }
  fillPoly(ctx, [[x - s * 0.62, y - s * 1.02], [x + s * 0.62, y - s * 1.02], [x + s * 0.55, y - s * 0.9], [x - s * 0.55, y - s * 0.9]], c);
  fillPoly(ctx, [[x - s * 0.48, y - s * 0.78], [x + s * 0.48, y - s * 0.78], [x + s * 0.48, y - s * 0.72], [x - s * 0.48, y - s * 0.72]], c);
  keyline(ctx, [[x - s * 0.66, y - s * 1.06], [x, y - s * 1.1], [x + s * 0.66, y - s * 1.06]], Math.max(1, s * 0.07), k);
}

function sail(ctx: Ctx, x: number, y: number, s: number, dir: number, t: Tint) {
  const hull: Pt[] = [[x - s * 0.6, y - s * 0.12], [x + s * 0.6, y - s * 0.16], [x + s * 0.4 * dir, y + s * 0.05], [x - s * 0.4, y + s * 0.04]];
  fillPoly(ctx, hull, mix(t.key, t.seaFar, 0.3));
  const sailPts: Pt[] = [[x - s * 0.3, y - s * 0.2], [x + s * 0.3, y - s * 0.2], [x + s * 0.34, y - s * 1.15], [x - s * 0.26, y - s * 1.1]];
  inkedUnion(ctx, [sailPts], mix(t.foam, t.skyLow, 0.2), t.key, 0.45);
  ctx.strokeStyle = css(t.key, 0.5);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let k = 1; k < 3; k++) { ctx.moveTo(x - s * 0.3 + k * s * 0.2, y - s * 0.2); ctx.lineTo(x - s * 0.28 + k * s * 0.2, y - s * 1.12); }
  ctx.stroke();
}
