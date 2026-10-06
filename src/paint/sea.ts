// The sea, printed block by block.
//
//  - A graded ground (bokashi) from the pale far sea to the deep blue in front, with a dark line
//    at the horizon, and fine carved ripples across it.
//  - Rows of small crests toward the horizon, like scales, each row a little nearer and bigger.
//  - The waves themselves: a body graded from deep Prussian blue at the crest to the sea at its
//    foot, light bands carved along its back and into the curl, the key-block outline, and the
//    foam: a white crest that breaks into claws, each claw splitting into curling talons, with
//    spray falling from them like snow.

import { css, mix, type RGB } from '../core/color';
import { clamp, lerp } from '../core/math';
import { inkedUnion, keyline, offset, polyPath, type Pt } from '../core/print';
import { hash, hashFloat, Rng } from '../core/rng';
import { lipSweep, waveReach, waveShape, zOf, type Wave } from '../world/wave';
import { H, HZ, type Tint, type World } from '../world/world';
import { cellRange, depthLayer, inPad, L, spanInPad, tintRuns, type ChunkPlan, type Item } from './plan';

/** The sea's ground colour at depth y. */
export function seaColor(t: Tint, y: number): RGB {
  const f = clamp((y - HZ) / (H - HZ), 0, 1);
  return f < 0.45 ? mix(t.seaFar, t.sea, f / 0.45) : mix(t.sea, t.seaNear, (f - 0.45) / 0.55);
}

/** How rough the sea is at x: great waves off Kanagawa, glassy in the bay. */
export function roughAt(world: World, x: number): number {
  const b = world.biomeWeights(x);
  return b.kanagawa * 1 + b.swell * 0.8 + b.fuji * 0.35 + b.coast * 0.5 + b.isles * 0.6 + world.moodWeight(x, 'storm') * 0.3;
}

/**
 * The graded fill of a wave's body in world coordinates: deep at the crest, the sea at its foot,
 * then fading out below it so no edge shows where it ends. Without a wave, the open sea's grading.
 */
export function waterFill(ctx: CanvasRenderingContext2D, t: Tint, w?: Wave): CanvasGradient {
  if (!w) {
    const g = ctx.createLinearGradient(0, HZ, 0, H);
    g.addColorStop(0, css(t.seaFar));
    g.addColorStop(0.45, css(t.sea));
    g.addColorStop(1, css(t.seaNear));
    return g;
  }
  const s = waveShape(w), span = s.bottom - s.crestY, fb = (w.base - s.crestY) / span;
  const g = ctx.createLinearGradient(0, s.crestY, 0, s.bottom);
  g.addColorStop(0, css(bodyColor(w, t, s.crestY)));
  g.addColorStop(0.55 * fb, css(bodyColor(w, t, lerp(s.crestY, w.base, 0.55))));
  g.addColorStop(fb, css(seaColor(t, w.base)));
  g.addColorStop(fb + (1 - fb) * 0.35, css(seaColor(t, lerp(w.base, s.bottom, 0.35)), 0.8));
  g.addColorStop(1, css(seaColor(t, s.bottom), 0));
  return g;
}

/** The colour of a wave's body at y, matching its graded fill (used where a boat cuts the surface). */
export function bodyColor(w: Wave, t: Tint, y: number): RGB {
  const s = waveShape(w), f = clamp((y - s.crestY) / Math.max(1, w.base - s.crestY), 0, 1);
  const deep = mix(t.deep, t.seaFar, (1 - w.z) * 0.45 * clamp(1 - w.h / 300, 0, 1));
  const midC = mix(deep, t.seaNear, 0.55);
  return f < 0.55 ? mix(deep, midC, f / 0.55) : mix(midC, seaColor(t, w.base), (f - 0.55) / 0.45);
}

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

  // Rows of small crests toward the horizon.
  const ROWS = 9;
  for (let row = 0; row < ROWS; row++) {
    const f = (row + 0.5) / ROWS;
    const base = HZ + 5 + Math.pow(f, 1.8) * (H * 0.94 - HZ - 5), hb = 5 + 64 * Math.pow(f, 1.6), sp = 44 + 240 * Math.pow(f, 1.3);
    const [i0, i1] = cellRange(p, sp, hb * 8);
    for (let i = i0; i <= i1; i++) {
      const seed = hash(w.s, 22, row, i), r = new Rng(seed);
      const x = (i + r.range(0, 0.85)) * sp, rough = roughAt(w, x);
      if (!r.chance(0.35 + rough * 0.4)) continue;
      const h = hb * r.range(0.6, 1.35) * lerp(0.6, 1.15, rough);
      const wave: Wave = {
        id: seed, x, base: base + r.range(-0.15, 0.15) * sp * 0.2, h, z: 0,
        dir: w.dir, curl: r.range(0.1, 0.45) + rough * 0.15, back: h * r.range(2.2, 4.2), front: h * r.range(1.1, 1.8), foam: r.range(0.3, 0.65),
      };
      wave.z = zOf(wave.base) + r.random() * 1e-3;
      if (inPad(p, x, waveReach(wave))) planWave(p, wave);
    }
  }

  for (const wave of p.near.waves) if (inPad(p, wave.x, waveReach(wave))) planWave(p, wave);
}

/** Every block of one wave, in printing order. */
export function planWave(p: ChunkPlan, w: Wave) {
  const s = waveShape(w);
  if (!spanInPad(p, s.x0, s.x1)) return;
  const world = p.world, t = world.tintAt(w.x), r = new Rng(hash(w.id, 31));
  const layer = depthLayer(w.z, w.id);
  let key = 0;
  const push = (op: Item['op']) => p.items.push({ layer, key: key++, op });
  const lw = clamp(w.h * 0.0032, 0.7, 2.6);
  const key0 = mix(t.key, t.seaFar, (1 - w.z) * 0.25 * clamp(1 - w.h / 120, 0, 1));

  // Body, graded from deep blue at the crest to the sea at its foot.
  push((ctx) => {
    ctx.fillStyle = waterFill(ctx, t, w);
    ctx.beginPath();
    polyPath(ctx, s.body);
    ctx.fill();
  });

  // Light bands carved along the back and on round into the curl.
  if (w.h > 34) {
    const sp = clamp(w.h * 0.022, 3, 16), K = clamp(Math.round(w.h / 55), 1, 13);
    const bands: { pts: Pt[]; bw: number }[] = [];
    for (let k = 1; k <= K; k++) {
      const d = sp * (k * 1.25 + 0.6), bw = sp * r.range(0.3, 0.45);
      const from = Math.floor(s.lipAt * r.range(0.2, 0.75));
      // Follow the lip only while it is thick enough to hold the band, so bands never cross.
      let to = s.lipAt;
      while (to + 1 < s.top.length && s.lip[to + 1 - s.lipAt].th > (d + bw) * 1.15) to++;
      to -= r.int(0, 2);
      const seg = s.top.slice(from, to + 1);
      if (seg.length < 3) continue;
      bands.push({ pts: offset(seg, w.dir * d), bw });
    }
    const bandCol = mix(t.band, t.seaFar, (1 - w.z) * 0.2);
    push((ctx) => {
      ctx.save();
      ctx.beginPath();
      polyPath(ctx, s.body);
      ctx.clip();
      for (const b of bands) keyline(ctx, b.pts, b.bw, bandCol, 0.92);
      for (const b of bands) keyline(ctx, offset(b.pts, w.dir * b.bw * 0.5), lw * 0.75, key0, 0.9);
      ctx.restore();
    });
  }

  // The key block's outline: back, lip, and the face round the hollow.
  const outline = s.top.concat(s.inner.slice().reverse(), s.face);
  push((ctx) => keyline(ctx, outline, lw, key0));

  // Foam: a white crest band with claws, all outlined as one.
  const shapes: Pt[][] = [], dots: [number, number, number][] = [];
  foamBand(s, w, shapes, r);
  if (w.h > 16) claws(s, w, shapes, r);
  if (w.curl > 0.55 && w.h > 60) spray(s, w, dots, r);
  if (shapes.length || dots.length) push((ctx) => inkedUnion(ctx, shapes, t.foam, key0, lw * 0.6, dots));
}

function foamBand(s: ReturnType<typeof waveShape>, w: Wave, out: Pt[][], r: Rng) {
  const back = Math.max(2, Math.round(s.lipAt * (0.08 + 0.1 * w.foam)));
  const seg = s.top.slice(s.lipAt - back), n = seg.length;
  if (n < 2) return;
  const base = seg.map((_, i) => {
    if (i < back) return s.T0 * 0.35 * (i / back) * (0.6 + 0.4 * w.foam);
    const l = s.lip[i - back];
    return Math.max(0.6, l.th * (0.4 + 0.4 * l.s) * (0.7 + 0.5 * w.foam));
  });
  const nrm = offset(seg, 1).map((q, i) => [q[0] - seg[i][0], q[1] - seg[i][1]] as Pt);
  // Interpolate finely: the inner edge sends fingers of foam of uneven length down into the blue.
  const period = Math.max(5, s.R * r.range(0.09, 0.13)), ph = r.random() * 10;
  const outer: Pt[] = [], inner: Pt[] = [];
  let u = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < 4; j++) {
      const f = j / 4, a = seg[i], b = seg[i + 1];
      const x = lerp(a[0], b[0], f), y = lerp(a[1], b[1], f);
      const nx = lerp(nrm[i][0], nrm[i + 1][0], f), ny = lerp(nrm[i][1], nrm[i + 1][1], f);
      const q = u / period + ph + 0.35 * Math.sin(u / period * 0.7), k = Math.floor(q);
      const finger = Math.pow(Math.sin((q - k) * Math.PI), 5) * (0.25 + 1.1 * hashFloat(w.id, 33, k));
      const wd = lerp(base[i], base[i + 1], f) * (0.5 + 0.85 * finger);
      outer.push([x - nx * w.dir * 0.4, y - ny * w.dir * 0.4]);
      inner.push([x + nx * w.dir * wd, y + ny * w.dir * wd]);
      u += Math.hypot(b[0] - a[0], b[1] - a[1]) / 4;
    }
  }
  outer.push(seg[n - 1]);
  out.push(outer.concat(inner.reverse()));
}

/** A claw of foam: a curling finger, its end splitting into smaller talons. */
function claw(out: Pt[][], r: Rng, x: number, y: number, a: number, len: number, wid: number, turn: number, depth: number) {
  const n = 8, side: Pt[] = [], other: Pt[] = [], spine: [number, number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n, half = Math.max(0.35, wid * 0.5 * Math.pow(1 - f, 0.8));
    const nx = -Math.sin(a), ny = Math.cos(a);
    side.push([x + nx * half, y + ny * half]);
    other.push([x - nx * half, y - ny * half]);
    spine.push([x, y, a]);
    x += Math.cos(a) * len / n;
    y += Math.sin(a) * len / n;
    a += turn * (0.25 + 2.4 * f * f) / n;
  }
  out.push(side.concat(other.reverse()));
  if (depth <= 0 || len < 5) return;
  const kids = r.int(2, 3);
  for (let j = 0; j < kids; j++) {
    const at = spine[Math.min(n, Math.round(n * r.range(0.5, 0.85)))];
    const spread = (j - (kids - 1) / 2) * r.range(0.5, 0.8);
    claw(out, r, at[0], at[1], at[2] + spread * Math.sign(turn) + turn * 0.15, len * r.range(0.4, 0.55), wid * 0.55, turn * r.range(1.1, 1.4), depth - 1);
  }
}

function claws(s: ReturnType<typeof waveShape>, w: Wave, out: Pt[][], r: Rng) {
  const lip = s.lip, R = s.R;
  const big = w.h > 400, depth = big ? 2 : w.h > 90 ? 1 : 0;
  const step = Math.max(2, Math.round(lip.length / (4 + w.foam * w.curl * (big ? 22 : 10))));
  for (let i = 1 + r.int(0, step); i < lip.length - 1; i += step + r.int(-1, 1)) {
    const l = lip[i];
    if (l.s < 0.04 || (l.s > 0.97 && w.curl > 0.6)) continue;
    // Out from the lip, along its sweep, and pulled down a little by its own weight.
    const dx = l.n[0] * 0.75 + l.t[0] * 0.6, dy = l.n[1] * 0.75 + l.t[1] * 0.6 + 0.4;
    const len = R * r.range(0.24, 0.48) * (1 - 0.35 * l.s) * (0.6 + 0.5 * w.foam);
    const turn = w.dir * r.range(1.3, 2.3);
    claw(out, r, l.p[0] - l.n[0] * l.th * 0.15, l.p[1] - l.n[1] * l.th * 0.15, Math.atan2(dy, dx), len, len * r.range(0.32, 0.45), turn, depth);
  }
}

function spray(s: ReturnType<typeof waveShape>, w: Wave, out: [number, number, number][], r: Rng) {
  const R = s.R, n = Math.round(w.foam * R * 0.4);
  const phi = lipSweep(w.curl);
  for (let i = 0; i < n; i++) {
    const th = Math.PI / 2 + 0.3 - r.random() * (phi + 0.5);
    const rr = R * (1.1 + Math.pow(r.random(), 1.4) * 0.9);
    const x = s.center[0] + w.dir * Math.cos(th) * rr, y = s.center[1] - Math.sin(th) * rr;
    out.push([x, y, R * r.range(0.006, 0.02) + 0.5]);
  }
}
