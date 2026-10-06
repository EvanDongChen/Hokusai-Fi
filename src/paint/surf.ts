// The sea's surface (src/world/field.ts), carved in Hokusai's manner. Each band of water is
// printed back to front, block by block:
//
//  - its body, Prussian blue graded toward the sea's own colour below;
//  - the white of its backs: foam lying along the surface, deep behind the big crests and a thin
//    rim on their faces, with the blue rising into it in fingers tipped with claws;
//  - stripes of paler and deeper blue running under the foam, parallel to the surface;
//  - on each breaking crest, its simulated lip: blue beneath, a crown of foam along its outer edge
//    breaking into fingers and claws;
//  - and the key block's line along the whole surface.
//
// Every mark is seeded by where it lies in the world (its band and stretch), never by the chunk,
// so two chunks print a shared stretch identically.

import { css, mix, type RGB } from '../core/color';
import { Path } from '../core/curve';
import { clamp, lerp } from '../core/math';
import { onKey, polyPath, type Pt } from '../core/print';
import { hash, hashFloat, Rng } from '../core/rng';
import { bands, crestOf, curlOf, packetsNear, surface, type Band, type Curl, type Sample } from '../world/field';
import { H, type Tint } from '../world/world';
import { crown, lobed, paintLayers, talonLayers, talons, talonsOnTips } from './ink';
import { depthLayer, tintRuns, type ChunkPlan, type Item } from './plan';

/** How far either side of a chunk its bands are sampled, so every crest that reaches in is found. */
const LOOK = 1500;

export function planSurf(p: ChunkPlan) {
  const world = p.world;
  for (const b of bands()) {
    const S = surface(world, b, p.x0 - LOOK, p.x1 + LOOK);
    const layer = depthLayer(b.z, hash(world.s, b.j));
    let key = 0;
    const push = (...ops: Item['op'][]) => { for (const op of ops) p.items.push({ layer, key: key++, op }); };
    const lo = p.x0 - p.pad - 60, hi = p.x1 + p.pad + 60;
    // The samples that can show in this chunk (the surface can lean forward, so a margin).
    let i0 = S.findIndex((s) => s.p[0] > lo - b.s * 400), i1 = S.length - 1;
    while (i1 > 0 && S[i1].p[0] > hi + b.s * 400) i1--;
    if (i0 < 0) i0 = 0;
    const vis = S.slice(i0, i1 + 1);
    if (vis.length < 2) continue;

    // The body.
    const body: Pt[] = vis.map((s) => s.p);
    body.push([vis[vis.length - 1].p[0], H + 60], [vis[0].p[0], H + 60]);
    push((ctx) => {
      for (const { x, w, t } of tintRuns(p)) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 0, w, H + 80);
        ctx.clip();
        ctx.fillStyle = bodyFill(ctx, b, t);
        ctx.beginPath();
        polyPath(ctx, body);
        ctx.fill();
        ctx.restore();
      }
    });

    // Foam, stripes and claws, a stretch at a time.
    const cw = Math.max(48, b.s * 320);
    const k0 = Math.floor(vis[0].a / cw), k1 = Math.floor(vis[vis.length - 1].a / cw);
    // All the band's stripes, then all its foam, then its claws, so no stretch's stripes run
    // over its neighbour's foam.
    const layers: Item['op'][][] = [[], [], []];
    for (let k = k0; k <= k1; k++) carveStretch(layers, world.s, b, S, k, cw, world.tintAt((k + 0.5) * cw), world.dir, body);
    for (const l of layers) push(...l);

    // Breaking crests.
    for (const pk of packetsNear(world, b, lo - 600, hi + 600)) {
      if (pk.kind !== 'plunge') continue;
      const ci = crestOf(S, pk);
      if (ci < 0) continue;
      const c = curlOf(pk, S[ci].p), t = world.tintAt(S[ci].p[0]);
      const xs = c.outer.map((q) => q[0]);
      if (Math.max(...xs) + c.R < lo || Math.min(...xs) - c.R > hi) continue;
      push(...lipOps(pk.id, pk.dir, c, b, t));
    }

    // The key line along the whole surface.
    const line = vis.map((s) => s.p), lw = keyWidth(b), tk = world.tintAt((p.x0 + p.x1) / 2);
    push((ctx) => {
      ctx.fillStyle = css(mix(tk.key, tk.seaFar, (1 - b.s) * 0.35));
      ctx.beginPath();
      polyPath(ctx, worldLine(line, lw, hash(world.s, b.j, 0x11), false, vis.map((s) => s.a)));
      onKey(ctx, () => ctx.fill());
    });
  }
}

const keyWidth = (b: Band) => clamp(0.6 + b.s * 2.4, 0.6, 2.8);

/** The blue of a band at its surface: deeper and darker in front, paler toward the horizon. */
function bodyTop(b: Band, t: Tint): RGB {
  return mix(mix(t.seaFar, t.sea, clamp(b.s * 3, 0, 1)), t.deep, clamp((b.s - 0.15) * 1.3, 0, 0.9));
}

function bodyFill(ctx: CanvasRenderingContext2D, b: Band, t: Tint): CanvasGradient {
  const top = b.base - 420 * b.s - 6, g = ctx.createLinearGradient(0, top, 0, b.base + 120 * b.s + 10);
  g.addColorStop(0, css(bodyTop(b, t)));
  g.addColorStop(0.7, css(mix(bodyTop(b, t), t.seaNear, 0.35)));
  g.addColorStop(1, css(mix(bodyTop(b, t), t.sea, 0.6)));
  return g;
}

const inks = (t: Tint) => ({
  paper: t.foam, aqua: t.band, blue: t.seaNear, deep: t.deep, key: t.key, shade: t.cloud,
  boat: t.land, boatDark: t.land, cloth: t.deep, skin: t.foam, hair: t.key, snow: t.snow,
});

/**
 * How deep the foam lies under the surface at a sample: deep on the backs of the bigger crests,
 * a thin rim on their faces, a fleck on the smallest.
 */
function foamDepth(b: Band, s: Sample): number {
  const pk = s.packet;
  let d = b.s * 3 + 1;
  if (pk && s.f > 0.15) {
    // A bridge is white on both sides, like the swells of the print it carries on.
    const back = pk.bridge || (s.a - pk.c) * pk.dir < 0, big = pk.kind === 'swell' ? 0.1 : pk.kind === 'spill' ? 0.2 : 0.24;
    d += pk.E * s.f * (back ? big : big * 0.25) * Math.pow(s.f, 0.6);
  }
  return d;
}

/** One stretch of a band: the white of the backs, fingers and claws, and stripes. */
function carveStretch(out: Item['op'][][], seed: number, b: Band, S: Sample[], k: number, cw: number, t: Tint, dir: 1 | -1, body: Pt[]) {
  const from = k * cw, to = (k + 1) * cw;
  // The samples of this stretch, one more each side so neighbouring stretches meet.
  let i0 = S.findIndex((s) => s.a >= from), i1 = i0;
  if (i0 < 0) return;
  while (i1 < S.length - 1 && S[i1 + 1].a <= to) i1++;
  i0 = Math.max(0, i0 - 1);
  i1 = Math.min(S.length - 1, i1 + 1);
  const seg = S.slice(i0, i1 + 1);
  if (seg.length < 3) return;
  const r = new Rng(hash(seed, 0x5f, b.j, k));
  const n = normals(seg), D = seg.map((s) => foamDepth(b, s)), top = seg.map((s) => s.p);
  const meanD = D.reduce((a, v) => a + v, 0) / D.length, maxD = Math.max(...D);
  const foamLine: Pt[] = seg.map((s, i) => [s.p[0] + n[i][0] * D[i], s.p[1] + n[i][1] * D[i]]);

  // Stripes below the foam, following the surface.
  const stripes: { pts: Pt[]; ink: RGB }[] = [];
  // Stripes all the way down a tall crest, a few under a low one.
  const gap = 6 + b.s * 34, tall = Math.max(...seg.map((s) => s.h)) - b.s * 20;
  const rows = b.s < 0.15 ? 1 : b.s < 0.4 ? 2 : clamp(Math.round(tall / gap * 0.7), 3, 12);
  for (let row = 0; row < rows; row++) {
    if (!r.chance(0.8)) continue;
    const a = r.range(0, 0.4), z = r.range(a + 0.35, 1), w = gap * r.range(0.25, 0.45);
    const j0 = Math.floor(a * (seg.length - 1)), j1 = Math.ceil(z * (seg.length - 1));
    const up: Pt[] = [], dn: Pt[] = [];
    for (let i = j0; i <= j1; i++) {
      const u = (i - j0) / Math.max(1, j1 - j0), hw = w * Math.pow(Math.sin(Math.PI * u), 0.6) / 2;
      const d = D[i] + gap * (row + 0.8) * (1 + row * 0.08) + Math.sin(u * 5 + row) * gap * 0.15;
      up.push([seg[i].p[0] + n[i][0] * (d - hw), seg[i].p[1] + n[i][1] * (d - hw)]);
      dn.push([seg[i].p[0] + n[i][0] * (d + hw), seg[i].p[1] + n[i][1] * (d + hw)]);
    }
    stripes.push({ pts: up.concat(dn.reverse()), ink: row % 3 === 1 ? t.deep : row % 3 === 2 ? t.seaNear : mix(t.band, t.seaNear, 0.3) });
  }

  // The blue rises into the foam in fingers, the bigger the deeper the foam.
  const tl = talons();
  let edge = foamLine;
  if (maxD > 5) {
    const lb = lobed(new Path(foamLine), 0, 1, { period: clamp(meanD * 0.9, 6, 55), amp: Math.min(meanD * 0.45, 40), side: -1, lean: 0.45 * dir }, r);
    edge = lb.edge;
    if (meanD > 6) talonsOnTips(tl, r, lb.tips, clamp(meanD * 0.45, 3.5, 28), dir, { every: 0.85 });
  }
  const foam = top.concat(edge.slice().reverse()), lw = keyWidth(b);
  // Stripes and foam lie in the water: offset far under a steep surface they would swing out.
  const inWater = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.beginPath();
    polyPath(ctx, body);
    ctx.clip();
  };
  out[0].push((ctx) => {
    inWater(ctx);
    for (const st of stripes) {
      ctx.fillStyle = css(st.ink);
      ctx.beginPath();
      polyPath(ctx, st.pts);
      ctx.fill();
    }
    ctx.restore();
  });
  out[1].push((ctx) => {
    inWater(ctx);
    ctx.fillStyle = css(t.foam);
    ctx.beginPath();
    polyPath(ctx, foam);
    ctx.fill();
    if (maxD > 5) {
      ctx.fillStyle = css(t.key);
      ctx.beginPath();
      polyPath(ctx, worldLine(edge, lw * 0.6, hash(seed, b.j, k, 0x12), false));
      onKey(ctx, () => ctx.fill());
    }
    ctx.restore();
  });
  if (tl.body.length) out[2].push((ctx) => paintLayers(ctx, talonLayers(tl, clamp(lw * 0.55, 0.4, 1.3)), inks(t)));
}

/** Unit normals into the water (to the right of a left-to-right surface on screen). */
function normals(seg: Sample[]): Pt[] {
  return seg.map((_, i) => {
    const a = seg[Math.max(0, i - 1)].p, c = seg[Math.min(seg.length - 1, i + 1)].p;
    const tx = c[0] - a[0], ty = c[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [-ty / l, tx / l];
  });
}

/**
 * A carved line whose width depends only on where it lies (`at`, world x by default), so the
 * same stretch carved in two chunks has the same line. Tapers at its ends unless `closed`.
 */
function worldLine(pts: Pt[], w: number, seed: number, closed: boolean, at?: number[]): Pt[] {
  const n = pts.length, left: Pt[] = [], right: Pt[] = [];
  const knot = Math.max(18, w * 16);
  const press = (s: number) => {
    const u = s / knot, k = Math.floor(u), f = u - k, e = f * f * (3 - 2 * f);
    return lerp(hashFloat(seed, k), hashFloat(seed, k + 1), e);
  };
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    const tx = c[0] - a[0], ty = c[1] - a[1], d = Math.hypot(tx, ty) || 1;
    const taper = closed || at ? 1 : Math.min(1, (i + 1) / 6, (n - i) / 6);
    const h = Math.max(0.15, w * (0.6 + 0.75 * press(at ? at[i] : i * 3)) * taper) / 2;
    left.push([pts[i][0] - (ty / d) * h, pts[i][1] + (tx / d) * h]);
    right.push([pts[i][0] + (ty / d) * h, pts[i][1] - (tx / d) * h]);
  }
  return closed ? left.concat([left[0]], right.slice().reverse(), [right[n - 1]]) : left.concat(right.reverse());
}

/**
 * A breaking lip, as the great wave's is cut: blue beneath, and along its outer side the white
 * of the back carried on over the top, the blue rising into it in clawed fingers; toward the tip
 * the foam breaks away into a crown of fingers reaching forward and curling over.
 */
function lipOps(id: number, dir: 1 | -1, c: Curl, b: Band, t: Tint): Item['op'][] {
  const r = new Rng(hash(id, 0xc2)), n = c.spine.length, lw = keyWidth(b);
  const lip = c.outer.concat(c.inner.slice().reverse());
  // The foam's inner edge: about halfway through the lip near its root, out to its edge at the tip.
  const edge: Pt[] = c.outer.map((o, i) => {
    const s = i / (n - 1), u = lerp(0.55, 0.05, Math.pow(s, 1.3));
    return [lerp(o[0], c.inner[i][0], u), lerp(o[1], c.inner[i][1], u)];
  });
  const T = Math.hypot(c.outer[0][0] - c.inner[0][0], c.outer[0][1] - c.inner[0][1]);
  const lb = lobed(new Path(edge), 0, 0.75, { period: clamp(T * 0.35, 8, 40), amp: T * 0.18, side: 1, lean: 0.4 }, r);
  const foam = c.outer.slice(0, Math.round((n - 1) * 0.75) + 1).concat(lb.edge.slice().reverse());
  const tl = talons(), size = clamp(c.R * 0.2, 4, 26);
  talonsOnTips(tl, r, lb.tips, size * 0.8, dir, { every: 0.7 });
  crown(tl, r, new Path(c.outer), new Path(edge), { rows: 2, step: size * 1.15, size, turn: dir, from: 0.55, to: 0.98, grow: 1.25, out: 0.25 });
  return [
    (ctx) => {
      ctx.fillStyle = css(bodyTop(b, t));
      ctx.beginPath();
      polyPath(ctx, lip);
      ctx.fill();
      ctx.fillStyle = css(t.foam);
      ctx.beginPath();
      polyPath(ctx, foam);
      ctx.fill();
      ctx.fillStyle = css(t.key);
      ctx.beginPath();
      polyPath(ctx, worldLine(c.outer, lw, hash(id, 1), false));
      polyPath(ctx, worldLine(c.inner, lw * 0.8, hash(id, 2), false));
      polyPath(ctx, worldLine(lb.edge, lw * 0.6, hash(id, 3), false));
      onKey(ctx, () => ctx.fill('nonzero'));
    },
    (ctx) => paintLayers(ctx, talonLayers(tl, clamp(lw * 0.6, 0.5, 1.4)), inks(t)),
  ];
}
