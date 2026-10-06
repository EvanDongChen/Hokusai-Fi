// The infinite sea. Space is split into vertical chunks; each chunk deterministically generates
// its own features from the seed and chunk index. Anything that needs to know about nearby
// features looks at neighbouring chunks, so a point always sees the same waves no matter which
// chunk is being printed.
//
// The first frame, x in [0, FRAME_W), follows the composition of Hokusai's "Under the Wave off
// Kanagawa" (see CLASSIC below): the great wave rearing up on the left, its claws of foam over
// three boats, a small wave in front echoing Fuji, and Fuji itself, small and snow-capped, far
// off in the trough. Each seed varies it: it may be mirrored, and it gets its own weather.
//
// Beyond the frame the sea runs on through regions borrowed from the rest of the Thirty-six
// Views: the Kanagawa sea of great waves, open swells with fishing boats, a calm bay under a
// large Fuji, a coast of pine-covered headlands, and rocky islets with pines and a shrine gate.

import { mix, hex, type RGB } from '../core/color';
import { clamp, lerp, smoothstep } from '../core/math';
import { hash, hashFloat, hashString, Rng } from '../core/rng';
import { surfaceAt, waveReach, waveShape, zOf, type Wave } from './wave';

export type { Wave } from './wave';

export const H = 1000;
export const CW = 740;
export const FRAME_W = 1480;
/** Where the sea meets the sky. */
export const HZ = 800;
/** How many chunks either side can reach into a point. */
const REACH = 2;

/** "Under the Wave off Kanagawa", as fractions of the frame width and height. */
const CLASSIC = {
  /** x: crest, base: foot, top: crest top, back/front in heights of the frame. */
  waves: [
    { x: 0.27, base: 1.05, top: 0.12, curl: 1, back: 0.98, front: 0.4, z: 0.6, foam: 1 },
    { x: 0.6, base: 1.04, top: 0.7, curl: 0.42, back: 0.16, front: 0.14, z: 0.86, foam: 0.75 },
    { x: 0.9, base: 0.94, top: 0.5, curl: 0.66, back: 0.32, front: 0.18, z: 0.42, foam: 0.85 },
    { x: 0.04, base: 1.12, top: 0.86, curl: 0.35, back: 0.3, front: 0.2, z: 0.93, foam: 0.5 },
    { x: 0.75, base: 0.86, top: 0.78, curl: 0.5, back: 0.12, front: 0.06, z: 0.3, foam: 0.6 },
  ],
  /** Boats: the centre of the waterline, length, tilt, and the depth they sit at among the waves. */
  boats: [
    { x: 0.2, y: 0.76, len: 0.26, angle: 0.3, z: 0.61, rowers: 8 },
    { x: 0.47, y: 0.825, len: 0.21, angle: -0.08, z: 0.61, rowers: 8 },
    { x: 0.81, y: 0.6, len: 0.19, angle: -0.34, z: 0.43, rowers: 7 },
  ],
  fuji: { x: 0.645, h: 0.1, w: 0.085 },
};

export type Biome = 'kanagawa' | 'swell' | 'fuji' | 'coast' | 'isles';
export type Mood = 'day' | 'dawn' | 'dusk' | 'night' | 'storm' | 'snow';

/** The colour blocks of a print. Each weather recuts them. */
export interface Tint {
  skyTop: RGB; sky: RGB; skyLow: RGB; cloud: RGB;
  seaFar: RGB; sea: RGB; seaNear: RGB; deep: RGB; band: RGB; key: RGB; foam: RGB;
  fuji: RGB; fujiLow: RGB; snow: RGB; land: RGB; pine: RGB; rock: RGB;
}

const tint = (o: Record<keyof Tint, string>): Tint => {
  const out = {} as Record<keyof Tint, RGB>;
  for (const k in o) out[k as keyof Tint] = hex(o[k as keyof Tint]);
  return out;
};

export const TINTS: Record<Mood, Tint> = {
  day: tint({
    skyTop: '#6f675c', sky: '#e2d3b0', skyLow: '#ece0c2', cloud: '#cbbb98',
    seaFar: '#a9bcbe', sea: '#7096b6', seaNear: '#4a73a2', deep: '#1f3d6c', band: '#93b4cc', key: '#19305a', foam: '#f3ebd6',
    fuji: '#7a95b0', fujiLow: '#bcc7c9', snow: '#f5efe0', land: '#6f8a76', pine: '#2d4a3a', rock: '#8a7f6e',
  }),
  dawn: tint({
    skyTop: '#c4837f', sky: '#f0d8c2', skyLow: '#f6e6ce', cloud: '#e7b9a6',
    seaFar: '#b9c6c8', sea: '#7b9dbd', seaNear: '#5580ae', deep: '#2a4a78', band: '#a4c0d4', key: '#22395e', foam: '#f7efdd',
    fuji: '#9a8eb0', fujiLow: '#dbc6c2', snow: '#fbf2e6', land: '#8a8b80', pine: '#3d4e44', rock: '#a08a7c',
  }),
  dusk: tint({
    skyTop: '#2b3e72', sky: '#e8b47c', skyLow: '#f2d39c', cloud: '#f3e3c2',
    seaFar: '#8c9fb4', sea: '#4f6f9a', seaNear: '#36578a', deep: '#1a3058', band: '#7f9cc0', key: '#172848', foam: '#f2e6cc',
    fuji: '#b6442c', fujiLow: '#d97a4a', snow: '#f6eadb', land: '#5b5c5c', pine: '#253a30', rock: '#6e5a4c',
  }),
  night: tint({
    skyTop: '#0e1630', sky: '#24345a', skyLow: '#3b4a6c', cloud: '#34446a',
    seaFar: '#34496e', sea: '#253b62', seaNear: '#1b2e54', deep: '#0e1c3c', band: '#4e6c96', key: '#0a142c', foam: '#d9dccd',
    fuji: '#3c4e72', fujiLow: '#56688a', snow: '#c9cfd2', land: '#23304a', pine: '#152230', rock: '#3a4458',
  }),
  storm: tint({
    skyTop: '#3c3d42', sky: '#8f908a', skyLow: '#aaa9a0', cloud: '#686968',
    seaFar: '#71848f', sea: '#4c6680', seaNear: '#3a5470', deep: '#1b2d46', band: '#8098ab', key: '#162336', foam: '#e8e6dc',
    fuji: '#5f6e7c', fujiLow: '#8c96a0', snow: '#e2e2dc', land: '#4e5a56', pine: '#24342e', rock: '#5a564e',
  }),
  snow: tint({
    skyTop: '#86898f', sky: '#d6d5cf', skyLow: '#e3e1da', cloud: '#bdbfbc',
    seaFar: '#9aaebb', sea: '#6c8aa6', seaNear: '#4f6f92', deep: '#24406a', band: '#9ab4c8', key: '#1e3050', foam: '#f8f6ef',
    fuji: '#a9b6c4', fujiLow: '#dfe3e6', snow: '#fbfaf5', land: '#e6e4dc', pine: '#3a4a44', rock: '#9a958c',
  }),
};

export const MOOD_NAMES: Record<Mood, string> = {
  day: 'Clear day', dawn: 'Dawn', dusk: 'Red evening', night: 'Moonlit night', storm: 'Squall', snow: 'Snowfall',
};
export const BIOME_NAMES: Record<Biome, string> = {
  kanagawa: 'The sea off Kanagawa', swell: 'Open swells and fishing boats', fuji: 'A calm bay under Fuji',
  coast: 'A coast of pine headlands', isles: 'Rocky islets and a shrine gate',
};

/** A fishing boat (oshiokuri-bune), rowed by a crew crouched low over their oars. */
export interface Boat { id: number; x: number; y: number; len: number; angle: number; z: number; rowers: number; dir: 1 | -1; }
export interface Peak { id: number; x: number; h: number; w: number; fuji: boolean; }
export interface Headland { id: number; x: number; w: number; h: number; pines: number; }
export interface Isle { id: number; x: number; base: number; w: number; h: number; z: number; pines: number; torii: boolean; }
export interface Sail { id: number; x: number; y: number; size: number; dir: 1 | -1; }
/** The sun or moon, one per region whose weather has one. */
export interface Orb { id: number; x: number; y: number; r: number; kind: 'sun' | 'moon'; }

interface Features {
  waves: Wave[]; boats: Boat[]; peaks: Peak[]; heads: Headland[]; isles: Isle[]; sails: Sail[];
}
export type Nearby = Features;

const empty = (): Features => ({ waves: [], boats: [], peaks: [], heads: [], isles: [], sails: [] });

/** Regions are a few screens wide; region 0 holds the classic frame. */
const REGION = 2960;
const REGION0 = -740;
const BLEND = 700;
const BIOMES: readonly [Biome, number][] = [['kanagawa', 0.3], ['swell', 0.22], ['fuji', 0.16], ['coast', 0.16], ['isles', 0.16]];
const MOODS: readonly [Mood, number][] = [['day', 0.34], ['dawn', 0.14], ['dusk', 0.16], ['night', 0.14], ['storm', 0.11], ['snow', 0.11]];

function weighted<T>(r: Rng, table: readonly [T, number][]): T {
  let v = r.random();
  for (const [k, w] of table) if ((v -= w) < 0) return k;
  return table[0][0];
}

export class World {
  readonly seed: string;
  readonly s: number;
  readonly flipped: boolean;
  readonly dir: 1 | -1;
  /** Weather of the gallery print. */
  readonly mood: Mood;
  private chunks = new Map<number, Features>();
  private tintCache = new Map<number, Tint>();

  constructor(seed: string) {
    this.seed = seed;
    this.s = hashString(seed);
    const r = new Rng(hash(this.s, 1));
    this.flipped = r.chance(0.22);
    this.dir = this.flipped ? -1 : 1;
    this.mood = r.chance(0.42) ? 'day' : weighted(r, MOODS);
  }

  static chunkOf(x: number) { return Math.floor(x / CW); }

  // ------------------------------------------------------------ regions

  private regionOf(x: number) { return Math.floor((x - REGION0) / REGION); }

  biomeOfRegion(k: number): Biome {
    if (k === 0) return 'kanagawa';
    const r = new Rng(hash(this.s, 2, k));
    let b = weighted(r, BIOMES);
    // Don't repeat a region back to back.
    if (b === this.biomeOfRegion0(k - 1)) b = weighted(r, BIOMES);
    return b;
  }

  private biomeOfRegion0(k: number): Biome {
    return k === 0 ? 'kanagawa' : weighted(new Rng(hash(this.s, 2, k)), BIOMES);
  }

  moodOfRegion(k: number): Mood {
    if (k === 0) return this.mood;
    return weighted(new Rng(hash(this.s, 3, k)), MOODS);
  }

  /** Two regions and how far x is into the second, for blending across a boundary. */
  private blendAt(x: number): [number, number, number] {
    const k = this.regionOf(x), start = REGION0 + k * REGION, into = x - start;
    if (into < BLEND / 2) return [k - 1, k, smoothstep(-BLEND / 2, BLEND / 2, into)];
    if (into > REGION - BLEND / 2) return [k, k + 1, smoothstep(REGION - BLEND / 2, REGION + BLEND / 2, into)];
    return [k, k, 0];
  }

  biomeAt(x: number): Biome { return this.biomeOfRegion(this.regionOf(x)); }
  moodAt(x: number): Mood {
    const [a, b, t] = this.blendAt(x);
    return this.moodOfRegion(t < 0.5 ? a : b);
  }

  biomeWeights(x: number): Record<Biome, number> {
    const out: Record<Biome, number> = { kanagawa: 0, swell: 0, fuji: 0, coast: 0, isles: 0 };
    const [a, b, t] = this.blendAt(x);
    out[this.biomeOfRegion(a)] += 1 - t;
    out[this.biomeOfRegion(b)] += t;
    return out;
  }

  moodWeight(x: number, m: Mood): number {
    const [a, b, t] = this.blendAt(x);
    return (this.moodOfRegion(a) === m ? 1 - t : 0) + (this.moodOfRegion(b) === m ? t : 0);
  }

  /** The print's colour blocks at x, blended across region boundaries. Quantised so it can be cached. */
  tintAt(x: number): Tint {
    const q = Math.round(x / 8);
    let t = this.tintCache.get(q);
    if (t) return t;
    if (this.tintCache.size > 4000) this.tintCache.clear();
    const [a, b, f] = this.blendAt(q * 8);
    const A = TINTS[this.moodOfRegion(a)], B = TINTS[this.moodOfRegion(b)];
    if (f <= 0 || A === B) t = A;
    else {
      const o = {} as Record<keyof Tint, RGB>;
      for (const k in A) o[k as keyof Tint] = mix(A[k as keyof Tint], B[k as keyof Tint], f);
      t = o;
    }
    this.tintCache.set(q, t);
    return t;
  }

  /** The sun or moon of the regions around x. */
  orbsNear(x0: number, x1: number): Orb[] {
    const out: Orb[] = [];
    for (let k = this.regionOf(x0) - 1; k <= this.regionOf(x1) + 1; k++) {
      const m = this.moodOfRegion(k);
      if (m !== 'dawn' && m !== 'dusk' && m !== 'night') continue;
      const r = new Rng(hash(this.s, 4, k));
      let x = REGION0 + k * REGION + r.range(0.3, 0.7) * REGION, y = H * r.range(0.13, 0.3);
      if (k === 0) { x = this.fx(r.range(0.72, 0.9) * FRAME_W); y = H * r.range(0.14, 0.24); }
      const kind = m === 'night' ? 'moon' : 'sun';
      out.push({ id: hash(this.s, 5, k), x, y: m === 'dawn' ? y + H * 0.16 : y, r: (kind === 'moon' ? 32 : 40) * r.range(0.85, 1.2), kind });
    }
    return out;
  }

  // ------------------------------------------------------------ features

  /** Mirror an x inside the classic frame. */
  private fx(x: number) { return this.flipped ? FRAME_W - x : x; }

  /** Features whose chunk is within REACH of c: everything that could touch chunk c. */
  near(c: number): Nearby {
    const out = empty();
    for (let k = c - REACH; k <= c + REACH; k++) {
      const f = this.features(k);
      out.waves.push(...f.waves);
      out.boats.push(...f.boats);
      out.peaks.push(...f.peaks);
      out.heads.push(...f.heads);
      out.isles.push(...f.isles);
      out.sails.push(...f.sails);
    }
    return out;
  }

  features(c: number): Features {
    let f = this.chunks.get(c);
    if (!f) {
      f = c === 0 || c === 1 ? this.classic(c) : this.generate(c);
      this.chunks.set(c, f);
    }
    return f;
  }

  /** Forget chunks far from c. */
  prune(c: number) {
    for (const k of this.chunks.keys()) if (Math.abs(k - c) > REACH + 6) this.chunks.delete(k);
  }

  private classicWaves(): Wave[] {
    return CLASSIC.waves.map((cw, i) => {
      const j = new Rng(hash(this.s, 7, i));
      const top = cw.top + j.range(-0.015, 0.015) * (i === 0 ? 1 : 0.5);
      return {
        id: hash(this.s, 8, i), x: this.fx(cw.x * FRAME_W) + j.range(-8, 8), base: cw.base * H, h: (cw.base - top) * H, z: cw.z,
        dir: this.dir, curl: clamp(cw.curl + j.range(-0.04, 0.03), 0, 1), back: cw.back * H, front: cw.front * H, foam: cw.foam,
      };
    });
  }

  /** A boat riding wave w at x, sitting a little down in the water. */
  private boatOn(w: Wave, x: number, len: number, id: number, rowers: number): Boat | null {
    const at = surfaceAt(waveShape(w), w, x);
    if (!at) return null;
    return { id, x, y: at.y + len * 0.04, len, angle: clamp(at.angle * 0.85, -0.6, 0.6), z: w.z + 0.001, rowers, dir: this.dir };
  }

  private classic(c: number): Features {
    const f = empty(), r = new Rng(hash(this.s, 6));
    const inChunk = (x: number) => World.chunkOf(x) === c;
    const waves = this.classicWaves();
    for (const w of waves) if (inChunk(w.x)) f.waves.push(w);
    const nBoats = r.chance(0.8) ? 3 : 2;
    CLASSIC.boats.slice(0, nBoats).forEach((b, i) => {
      const x = this.fx(b.x * FRAME_W);
      if (!inChunk(x)) return;
      f.boats.push({ id: hash(this.s, 9, i), x, y: b.y * H, len: b.len * FRAME_W, angle: b.angle * this.dir, z: b.z, rowers: b.rowers, dir: this.dir });
    });
    const fj = CLASSIC.fuji, fx = this.fx(fj.x * FRAME_W);
    if (inChunk(fx)) f.peaks.push({ id: hash(this.s, 10), x: fx, h: fj.h * H * r.range(0.92, 1.08), w: fj.w * FRAME_W, fuji: true });
    return f;
  }

  /** Whether a great wave wants to rise in chunk c, before checking its neighbours. */
  private greatRaw(c: number): boolean {
    if (c >= -1 && c <= 2) return false;
    const b = this.biomeAt(c * CW + CW / 2), m = this.moodAt(c * CW + CW / 2);
    const p = { kanagawa: 0.8, swell: 0.3, fuji: 0.08, coast: 0.12, isles: 0.12 }[b] + (m === 'storm' ? 0.2 : 0);
    return hashFloat(this.s, 11, c) < p;
  }

  private generate(c: number): Features {
    const f = empty(), x0 = c * CW, mid = x0 + CW / 2;
    const biome = this.biomeAt(mid), mood = this.moodAt(mid), r = new Rng(hash(this.s, 12, c));
    const rough = { kanagawa: 1, swell: 0.75, fuji: 0.35, coast: 0.45, isles: 0.55 }[biome] + (mood === 'storm' ? 0.25 : 0);
    const dir = this.dir;
    let n = 0;
    const id = () => hash(this.s, 13, c, n++);

    if (this.greatRaw(c) && !this.greatRaw(c - 1)) {
      const h = H * r.range(0.62, 0.88);
      f.waves.push({
        id: id(), x: x0 + r.range(0.2, 0.8) * CW, base: H * r.range(1.03, 1.08), h, z: 0,
        dir, curl: r.range(0.88, 1), back: h * r.range(1.0, 1.25), front: h * r.range(0.38, 0.5), foam: 1,
      });
    }

    // Middle distance: swells and curling crests.
    const mids = Math.round(r.range(0.6, 1.6) + rough * r.range(0.8, 2));
    for (let i = 0; i < mids; i++) {
      const d = r.random(), h = H * lerp(0.08, 0.36, Math.pow(r.random(), 1.3)) * lerp(0.55, 1, rough) * lerp(0.6, 1.1, d);
      f.waves.push({
        id: id(), x: x0 + r.random() * CW, base: H * lerp(0.85, 0.99, d), h, z: 0,
        dir, curl: clamp(r.range(0.2, 0.75) + rough * 0.2, 0, 1), back: h * r.range(1.3, 2.4), front: h * r.range(0.55, 1), foam: r.range(0.45, 0.9),
      });
    }

    // Foreground swells along the bottom edge.
    if (r.chance(0.35 + rough * 0.3)) {
      const h = H * r.range(0.1, 0.26) * lerp(0.7, 1, rough);
      f.waves.push({
        id: id(), x: x0 + r.random() * CW, base: H * r.range(1.06, 1.12), h, z: 0,
        dir, curl: r.range(0.2, 0.6), back: h * r.range(1.4, 2.4), front: h * r.range(0.6, 1), foam: r.range(0.4, 0.8),
      });
    }

    // Nearer water prints over farther: depth follows where each wave's foot meets the sea.
    for (const w of f.waves) w.z = zOf(w.base) + hashFloat(w.id, 1) * 1e-3;

    // Boats ride the lower backs of the bigger waves, the crew bent to their oars.
    if (biome === 'kanagawa' || biome === 'swell' || r.chance(0.2)) {
      for (const w of f.waves) {
        if (w.h < 170 || w.z > 0.85 || !r.chance(biome === 'swell' ? 0.75 : 0.55)) continue;
        const s = waveShape(w), p = s.top[Math.max(1, Math.floor(r.range(0.12, 0.32) * s.lipAt))];
        const boat = this.boatOn(w, p[0], clamp(w.h * r.range(0.4, 0.55), 80, 250), id(), r.int(6, 9));
        if (boat) f.boats.push(boat);
      }
    }

    // Fuji: once a region, large in the bay, a small far cone elsewhere.
    const k = this.regionOf(mid), center = REGION0 + k * REGION + REGION / 2;
    if (World.chunkOf(center + (hashFloat(this.s, 14, k) - 0.5) * REGION * 0.4) === c) {
      const big = biome === 'fuji';
      if (big || hashFloat(this.s, 15, k) < 0.45) {
        const h = H * (big ? r.range(0.2, 0.34) : r.range(0.07, 0.12));
        f.peaks.push({ id: id(), x: x0 + r.range(0.3, 0.7) * CW, h, w: h * r.range(1.45, 1.75), fuji: true });
      }
    }
    if (biome === 'fuji' || biome === 'coast') {
      const hills = r.int(0, 2);
      for (let i = 0; i < hills; i++) {
        const h = H * r.range(0.02, 0.05);
        f.peaks.push({ id: id(), x: x0 + r.random() * CW, h, w: h * r.range(3, 6), fuji: false });
      }
    }

    if (biome === 'coast' || (biome === 'fuji' && r.chance(0.4))) {
      const m = r.int(1, 2);
      for (let i = 0; i < m; i++) {
        const w = r.range(220, 560);
        f.heads.push({ id: id(), x: x0 + r.random() * CW, w, h: r.range(28, 80), pines: Math.round(w / r.range(45, 80)) });
      }
    }

    if (biome === 'isles' || r.chance(0.08)) {
      const m = biome === 'isles' ? r.int(1, 2) : 1;
      for (let i = 0; i < m; i++) {
        const d = r.range(0.18, 0.6), sz = lerp(0.6, 1.5, d), base = lerp(HZ + 10, H * 0.95, d);
        f.isles.push({
          id: id(), x: x0 + r.random() * CW, base, w: r.range(60, 140) * sz, h: r.range(90, 200) * sz,
          z: zOf(base) - 0.0005, pines: r.int(1, 4), torii: biome === 'isles' && r.chance(0.5),
        });
      }
    }

    if (biome !== 'kanagawa' || r.chance(0.3)) {
      const m = r.int(0, biome === 'swell' || biome === 'coast' ? 3 : 1);
      for (let i = 0; i < m; i++) {
        f.sails.push({ id: id(), x: x0 + r.random() * CW, y: HZ + r.range(2, 22), size: r.range(10, 24), dir: r.chance(0.5) ? 1 : -1 });
      }
    }
    return f;
  }

  /** Horizontal reach of any wave, so planners can skip ones that can't touch them. */
  static reach = waveReach;
}
