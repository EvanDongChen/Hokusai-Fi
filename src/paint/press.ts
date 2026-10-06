// The press. A chunk is not painted straight onto the sheet: it is cut into two blocks, then
// pulled onto washi the way an impression is.
//
//  - The colour plate holds every colour block, laid in depth order as before, so nearer water
//    still covers farther water.
//  - The key plate holds the key block's Prussian-blue lines. Whatever is laid in colour over a
//    line carves it away, as the carver would have, so a near wave hides a far wave's outline.
//
// Pulling turns each plate into ink: its colour becomes a density of pigment, which the wood
// grain, the baren's uneven rubbing, the paper's fibres and the pooling of ink at the edges of a
// block all modulate, and is then pressed subtractively into the sheet. The key block sits a
// fraction out of register with the colour blocks, as in any real impression.
//
// Everything is anchored to world coordinates (noise, fibres, misregistration), so chunks pulled
// separately still meet without a seam.

import { clamp } from '../core/math';
import { Noise } from '../core/noise';
import { hash, Rng } from '../core/rng';
import { KEY_BLOCK, type Ctx } from '../core/print';
import { context2d, makeCanvas, type AnyCanvas } from './canvas';

/** How worn and handmade the impression looks. */
export interface Wear {
  /** Wood grain in the flat colour fields. */
  grain: number;
  /** Low, cloudy unevenness left by the baren. */
  mottle: number;
  /** Specks where the paper's tooth took no ink. */
  speckle: number;
  /** Extra pigment pooled just inside the edges of a block. */
  pool: number;
  /** How far the ink has faded into the paper (0: fresh). */
  fade: number;
  /** Yellowing of the sheet and its foxing. */
  age: number;
  /** How far the key block sits out of register, in world px. */
  misreg: number;
}

export const MUSEUM: Wear = { grain: 0.28, mottle: 0.16, speckle: 0.12, pool: 0.55, fade: 0.1, age: 0.5, misreg: 0.9 };

/** The washi the print is pulled onto. */
const SHEET = [247, 241, 222] as const;

/** Margin around a chunk the plates cover, in world px, so blurs and offsets see past its edge. */
const MARGIN = 8;

const BOTH = new Set(['beginPath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'closePath', 'quadraticCurveTo', 'bezierCurveTo', 'save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'clip', 'setLineDash', 'clearRect']);
const DRAW = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'drawImage', 'fillText', 'strokeText']);

export class Press {
  readonly colour: AnyCanvas;
  readonly key: AnyCanvas;
  /** The context ops draw on: it lays into both plates (see the top of this file). */
  readonly ctx: Ctx;
  private c: Ctx;
  private k: Ctx;
  private inKey = false;
  private keyInked = false;
  private mx: number;
  private readonly kdx: number;
  private readonly kdy: number;

  /**
   * Plates for chunk pixels `w` x `h` at `scale`, the chunk starting at world x `x0`.
   * `seed` places the key block's misregistration, the same across the world.
   */
  constructor(readonly w: number, readonly h: number, readonly scale: number, readonly x0: number, readonly seed: number, readonly wear: Wear = MUSEUM) {
    this.mx = Math.ceil(MARGIN * scale);
    this.colour = makeCanvas(w + this.mx * 2, h);
    this.key = makeCanvas(w + this.mx * 2, h);
    this.c = context2d(this.colour);
    this.k = context2d(this.key);
    const r = new Rng(hash(seed, 0x4e9)), a = r.range(0, Math.PI * 2), d = wear.misreg * r.range(0.6, 1);
    this.kdx = Math.cos(a) * d;
    this.kdy = Math.sin(a) * d;
    this.c.setTransform(scale, 0, 0, scale, this.mx - x0 * scale, 0);
    this.k.setTransform(scale, 0, 0, scale, this.mx - (x0 - this.kdx) * scale, this.kdy * scale);
    this.ctx = this.dual();
  }

  /** Run `draw` with the dual context's drawing going to the key block instead. */
  keyBlock(draw: () => void) {
    const was = this.inKey;
    this.inKey = true;
    try { draw(); } finally { this.inKey = was; }
  }

  private dual(): Ctx {
    const c = this.c as unknown as Record<string | symbol, unknown>, k = this.k as unknown as Record<string | symbol, unknown>;
    const cache = new Map<string | symbol, unknown>();
    const press = this, keyBlock = (draw: () => void) => press.keyBlock(draw);
    return new Proxy(c, {
      get(_, prop) {
        if (prop === KEY_BLOCK) return keyBlock;
        const v = c[prop];
        if (typeof v !== 'function') return v;
        let f = cache.get(prop);
        if (f) return f;
        const fc = v as (...a: unknown[]) => unknown, fk = k[prop] as (...a: unknown[]) => unknown;
        if (BOTH.has(prop as string)) {
          f = (...a: unknown[]) => { fk.apply(k, a); return fc.apply(c, a); };
        } else if (DRAW.has(prop as string)) {
          f = (...a: unknown[]) => {
            if (press.inKey) { press.keyInked = true; return fk.apply(k, a); }
            const r = fc.apply(c, a);
            // A colour laid over a line carves it away; overlays that blend (multiply, etc) do not.
            // Until the key block has a line on it there is nothing to carve.
            if (press.keyInked && c.globalCompositeOperation === 'source-over') {
              k.globalCompositeOperation = 'destination-out';
              fk.apply(k, a);
              k.globalCompositeOperation = 'source-over';
            }
            return r;
          };
        } else f = fc.bind(c);
        cache.set(prop, f);
        return f;
      },
      set(_, prop, v) {
        c[prop] = v;
        if (prop !== 'globalCompositeOperation') k[prop] = v;
        return true;
      },
    }) as unknown as Ctx;
  }

  /** A quick look at the plates as they are being cut, before the pull. */
  preview(out: Ctx) {
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.drawImage(this.colour as CanvasImageSource, -this.mx, 0);
    out.drawImage(this.key as CanvasImageSource, -this.mx, 0);
  }

  /** Pull the impression: both plates pressed into the sheet, written to `out` (chunk pixels). */
  pull(out: Ctx) {
    const { w, h, mx, scale: s, wear } = this, W = w + mx * 2;
    const C = this.c.getImageData(0, 0, W, h).data, K = this.k.getImageData(0, 0, W, h).data;
    const noise = sharedNoise(this.seed), fib = fibres();

    // Optical density of the colour plate against the sheet, per channel, and its mean.
    const n = W * h, dr = new Float32Array(n), dg = new Float32Array(n), db = new Float32Array(n), dm = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = DR[C[j]], g = DG[C[j + 1]], b = DB[C[j + 2]];
      dr[i] = r; dg[i] = g; db[i] = b; dm[i] = (r + g + b) / 3;
    }
    // Pigment pools just inside the edge of a block: wherever the field is denser than its
    // surroundings, it gains a little more.
    const blur = boxBlur(dm, W, h, Math.max(1, Math.round(2.5 * s)));

    const img = out.createImageData(w, h), o = img.data;
    const gx0 = this.x0 * s;
    // Grain and mottle vary slowly across, so they are sampled every few pixels along a row.
    const STEP = 4, cols = Math.ceil(w / STEP) + 2, grainRow = new Float32Array(cols), mottleRow = new Float32Array(cols), clumpRow = new Float32Array(cols), bendRow = new Float32Array(cols);
    for (let y = 0; y < h; y++) {
      const wy = y / s;
      // The slow parts (mottle, patches, the bend of the grain) change little from row to row.
      const slow = (y & 3) === 0;
      for (let k = 0; k < cols; k++) {
        const wx = (gx0 + k * STEP) / s;
        if (slow) {
          // The grain meanders, bending round knots, so it never runs in straight rows.
          bendRow[k] = 40 * noise.noise2(wx * 0.0021 + 5, wy * 0.0035) + 9 * noise.noise2(wx * 0.009, wy * 0.012 + 3);
          mottleRow[k] = noise.fbm(wx * 0.011 + 77, wy * 0.011, 3);
          // Where the sheet's tooth missed the ink, it did so in patches.
          clumpRow[k] = Math.max(0, noise.noise2(wx * 0.045 + 13, wy * 0.06));
        }
        // Long fibres of the cherry plank run across the sheet, a few of them sharp dark rings.
        const gy = wy + bendRow[k], ring = noise.noise2(wx * 0.0015 + 31, gy * 0.3);
        grainRow[k] = noise.fbm(wx * 0.005, gy * 0.11, 2) * 0.6 + Math.sign(ring) * Math.pow(Math.abs(ring), 0.8) * 0.35;
      }
      for (let x = 0; x < w; x++) {
        const i = y * W + x + mx, oi = (y * w + x) * 4;
        const gx = Math.round(gx0) + x, wx = gx / s;
        const kf = x / STEP, k0 = kf | 0, kt = kf - k0;
        const grain = grainRow[k0] + (grainRow[k0 + 1] - grainRow[k0]) * kt;
        const mottle = mottleRow[k0] + (mottleRow[k0 + 1] - mottleRow[k0]) * kt;
        const clump = clumpRow[k0] + (clumpRow[k0 + 1] - clumpRow[k0]) * kt;
        // The sheet's own fibres take ink a little more or less readily.
        const fb = fib[((wy | 0) & 255) * 256 + ((wx | 0) & 255)];
        const speck = white(gx, y, this.seed) < wear.speckle * clump * (1 + 2 * Math.max(0, fb)) ? 0.7 : 1;

        // The colour blocks.
        const d = dm[i];
        const pool = 1 + wear.pool * Math.max(0, d - blur[i]) / (d + 0.08);
        // Grain shows most in mid-toned fields; in the darkest the ink fills it.
        const field = clamp(d * 1.4, 0, 1) / (1 + d * 0.8);
        const m = (1 + wear.grain * grain * field + wear.mottle * mottle * field - 0.18 * fb) * pool * speck * (1 - wear.fade);
        let r = dr[i] * m, g = dg[i] * m, b = db[i] * m;

        // The key block: crisp, but starved here and there along its lines.
        const ka = K[i * 4 + 3] / 255;
        if (ka > 0.004) {
          const km = ka * (1 - 0.22 * Math.max(0, grain) - 0.12 * fb) * (speck < 1 ? 0.7 : 1) * (1 - wear.fade * 0.5);
          r += DR[K[i * 4]] * km;
          g += DG[K[i * 4 + 1]] * km;
          b += DB[K[i * 4 + 2]] * km;
        }

        // The sheet: washi fibres, yellowed with age.
        const paper = 1 + fb * 0.035, yel = wear.age * (0.04 + 0.03 * mottle);
        o[oi] = SHEET[0] * paper * ex(r);
        o[oi + 1] = SHEET[1] * paper * (1 - yel * 0.4) * ex(g);
        o[oi + 2] = SHEET[2] * paper * (1 - yel) * ex(b);
        o[oi + 3] = 255;
      }
    }
    out.putImageData(img, 0, 0);
  }
}

/** Optical density of a channel value against the sheet's. */
const dens = (v: number, sheet: number) => (v >= sheet ? 0 : -Math.log(Math.max(v, 2) / sheet));
/** The same, looked up for every channel value of each channel of the sheet. */
const densLut = (sheet: number) => Float32Array.from({ length: 256 }, (_, v) => dens(v, sheet));
const DR = densLut(SHEET[0]), DG = densLut(SHEET[1]), DB = densLut(SHEET[2]);

/** exp(-d) for densities 0..12, looked up and interpolated. */
const EXP_N = 2048, EXP_MAX = 12;
const EXP = Float32Array.from({ length: EXP_N + 2 }, (_, i) => Math.exp(-(i / EXP_N) * EXP_MAX));
const ex = (d: number) => {
  if (d <= 0) return 1;
  const u = Math.min(EXP_N, (d / EXP_MAX) * EXP_N), i = u | 0;
  return EXP[i] + (EXP[i + 1] - EXP[i]) * (u - i);
};

/** A uniform value in [0, 1) for each pixel of the world. */
const white = (x: number, y: number, seed: number) => {
  let h = Math.imul(x ^ Math.imul(y, 0x27d4eb2d) ^ seed, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

let noiseFor: { seed: number; noise: Noise } | null = null;
function sharedNoise(seed: number): Noise {
  if (noiseFor?.seed !== seed) noiseFor = { seed, noise: new Noise(new Rng(hash(seed, 0x9e55))) };
  return noiseFor.noise;
}

/** Separable box blur, run twice (close to a gaussian). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const a = new Float32Array(src), b = new Float32Array(src.length), inv = 1 / (r * 2 + 1);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * inv;
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * inv;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

let fibreMap: Float32Array | null = null;

/**
 * Washi, as a 256 x 256 world-px tile of how much each point stands out from the sheet: faint
 * mottling, and long pale and dark fibres. Anchored to world coordinates so it tiles across chunks.
 */
function fibres(): Float32Array {
  if (fibreMap) return fibreMap;
  const S = 256, rng = new Rng(9182), tile = makeCanvas(S, S), tc = context2d(tile);
  tc.fillStyle = 'rgb(128,128,128)';
  tc.fillRect(0, 0, S, S);
  tc.lineCap = 'round';
  for (let k = 0; k < 260; k++) {
    const x = rng.random() * S, y = rng.random() * S, a = rng.random() * Math.PI * 2, l = rng.range(6, 30);
    tc.strokeStyle = rng.chance(0.45) ? 'rgba(40,40,40,0.25)' : 'rgba(255,255,255,0.55)';
    tc.lineWidth = rng.range(0.4, 1.2);
    // Draw each fibre at every wrap so the tile repeats seamlessly.
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      tc.beginPath();
      tc.moveTo(x + ox, y + oy);
      tc.quadraticCurveTo(x + ox + Math.cos(a + 0.6) * l * 0.5, y + oy + Math.sin(a + 0.6) * l * 0.5, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
      tc.stroke();
    }
  }
  const d = tc.getImageData(0, 0, S, S).data, out = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) out[i] = (d[i * 4] - 128) / 128 + (rng.random() - 0.5) * 0.3;
  return (fibreMap = out);
}
