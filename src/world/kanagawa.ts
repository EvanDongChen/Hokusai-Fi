// The print itself, as its blocks. The traced inks (see kanagawa.data.ts) are decoded once, then
// each edition takes them through its own small changes: edition 1831 prints them exactly as cut;
// every other edition warps them with a gentle seeded swell, may mirror the composition (moving the
// cartouche across rather than reversing its writing), and recuts the colours for its weather.

import { hex, mix, type RGB } from '../core/color';
import { Noise } from '../core/noise';
import { hash, Rng } from '../core/rng';
import { BLOCKS, INSCRIPTION, Q, SKY, SKY_H, SKY_W } from './kanagawa.data';
import { FRAME_W, H, TINTS, type Tint, type World } from './world';

export type BlockName = 'paper' | 'white' | 'aqua' | 'boat' | 'shade' | 'blue' | 'slate' | 'indigo' | 'label' | 'inscription';

export interface PrintBlock {
  name: BlockName;
  color: RGB;
  /** Closed rings in world coordinates, as flat x, y runs. */
  rings: Float32Array[];
}

/** What each ink is called at the printer's bench, and the colour it takes in other weathers. */
export const INKS: Record<BlockName, { jp: string; en: string; tint: (t: Tint) => RGB }> = {
  paper: { jp: '鳥の子', en: 'paper', tint: (t) => mix(t.foam, t.sky, 0.3) },
  white: { jp: '胡粉', en: 'shell white', tint: (t) => t.foam },
  aqua: { jp: '浅葱', en: 'pale indigo', tint: (t) => t.band },
  boat: { jp: '黄土', en: 'ochre', tint: (t) => mix([228, 199, 165], t.sky, 0.3) },
  shade: { jp: '薄墨', en: 'pale ink', tint: (t) => mix(t.skyLow, t.key, 0.3) },
  blue: { jp: '藍', en: 'Prussian blue', tint: (t) => t.seaNear },
  slate: { jp: '鼠', en: 'grey', tint: (t) => mix(t.key, t.sea, 0.45) },
  indigo: { jp: '紺', en: 'deep indigo', tint: (t) => t.deep },
  label: { jp: '短冊', en: 'cartouche', tint: (t) => mix(t.foam, t.sky, 0.2) },
  inscription: { jp: '墨', en: 'inscription', tint: (t) => t.key },
};

/** The edition that prints the blocks exactly as Hokusai's printer cut them. */
export const ORIGINAL = '1831';

let decoded: { name: BlockName; color: RGB; rings: Float32Array[] }[] | null = null;

function bytes(b64: string): Uint8Array {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function decode() {
  if (decoded) return decoded;
  decoded = BLOCKS.map((b) => {
    const d = bytes(b.data), rings: Float32Array[] = [];
    let i = 0;
    const get = () => {
      let v = 0, shift = 0, c: number;
      do { c = d[i++]; v += (c & 127) * 2 ** shift; shift += 7; } while (c & 128);
      return v % 2 ? -(v + 1) / 2 : v / 2;
    };
    let x = 0, y = 0;
    while (i < d.length) {
      const n = get(), r = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) { x += get(); y += get(); r[k * 2] = x / Q; r[k * 2 + 1] = y / Q; }
      rings.push(r);
    }
    return { name: b.name as BlockName, color: hex(b.color), rings };
  });
  return decoded;
}

let skyImage: Promise<ImageBitmap> | null = null;

/** The sky, a small image to be drawn stretched over the frame. Decoded once, in a worker or on the page. */
export function loadSky(): Promise<ImageBitmap> {
  return (skyImage ??= createImageBitmap(new Blob([bytes(SKY) as BlobPart], { type: 'image/jpeg' })));
}

export const SKY_SIZE = { w: SKY_W, h: SKY_H };

const editions = new WeakMap<World, PrintBlock[]>();

/** This edition's blocks: warped, mirrored and coloured for its seed and weather. */
export function printBlocks(world: World): PrintBlock[] {
  let out = editions.get(world);
  if (out) return out;
  const r = new Rng(hash(world.s, 0x9e7)), noise = new Noise(r);
  const amp = world.warp, sc = r.range(220, 340);
  const t = TINTS[world.mood], day = world.mood === 'day';
  const ins = INSCRIPTION, shift = world.flipped ? FRAME_W - ins.x0 - ins.x1 : 0;
  out = decode().map((b) => {
    const fixed = b.name === 'label' || b.name === 'inscription';
    // Misregistration: each colour block lands a little off the key, as on a hand-pulled print.
    const kento = world.original || b.name === 'paper' || fixed ? 0 : r.range(0.6, 2.6), ka = r.range(0, Math.PI * 2);
    const ox = Math.cos(ka) * kento, oy = Math.sin(ka) * kento;
    const rings = b.rings.map((src) => {
      const r2 = new Float32Array(src.length);
      for (let k = 0; k < src.length; k += 2) {
        let x = src[k], y = src[k + 1];
        if (fixed) x += shift;
        else {
          if (amp > 0) {
            // A swell that fades toward the frame's edges, so the sea still meets them.
            const edge = Math.min(1, x / 120, (FRAME_W - x) / 120, (H - y) / 80) ;
            const f = amp * Math.max(0, edge);
            x += noise.fbm(x / sc, y / sc, 3) * f;
            y += noise.fbm(x / sc + 37.1, y / sc + 11.7, 3) * f;
          }
          if (world.flipped) x = FRAME_W - x;
        }
        r2[k] = x + ox;
        r2[k + 1] = y + oy;
      }
      return r2;
    });
    return { name: b.name, rings, color: day ? b.color : mix(b.color, INKS[b.name].tint(t), 0.8) };
  });
  editions.set(world, out);
  return out;
}

/**
 * Where spray leaves the crests of the print: x, y and a heading, for the unmirrored original.
 * Picked by eye along the claws of the great wave, the wave behind it and the swell on the right.
 */
const EMITTERS: [number, number, number, number][] = [
  [600, 128, 0.6, -0.8], [668, 150, 0.8, -0.5], [735, 205, 0.9, -0.3], [800, 255, 1, -0.2], [858, 300, 1, 0],
  [862, 360, 0.9, 0.3], [835, 415, 0.7, 0.6], [775, 425, 0.4, 0.8], [700, 390, 0.3, 0.9], [540, 115, 0.2, -1],
  [455, 140, -0.2, -1], [300, 380, 0.2, -1], [180, 420, -0.3, -1], [1452, 420, 0.4, -1], [1470, 470, 0.6, -0.8],
  [520, 650, 0.3, -1], [440, 720, 0.1, -1], [150, 800, 0.2, -1],
];

export function printEmitters(world: World): [number, number, number, number][] {
  return EMITTERS.map(([x, y, dx, dy]) => (world.flipped ? [FRAME_W - x, y, -dx, dy] : [x, y, dx, dy]));
}
