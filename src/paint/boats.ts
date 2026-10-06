// Fast fishing boats (oshiokuri-bune) carrying fish to market, as in the print: long pale hulls
// with raised prows, the crew in indigo crouched low over their oars, the sea washing over the
// gunwales and foam breaking along the waterline.

import { mix, type RGB } from '../core/color';
import { clamp } from '../core/math';
import { fillPoly, inkedUnion, keyline, polyPath, type Ctx, type Pt } from '../core/print';
import { hash, Rng } from '../core/rng';
import { inPoly, waveShape } from '../world/wave';
import { H, HZ, type Boat, type Tint, type Wave } from '../world/world';
import { depthLayer, inPad, type ChunkPlan } from './plan';
import { waterFill } from './sea';

const HULL: RGB = [222, 204, 150];
const HULL_IN: RGB = [150, 116, 66];
const WOOD: RGB = [62, 44, 28];
const CLOTH: RGB = [40, 60, 98];
const SKIN: RGB = [234, 208, 166];
const HAIR: RGB = [26, 24, 26];

export function planBoats(p: ChunkPlan) {
  for (const b of p.near.boats) {
    if (!inPad(p, b.x, b.len * 0.7)) continue;
    const t = p.world.tintAt(b.x);
    // The water at the boat: the body of the wave it rides, or the open sea.
    const host = hostWave(p.near.waves, b);
    p.items.push({ layer: depthLayer(b.z, b.id), key: 0, op: (ctx) => boat(ctx, b, t, host) });
  }
}

/** The nearest wave just behind the boat whose body covers its waterline. */
function hostWave(waves: Wave[], b: Boat): Wave | undefined {
  let best: Wave | undefined;
  for (const w of waves) {
    if (w.z > b.z || (best && w.z < best.z)) continue;
    if (inPoly(waveShape(w).body, b.x, b.y)) best = w;
  }
  return best;
}

function boat(ctx: Ctx, b: Boat, t: Tint, host: Wave | undefined) {
  const r = new Rng(hash(b.id, 61)), L = b.len, hb = L * 0.06, d = b.dir, key = mix(t.key, WOOD, 0.4);
  const lw = clamp(L * 0.007, 0.7, 1.6);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  ctx.scale(d, 1);

  // Oars, raked back into the water.
  const oars: Pt[][] = [];
  for (let k = 0; k < b.rowers; k++) {
    const x = -L * 0.34 + (k + 0.5) * (L * 0.64 / b.rowers);
    oars.push([[x, -hb * 0.9], [x - L * 0.05, hb * 1.6]]);
  }
  for (const o of oars) keyline(ctx, o, lw * 1.1, WOOD);

  // The hull: a long sweep, the prow raised and pointed.
  const hull: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const f = i / 16, x = -L / 2 + f * L;
    hull.push([x, -hb * (0.4 + Math.pow(f, 4) * 1.6)]);
  }
  for (let i = 16; i >= 0; i--) {
    const f = i / 16, x = -L / 2 + f * L * 0.97;
    hull.push([x, hb * (0.9 - Math.pow(Math.abs(f - 0.45) * 2, 2) * 0.8)]);
  }
  fillPoly(ctx, hull, HULL);
  const rail: Pt[] = hull.slice(0, 17).map(([x, y]) => [x, y + hb * 0.45]);
  keyline(ctx, rail, hb * 0.5, HULL_IN, 0.85);
  keyline(ctx, hull.concat([hull[0]]), lw, key);

  // The crew: indigo backs bent forward, heads tucked down.
  const backs: Pt[][] = [], heads: [number, number, number][] = [];
  for (let k = 0; k < b.rowers; k++) {
    const x = -L * 0.34 + (k + 0.5) * (L * 0.64 / b.rowers) + r.range(-2, 2), s = L * 0.032 * r.range(0.85, 1.1);
    const e: Pt[] = [];
    for (let a = 0; a <= 12; a++) {
      const th = Math.PI + (a / 12) * Math.PI;
      e.push([x + Math.cos(th) * s * 1.1, -hb * 0.35 + Math.sin(th) * s * 1.25]);
    }
    backs.push(e);
    heads.push([x + s * 0.85, -hb * 0.35 - s * 0.95, s * 0.5]);
  }
  inkedUnion(ctx, backs, CLOTH, key, lw * 0.6);
  for (const [x, y, s] of heads) {
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${SKIN.join(',')})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, s, Math.PI * 0.9, Math.PI * 2.05);
    ctx.fillStyle = `rgb(${HAIR.join(',')})`;
    ctx.fill();
  }

  ctx.restore();

  // The sea over the lower hull, with foam breaking along it, kept within the water it rides
  // and graded exactly as that water is, so the wash disappears into it.
  ctx.save();
  ctx.beginPath();
  if (host) polyPath(ctx, waveShape(host).body);
  else ctx.rect(b.x - L, HZ, L * 2, H);
  ctx.clip();
  const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
  const toWorld = ([x, y]: Pt): Pt => [b.x + x * d * ca - y * sa, b.y + x * d * sa + y * ca];
  const wl: Pt[] = [];
  for (let i = 0; i <= 20; i++) {
    const f = i / 20, x = -L * 0.62 + f * L * 1.24;
    wl.push([x, hb * (0.15 + 0.35 * Math.sin(f * 9 + r.range(0, 1)))]);
  }
  // In open water the crests around it vary too much to match; there the foam alone carries the waterline.
  if (host) fillPoly(ctx, wl.concat([[L * 0.62, hb * 1.8], [-L * 0.62, hb * 1.8]]).map(toWorld), waterFill(ctx, t, host));
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  ctx.scale(d, 1);
  // A lacy line of foam along the waterline, scalloped where it slaps the hull.
  const lace: Pt[] = [], under: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const f = i / 40, x = -L * 0.56 + f * L * 1.12, y = hb * (0.15 + 0.35 * Math.sin(f * 9));
    lace.push([x, y - hb * (0.15 + 0.35 * Math.abs(Math.sin(f * 23 + 1)))]);
    under.push([x, y + hb * 0.25]);
  }
  inkedUnion(ctx, [lace.concat(under.reverse())], t.foam, t.key, lw * 0.5);
  ctx.restore();
}
