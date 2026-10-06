// Prints the frame: the composition (src/world/kanagawa.ts) cut into blocks by the procedures in
// ink.ts and pulled one element at a time, back to front. Within an element the blocks go down
// as a printer lays them, lightest first: the paper of the water, pale indigo, blue, deep blue,
// the white of the foam, and last the key block's lines and hooks.

import { css, mix, type RGB } from '../core/color';
import { Path, spline } from '../core/curve';
import { clamp, lerp } from '../core/math';
import { carvedLine, polyPath, type Ctx, type Pt } from '../core/print';
import { hash, Rng } from '../core/rng';
import { composition, type BoatSpec, type Composition, type Element, type FujiSpec, type SeaSpec, type WaveSpec, type ZoneInk } from '../world/kanagawa';
import { FRAME_W, H, TINTS, type Tint, type World } from '../world/world';
import { blob, crown, flecks, lobed, paintLayers, sliver, talon, talons, talonsOnTips, talonLayers, type Ink, type Layer, type Palette } from './ink';
import { context2d, makeCanvas } from './canvas';
import { L, type ChunkPlan } from './plan';
import { planOrbs, planWeather } from './sky';

/** The inks of the print on a clear day, and what each becomes in other weather. */
const DAY: Palette = {
  paper: [247, 243, 224], aqua: [196, 216, 208], blue: [52, 106, 143], deep: [37, 64, 96], key: [36, 56, 86],
  shade: [140, 146, 144], boat: [228, 199, 160], boatDark: [150, 112, 70], cloth: [44, 70, 104], skin: [236, 210, 172], hair: [30, 30, 34], snow: [250, 248, 238],
};
const TINT: Record<Ink, (t: Tint) => RGB> = {
  paper: (t) => t.foam, aqua: (t) => t.band, blue: (t) => t.seaNear, deep: (t) => t.deep, key: (t) => t.key,
  shade: (t) => mix(t.skyLow, t.key, 0.45), boat: (t) => mix([228, 199, 160], t.sky, 0.3), boatDark: (t) => mix([150, 112, 70], t.key, 0.3),
  cloth: (t) => mix([44, 70, 104], t.deep, 0.4), skin: (t) => mix([236, 210, 172], t.sky, 0.3), hair: (t) => mix([30, 30, 34], t.key, 0.3), snow: (t) => t.snow,
};

export function palette(world: World): Palette {
  return paletteOf(TINTS[world.mood]);
}

/** The print's inks recut for a set of colour blocks. */
function paletteOf(t: Tint): Palette {
  if (t === TINTS.day) return DAY;
  const out = {} as Palette;
  for (const k in DAY) out[k as Ink] = mix(DAY[k as Ink], TINT[k as Ink](t), 0.8);
  return out;
}

/** The sky's grading, top to the horizon, on a clear day. */
const SKY: [number, RGB][] = [[0, [236, 218, 180]], [0.12, [244, 229, 194]], [0.5, [245, 234, 210]], [0.7, [242, 232, 210]]];

export interface PrintOpts {
  /** Flat inks and no grading: used to measure the print against Hokusai's. */
  flat?: boolean;
}

// ------------------------------------------------------------ planning

const plates = new WeakMap<Element, Map<number, Layer[]>>();

/** An element's blocks, cut once per seed. */
function layersOf(world: World, e: Element): Layer[] {
  let m = plates.get(e);
  if (!m) plates.set(e, (m = new Map()));
  let l = m.get(world.s);
  if (!l) {
    if (m.size > 8) m.clear();
    m.set(world.s, (l = carve(e, new Rng(hash(world.s, 0x77, e.id)))));
  }
  return l;
}

export function planPrint(p: ChunkPlan) {
  const w = p.world, comp = composition(w), pal = palette(w);
  p.items.push({ layer: L.SKY, key: 0, block: 'sky', op: (ctx) => sky(ctx, comp, w, pal) });
  planOrbs(p);
  planWeather(p);
  comp.elements.forEach((e, i) => {
    p.items.push({ layer: L.WAVE + i * 0.01, key: 0, block: e.kind, op: (ctx) => paintElement(ctx, e, layersOf(w, e), pal) });
  });
  p.items.push({ layer: L.WAVE + 0.9, key: 0, block: 'spray', op: (ctx) => paintLayers(ctx, sprayOf(w, comp), pal) });
}

/** The whole print onto a context in print coordinates, for measuring or previews. */
export function printComposition(ctx: Ctx, world: World, pal: Palette, o: PrintOpts = {}) {
  const comp = composition(world);
  if (o.flat) {
    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, FRAME_W, H);
  } else sky(ctx, comp, world, pal);
  for (const e of comp.elements) paintElement(ctx, e, layersOf(world, e), pal);
  paintLayers(ctx, sprayOf(world, comp), pal);
}

function paintElement(ctx: Ctx, e: Element, layers: Layer[], pal: Palette) {
  if (e.kind === 'wave') {
    // Everything but the talons and the outline stays inside the body of water.
    const body = bodyOf(e);
    const split = layers.findIndex((l) => (l as Layer & { free?: boolean }).free);
    ctx.save();
    ctx.beginPath();
    polyPath(ctx, body);
    ctx.clip();
    paintLayers(ctx, split < 0 ? layers : layers.slice(0, split), pal);
    ctx.restore();
    if (split >= 0) paintLayers(ctx, layers.slice(split), pal);
  } else paintLayers(ctx, layers, pal);
}

// ------------------------------------------------------------ sky

/**
 * Out of Hokusai's print the voyage sails on under his sky: it fades into the sea's own sky over
 * a few hundred px either side of the sheet.
 */
export function planPrintSkyFade(p: ChunkPlan) {
  const w = p.world, FADE = 700;
  if (!w.original || p.x1 + p.pad < -FADE || p.x0 - p.pad > FRAME_W + FADE) return;
  const comp = composition(w), pal = palette(w);
  p.items.push({
    layer: L.SKY + 0.01, key: 0, op: (ctx) => {
      // Hokusai's sky on a sheet of its own, faded out across by a mask, then laid over the sea's.
      const S = 0.25, side = p.x0 < 0 ? -1 : 1, x0 = side < 0 ? -FADE : FRAME_W;
      const sheet = makeCanvas(Math.ceil(FADE * S), Math.ceil(H * S)), sc = context2d(sheet);
      sc.scale(S, S);
      sc.fillStyle = skyGradient(sc, comp, w, pal);
      sc.fillRect(0, 0, FADE, H);
      const m = sc.createLinearGradient(0, 0, FADE, 0);
      m.addColorStop(side < 0 ? 1 : 0, 'rgba(0,0,0,1)');
      m.addColorStop(side < 0 ? 0 : 1, 'rgba(0,0,0,0)');
      sc.globalCompositeOperation = 'destination-in';
      sc.fillStyle = m;
      sc.fillRect(0, 0, FADE, H);
      ctx.drawImage(sheet as CanvasImageSource, x0, 0, FADE, H);
    },
  });
}

function skyGradient(ctx: Ctx, comp: Composition, world: World, pal: Palette): CanvasGradient {
  const t = world.mood === 'day' ? null : world.tintAt(FRAME_W / 2);
  const g = ctx.createLinearGradient(0, 0, 0, comp.horizon);
  for (const [f, c] of SKY) g.addColorStop(f, css(t ? mix(c, f < 0.1 ? t.skyTop : t.sky, 0.85) : c));
  const [d0, d1] = comp.dusk, hz = comp.horizon;
  const grey = t ? mix(pal.shade, t.skyLow, 0.3) : ([124, 125, 119] as RGB);
  g.addColorStop(d0 / hz, css(t ? mix([242, 232, 210], t.skyLow, 0.85) : [242, 232, 210]));
  g.addColorStop(lerp(d0, d1, 0.3) / hz, css(mix(grey, t ? t.skyLow : [242, 232, 210], 0.45)));
  g.addColorStop(lerp(d0, d1, 0.6) / hz, css(mix(grey, t ? t.skyLow : [242, 232, 210], 0.08)));
  g.addColorStop(1, css(grey));
  return g;
}

function sky(ctx: Ctx, comp: Composition, world: World, pal: Palette) {
  const t = world.mood === 'day' ? null : world.tintAt(FRAME_W / 2);
  const d0 = comp.dusk[0], grey = t ? mix(pal.shade, t.skyLow, 0.3) : ([124, 125, 119] as RGB);
  ctx.fillStyle = skyGradient(ctx, comp, world, pal);
  ctx.fillRect(0, 0, FRAME_W, H);
  // The grey is wiped onto the block unevenly, so its upper edge billows like low cloud.
  const r = new Rng(hash(world.s, 0x5c7));
  for (let i = 0; i < 26; i++) {
    const x = r.range(-100, FRAME_W + 100), y = d0 + r.range(10, 50), rx = r.range(80, 220), ry = r.range(14, 34);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rx);
    rg.addColorStop(0, css(mix(grey, [242, 232, 210], 0.35), 0.35));
    rg.addColorStop(1, css(mix(grey, [242, 232, 210], 0.35), 0));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ctx.fillStyle = rg;
    ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
    ctx.restore();
  }
}

// ------------------------------------------------------------ carving

function carve(e: Element, r: Rng): Layer[] {
  if (e.kind === 'wave') return carveWave(e, r);
  if (e.kind === 'boat') return carveBoat(e, r);
  if (e.kind === 'fuji') return carveFuji(e, r);
  return carveSea(e, r);
}

const curve = (ctrl: Pt[], step = 4) => spline(ctrl, step);

/** Straight-ish closing lines, smoothed where they show (a point given twice keeps a corner). */
const closing = (from: Pt, close: Pt[]): Pt[] => (close.length > 1 ? spline([from, ...close], 4).slice(1) : close);

function bodyOf(w: WaveSpec): Pt[] {
  const o = curve(w.outline);
  return o.concat(closing(o[o.length - 1], w.close));
}

const ink = (z: ZoneInk): Ink => z;

function carveWave(w: WaveSpec, r: Rng): Layer[] {
  const body = bodyOf(w);
  const out: Layer[] = [{ ink: ink(w.ink ?? 'paper'), fill: [body] }];
  const by: Record<string, Pt[][]> = { aqua: [], blue: [], deep: [], paper: [] };

  // Stripes: long slivers between two paths, laid down lightest first.
  for (const s of w.stripes ?? []) {
    const A = new Path(curve(s.a)), B = new Path(curve(s.b));
    for (let k = 0; k < s.rows; k++) {
      const u = (k + 0.5) / s.rows + r.range(-0.2, 0.2) / s.rows;
      let v = (s.from ?? 0) + r.range(-0.1, 0.15);
      while (v < (s.to ?? 1)) {
        const len = r.range(0.35, 0.8), v1 = Math.min(1.05, v + len);
        by[s.inks[k % s.inks.length]].push(sliver(A, B, u, s.w * r.range(0.7, 1.3), v, v1, { wave: r.range(2, 8), ph: r.range(0, 6) }));
        v = v1 + r.range(0.02, 0.12);
      }
    }
  }
  out.push({ ink: 'aqua', fill: by.aqua }, { ink: 'blue', fill: by.blue }, { ink: 'deep', fill: by.deep });

  const tl = talons();
  const sl: Record<string, Pt[][]> = { aqua: [], blue: [], deep: [], paper: [] };
  for (const v of w.slivers ?? []) {
    const S = new Path(curve(v.spine, 3)), n = Math.max(8, Math.ceil(S.total / 4));
    const taper = (t: number) => v.w / 2 * Math.pow(Math.sin(Math.PI * t), 0.45);
    const upper: Pt[] = [], lower: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = S.at(t), nr = S.normal(t), h = taper(t);
      // The upper edge is the one higher on the page.
      const s = nr[1] > 0 ? -1 : 1;
      upper.push([p[0] + nr[0] * h * s, p[1] + nr[1] * h * s]);
      lower.push([p[0] - nr[0] * h * s, p[1] - nr[1] * h * s]);
    }
    let top = upper;
    if (v.lobes) {
      const lb = lobed(new Path(upper), 0, 1, v.lobes, r);
      top = lb.edge;
      if (v.claws) talonsOnTips(tl, r, lb.tips, v.claws.size, v.claws.turn, { curl: v.claws.curl });
    }
    sl[v.ink].push(top.concat(lower.reverse()));
  }
  out.push({ ink: 'aqua', fill: sl.aqua }, { ink: 'blue', fill: sl.blue }, { ink: 'deep', fill: sl.deep });

  const fringes: { pts: Pt[]; w: number }[] = [], fills: Record<string, Pt[][]> = { aqua: [], blue: [], deep: [], paper: [] };
  const strands: Record<string, Pt[][]> = { aqua: [], blue: [], deep: [], paper: [] }, dots: Pt[][] = [];
  for (const z of w.zones) {
    const E = new Path(curve(z.edge, 3));
    let edge = E.pts;
    if (z.lobes) {
      const lb = lobed(E, 0, 1, z.lobes, r);
      edge = lb.edge;
      if (z.claws) talonsOnTips(tl, r, lb.tips, z.claws.size, z.claws.turn, { curl: z.claws.curl, lift: z.claws.lift, every: z.claws.every });
    }
    const poly = edge.concat(closing(edge[edge.length - 1], z.close));
    if (z.fringe) fringes.push({ pts: edge, w: z.fringe * 2 });
    fills[z.ink].push(poly);
    if (z.strands) {
      const S = new Path(curve(z.strands.to)), sk = z.strands.ink ?? 'blue';
      for (let k = 0; k < z.strands.n; k++) {
        const u = (k + 0.6) / (z.strands.n + 0.4) + r.range(-0.03, 0.03);
        const v0 = r.range(0, 0.25), v1 = r.range(0.75, 1);
        strands[sk].push(sliver(E, S, u, z.strands.w * r.range(0.7, 1.3), v0, v1, { wave: r.range(1, 4), ph: r.range(0, 6), minW: 9 }));
      }
    }
    if (z.flecks) dots.push(...flecks(poly, z.flecks, 1.6, 4.6, r));
  }
  if (fringes.length) out.push({ ink: 'aqua', line: fringes });
  out.push({ ink: 'deep', fill: fills.deep }, { ink: 'blue', fill: fills.blue }, { ink: 'aqua', fill: fills.aqua }, { ink: 'paper', fill: fills.paper });
  out.push({ ink: 'blue', fill: strands.blue }, { ink: 'aqua', fill: strands.aqua }, { ink: 'deep', fill: strands.deep });
  out.push({ ink: 'paper', fill: dots });

  // The outline, then the foam: these are free of the body, and break out over the sky.
  for (const c of w.crowns ?? []) crown(tl, r, new Path(curve(c.a)), new Path(curve(c.b)), c);
  const foam: (Layer & { free?: boolean })[] = talonLayers(tl);
  foam[0].free = true;
  out.push(...foam);
  const k = w.key ?? [0, 1];
  if (k[1] > k[0]) {
    const O = new Path(curve(w.outline));
    out.push({ ink: 'key', fill: [carvedLine(O.slice(k[0], k[1], 3), 3.2)] });
  }
  return out;
}

function carveBoat(b: BoatSpec, r: Rng): Layer[] {
  const K = new Path(curve(b.keel, 4)), n = 60;
  // The deck faces up: whichever side of the keel is higher on the page.
  const mid = K.normal(0.5), up = mid[1] < 0 ? 1 : -1;
  const hull: Pt[] = [], rail: Pt[] = [], deck: Pt[] = [];
  const beam = (t: number) => b.beam * Math.pow(Math.sin(Math.PI * clamp(t * 1.02, 0, 1)), 0.35) * (t < 0.1 ? 0.6 + 4 * t : 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = K.at(t), nr = K.normal(t), bw = beam(t);
    hull.push([p[0] + nr[0] * up * bw, p[1] + nr[1] * up * bw]);
    rail.push([p[0] + nr[0] * up * bw * 0.72, p[1] + nr[1] * up * bw * 0.72]);
    deck.push([p[0] + nr[0] * up * bw * 0.35, p[1] + nr[1] * up * bw * 0.35]);
  }
  // The bow rises to a point.
  const bow = K.at(0), bd = K.dir(0), nb = K.normal(0);
  const prow: Pt = [bow[0] - bd[0] * b.beam * 0.8 + nb[0] * up * b.beam * 1.1, bow[1] - bd[1] * b.beam * 0.8 + nb[1] * up * b.beam * 1.1];
  const shape = [prow, ...hull, ...K.slice(1, 0, 4)];
  const out: Layer[] = [{ ink: 'boat', fill: [shape] }];
  // Planks and thwarts of the open hull.
  const lines: { pts: Pt[]; w: number }[] = [{ pts: rail, w: 2.2 }, { pts: deck, w: 1.4 }];
  for (let k = 1; k < 9; k++) {
    const t = k / 9, p = K.at(t), nr = K.normal(t), bw = beam(t);
    lines.push({ pts: [[p[0] + nr[0] * up * bw * 0.2, p[1] + nr[1] * up * bw * 0.2], [p[0] + nr[0] * up * bw * 0.72, p[1] + nr[1] * up * bw * 0.72]], w: 1.2 });
  }
  out.push({ ink: 'boatDark', line: lines });
  out.push({ ink: 'key', line: [{ pts: shape.concat([shape[0]]), w: 1.6 }] });
  // The crew, crouched in indigo with their heads down, oars raked into the sea.
  const backs: Pt[][] = [], heads: Pt[][] = [], hair: Pt[][] = [], oars: { pts: Pt[]; w: number }[] = [];
  for (let k = 0; k < b.rowers; k++) {
    const t = lerp(b.crew[0], b.crew[1], (k + 0.5) / b.rowers) + r.range(-0.01, 0.01);
    const p = K.at(t), nr = K.normal(t), d = K.dir(t), bw = beam(t), s = b.beam * r.range(0.42, 0.52);
    const cx = p[0] + nr[0] * up * bw * 0.85, cy = p[1] + nr[1] * up * bw * 0.85;
    backs.push(blob(cx, cy, s, r, 12).map(([x, y]) => [x, cy + (y - cy) * 0.8] as Pt));
    const hx = cx + nr[0] * up * s * 0.6 - d[0] * s * 0.5, hy = cy + nr[1] * up * s * 0.6 - d[1] * s * 0.5;
    heads.push(blob(hx, hy, s * 0.42, r, 10));
    hair.push(blob(hx + nr[0] * up * s * 0.12, hy + nr[1] * up * s * 0.12, s * 0.34, r, 10));
    const ox = p[0] - nr[0] * up * bw * 0.6, oy = p[1] - nr[1] * up * bw * 0.6;
    oars.push({ pts: [[cx, cy], [ox + d[0] * s * 2, oy + d[1] * s * 2]], w: 1.6 });
  }
  out.push({ ink: 'boatDark', line: oars }, { ink: 'cloth', fill: backs }, { ink: 'skin', fill: heads }, { ink: 'hair', fill: hair });
  out.push({ ink: 'key', line: backs.map((pts) => ({ pts: pts.concat([pts[0]]), w: 1 })) });
  return out;
}

function carveFuji(f: FujiSpec, r: Rng): Layer[] {
  const n = 24, left: Pt[] = [], right: Pt[] = [], top = f.base - f.h, wt = f.w * 0.09;
  for (let i = 0; i <= n; i++) {
    // Concave slopes: gentle at the foot, steepening to the summit.
    const u = i / n, y = f.base - f.h * Math.pow(u, 1.5), d = lerp(f.w, wt, u);
    left.push([f.x - d, y]);
    right.push([f.x + d, y]);
  }
  const summit: Pt[] = [[f.x - wt * 0.5, top + 1.5], [f.x - wt * 0.1, top - 1], [f.x + wt * 0.3, top + 1], [f.x + wt * 0.6, top - 0.5]];
  const outline = left.concat(summit, right.slice().reverse());
  // The snow reaches down the slopes in long, uneven tongues.
  const line = top + f.h * 0.42, teeth = 13, snow: Pt[] = [];
  const wAt = (y: number) => lerp(f.w, wt, Math.pow(clamp((f.base - y) / f.h, 0, 1), 1 / 1.5));
  for (let k = 0; k <= teeth; k++) {
    const t = k / teeth, y = k % 2 ? line + f.h * r.range(0.15, 0.4) * Math.sin(t * Math.PI + 0.3) : line - f.h * r.range(0, 0.06);
    const half = wAt(y);
    snow.push([f.x - half + t * half * 2, y]);
  }
  const cap = left.filter(([, y]) => y < line).concat(summit, right.filter(([, y]) => y < line).reverse());
  return [
    { ink: 'deep', fill: [outline] },
    { ink: 'snow', fill: [cap.concat(snow.slice().reverse())] },
    { ink: 'key', line: [{ pts: outline, w: 1.3 }] },
  ];
}

function carveSea(s: SeaSpec, r: Rng): Layer[] {
  const top = curve(s.top), poly = top.concat([[top[top.length - 1][0], s.bottom], [top[0][0], s.bottom]]);
  // Small crests in the far sea under Fuji.
  const tl = talons();
  const T = new Path(top);
  for (let i = 0; i < 9; i++) {
    const f = r.range(0.1, 0.95), p = T.at(f), sz = r.range(6, 10);
    talon(tl, r, p[0], p[1] + r.range(2, 14), -0.5, sz, sz * 0.5, 1, 2.2, 0);
  }
  return [{ ink: 'deep', fill: [poly] }, { ink: 'paper', fill: tl.body }, { ink: 'key', fill: tl.hook }];
}

// ------------------------------------------------------------ spray

const sprays = new WeakMap<World, Layer[]>();

/** Flecks of foam thrown off the crest, falling over the sky like snow. */
function sprayOf(world: World, comp: Composition): Layer[] {
  let l = sprays.get(world);
  if (l) return l;
  const r = new Rng(hash(world.s, 0x5f7)), dots: Pt[][] = [];
  for (const s of comp.spray) {
    const A = new Path(curve(s.a)), B = new Path(curve(s.b));
    for (let i = 0; i < s.n; i++) {
      const v = r.random(), u = Math.pow(r.random(), 0.8), a = A.at(v), b = B.at(v);
      dots.push(blob(lerp(a[0], b[0], u), lerp(a[1], b[1], u), r.range(1.6, 4.2), r, 8));
    }
  }
  l = [{ ink: 'key', fill: dots.map((d) => d.map(([x, y]) => [x, y + 0.8] as Pt)) }, { ink: 'paper', fill: dots }];
  sprays.set(world, l);
  return l;
}
