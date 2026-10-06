// The composition of the print: what is where, before a single mark is cut.
//
// Hokusai's design is held here as a handful of curves per element (the back of the great wave,
// the edge where its blue meets its foam, the hollow under the lip, the swells on the right, the
// hulls of the three boats, Fuji) plus a few numbers that tell the carving procedures in
// src/paint/ how to work along them: how far apart the fingers of foam are, how big the talons
// grow, how many strands run through the blue. Every mark in the print is made by those
// procedures from the seed; nothing here is a picture.
//
// Edition 1831 is the composition as Hokusai drew it. Every other seed is an edition of its own:
// the whole sea is pushed by a seeded swell (the great wave rears higher or lower, the hollow
// opens or closes, the swells on the right lift), it may be mirrored, and boats may be missing.

import { Noise } from '../core/noise';
import type { Pt } from '../core/print';
import { hash, Rng } from '../core/rng';
import { FRAME_W, H, type World } from './world';

export type ZoneInk = 'deep' | 'blue' | 'aqua' | 'paper';

/** Fingers along an edge (see `lobed` in src/paint/ink.ts). */
export interface LobeSpec { period: number; amp: number; side: 1 | -1; sharp?: number; lean?: number; vary?: number; }
/** Talons grown on the finger tips. */
export interface ClawSpec { size: number; turn: 1 | -1; curl?: number; lift?: number; every?: number; }

/** A region of one ink inside a wave, bounded by a (lobed) edge and closed by straight lines. */
export interface Zone {
  ink: ZoneInk;
  edge: Pt[];
  close: Pt[];
  lobes?: LobeSpec;
  claws?: ClawSpec;
  /** A pale-indigo band printed just outside the edge, following its fingers. */
  fringe?: number;
  /** Lighter strands running inside, between the edge and this path. */
  strands?: { to: Pt[]; n: number; w: number; ink?: ZoneInk };
  /** White flecks per 100x100 px. */
  flecks?: number;
}

/** A lattice of talons between two paths: the crown of foam where a wave breaks. */
export interface Crown { a: Pt[]; b: Pt[]; rows: number; step: number; size: number; turn: 1 | -1; grow?: number; curl?: number; }

/** Long slivers of colour running between two paths, as Hokusai stripes the swells. */
export interface Stripes { a: Pt[]; b: Pt[]; rows: number; inks: ZoneInk[]; w: number; from?: number; to?: number; }

/** One long tapering stripe of colour along a spine, its upper edge maybe breaking into fingers. */
export interface Sliver { spine: Pt[]; w: number; ink: ZoneInk; lobes?: LobeSpec; claws?: ClawSpec; }

export interface WaveSpec {
  kind: 'wave';
  id: number;
  /** The silhouette, outlined by the key block, then straight lines closing the body. */
  outline: Pt[];
  close: Pt[];
  /** Body ink, paper unless given. */
  ink?: ZoneInk;
  /** How much of the outline gets the key line, as fractions along it. */
  key?: [number, number];
  stripes?: Stripes[];
  slivers?: Sliver[];
  zones: Zone[];
  crowns?: Crown[];
}

export interface BoatSpec {
  kind: 'boat';
  id: number;
  /** The hull's keel line, bow first. */
  keel: Pt[];
  beam: number;
  /** Where along the hull the crew sit, and how many. */
  crew: [number, number]; rowers: number;
}

export interface FujiSpec { kind: 'fuji'; id: number; x: number; base: number; h: number; w: number; }
export interface SeaSpec { kind: 'sea'; id: number; top: Pt[]; bottom: number; }

export type Element = WaveSpec | BoatSpec | FujiSpec | SeaSpec;

export interface Composition {
  /** Where the sky darkens toward the sea (top and bottom of the grey bokashi), and the horizon. */
  dusk: [number, number]; horizon: number;
  /** Spray thrown off the crest: a region of sky and how thick. */
  spray: { a: Pt[]; b: Pt[]; n: number }[];
  /** Back to front. */
  elements: Element[];
  /** The cartouche's corner, in print coordinates. */
  cartouche: Pt;
}

/** The edition that prints the composition exactly as Hokusai drew it. */
export const ORIGINAL = '1831';

// ------------------------------------------------------------ Hokusai's composition

export const KANAGAWA: Composition = {
  dusk: [575, 718], horizon: 720,
  cartouche: [76, 66],
  spray: [
    { a: [[650, 420], [690, 520], [700, 620]], b: [[760, 440], [790, 540], [780, 650]], n: 22 },
  ],
  elements: [
    { kind: 'fuji', id: 1, x: 936, base: 720, h: 62, w: 117 },
    { kind: 'sea', id: 2, top: [[606, 703], [736, 734], [857, 724], [1001, 741], [1124, 677]], bottom: 790 },
    // The swell on the right that lifts the third boat, its crest breaking back toward the left.
    {
      kind: 'wave',
      id: 3,
      outline: [[937, 766], [1104, 732], [1172, 690], [1257, 634], [1296, 588], [1339, 541], [1392, 474], [1429, 432], [1535, 366]],
      close: [[1500, 900], [972, 900]],
      zones: [
        {
          ink: 'deep',
          edge: [[1480, 530], [1452, 552], [1438, 600], [1366, 652], [1323, 680], [1248, 736], [1171, 755], [1104, 792]],
          close: [[1092, 780], [1274, 744], [1496, 700]],
          lobes: { period: 30, amp: 16, side: 1, lean: 0.55 },
          claws: { size: 18, turn: -1 },
          fringe: 11,
          strands: { to: [[1492, 706], [1284, 738], [1046, 786]], n: 2, w: 0.16, ink: 'blue' },
        },
      ],
      crowns: [
        { a: [[1531, 451], [1440, 486], [1406, 520]], b: [[1500, 524], [1440, 540], [1398, 568]], rows: 2, step: 30, size: 12, turn: -1 },
      ],
    },
    {
      kind: 'boat',
      id: 4,
      keel: [[1359, 538], [1304, 589], [1224, 654], [1124, 708], [1014, 738], [914, 736], [832, 704]],
      beam: 30,
      crew: [0.06, 0.36],
      rowers: 8,
    },
    // The great wave.
    {
      kind: 'wave',
      id: 5,
      outline: [[-14, 339], [0, 366], [78, 367], [126, 346], [177, 296], [218, 248], [249, 226], [302, 183], [366, 142], [415, 115], [474, 97], [503, 96], [553, 86], [605, 96], [632, 113], [680, 134], [722, 197], [716, 278], [747, 345]],
      close: [[715, 378], [652, 340], [590, 395], [590, 472], [597, 526], [616, 565], [646, 612], [670, 652], [714, 686], [752, 726], [812, 760], [802, 1000], [-30, 1000]],
      key: [0, 0.8],
      zones: [
        { ink: 'deep', edge: [[-24, 384], [37, 336], [59, 360], [154, 398]], close: [[86, 382], [43, 400], [-32, 420]], flecks: 6 },
        {
          ink: 'deep',
          edge: [[428, 392], [388, 376], [370, 340], [368, 282], [416, 216], [454, 222], [548, 208], [584, 238], [632, 256], [644, 294], [634, 338]],
          close: [[624, 350], [606, 392], [598, 452], [599, 510], [616, 565], [655, 612], [664, 654], [720, 662], [685, 680], [608, 622], [570, 574], [510, 526], [518, 432]],
          lobes: { period: 43, amp: 18, side: -1, lean: 0.42 },
          claws: { size: 28, turn: 1 },
          fringe: 7.49,
          strands: { to: [[563, 641], [590, 548], [620, 450], [616, 411], [608, 360], [656, 341]], n: 5, w: 0.02, ink: 'blue' },
          flecks: 9,
        },
        {
          ink: 'deep',
          edge: [[98, 736], [42, 706], [78, 634], [140, 542], [178, 456], [212, 487], [312, 552], [356, 460], [420, 456], [469, 486], [538, 521], [548, 560]],
          close: [[453, 608], [389, 670], [302, 710], [198, 728], [106, 774]],
          lobes: { period: 32, amp: 13, side: -1, lean: 0.57 },
          claws: { size: 26, turn: 1 },
          fringe: 18,
          strands: { to: [[94, 742], [259, 663], [394, 666], [476, 606]], n: 4, w: 0.03, ink: 'blue' },
          flecks: 10,
        },
      ],
      crowns: [
        {
          a: [[568, 64], [618, 114], [696, 166], [729, 200], [812, 232], [826, 270], [878, 306], [862, 336], [850, 396], [806, 436]],
          b: [[540, 210], [618, 205], [652, 261], [702, 318], [740, 324], [764, 368], [792, 395], [804, 425]],
          rows: 3,
          step: 26,
          size: 21,
          turn: 1,
          grow: 1.1,
        },
        {
          a: [[12, 427], [110, 412], [222, 386], [300, 362], [345, 320]],
          b: [[30, 482], [120, 480], [248, 458], [322, 446], [380, 433]],
          rows: 2,
          step: 34,
          size: 17,
          turn: 1,
        },
      ],
    },
    { kind: 'boat', id: 6, keel: [[26, 486], [86, 551], [166, 631], [248, 696], [318, 734]], beam: 34, crew: [0.25, 0.7], rowers: 7 },
    // The small wave in front, which echoes Fuji, and the breakers along the bottom.
    {
      kind: 'wave',
      id: 7,
      outline: [[-30, 776], [44, 742], [160, 744], [272, 760], [350, 741], [416, 690], [474, 642], [496, 608], [490, 564], [530, 566], [564, 622], [594, 678], [660, 706], [720, 754], [780, 782], [857, 828]],
      close: [[860, 1010], [-30, 1010]],
      zones: [
        {
          ink: 'deep',
          edge: [[16, 896], [82, 888], [157, 860], [235, 894], [305, 914], [426, 961], [481, 933], [541, 902], [644, 878]],
          close: [[640, 1002], [-8, 1010]],
          lobes: { period: 40, amp: 23, side: -1, lean: 0.57 },
          claws: { size: 26, turn: 1 },
          fringe: 24,
          strands: { to: [[10, 982], [306, 958], [655, 1044]], n: 4, w: 0.05, ink: 'blue' },
          flecks: 6,
        },
      ],
      crowns: [
        {
          a: [[20, 806], [152, 780], [306, 762], [396, 718], [470, 678]],
          b: [[8, 866], [144, 862], [314, 868], [455, 864], [560, 850]],
          rows: 3,
          step: 40,
          size: 13,
          turn: 1,
        },
      ],
    },
    // The trough in front of Fuji, striped with the swells running into it.
    {
      kind: 'wave',
      id: 8,
      outline: [[552, 599], [664, 704], [760, 776], [840, 822], [956, 818], [1068, 787], [1189, 762]],
      close: [[1180, 1010], [552, 1026]],
      key: [0, 0],
      stripes: [
        {
          a: [[588, 732], [702, 785], [801, 823], [969, 811], [1192, 794]],
          b: [[628, 980], [823, 984], [992, 1016], [1196, 982]],
          rows: 5,
          inks: ['aqua', 'blue', 'aqua', 'blue', 'aqua'],
          w: 0.07,
        },
      ],
      slivers: [
        { spine: [[602, 756], [616, 831], [684, 901], [755, 950], [814, 978]], w: 71, ink: 'deep' },
        { spine: [[694, 768], [748, 808], [838, 848], [898, 862]], w: 23, ink: 'deep' },
        { spine: [[820, 805], [900, 840], [1000, 868], [1110, 880]], w: 30, ink: 'deep' },
        { spine: [[790, 960], [900, 975], [1000, 985], [1090, 975]], w: 30, ink: 'deep' },
      ],
      zones: [],
    },
    // The long swell behind the second boat, rising to the right.
    {
      kind: 'wave',
      id: 9,
      outline: [[797, 750], [861, 758], [981, 778], [1049, 763], [1192, 813], [1226, 754], [1323, 714], [1414, 672], [1508, 630]],
      close: [[1500, 1010], [805, 1010]],
      stripes: [
        {
          a: [[774, 792], [992, 825], [1103, 828], [1258, 802], [1480, 700]],
          b: [[768, 996], [996, 990], [1266, 940], [1527, 905]],
          rows: 5,
          inks: ['aqua', 'blue', 'aqua', 'aqua', 'blue'],
          w: 0.09,
        },
      ],
      slivers: [
        { spine: [[1154, 774], [1246, 790], [1332, 752]], w: 21, ink: 'deep' },
        { spine: [[1058, 818], [1117, 836], [1244, 822], [1324, 773]], w: 33, ink: 'deep' },
        { spine: [[1023, 883], [1169, 888], [1229, 864]], w: 37, ink: 'deep' },
        { spine: [[1090, 950], [1200, 956], [1270, 944]], w: 22, ink: 'deep' },
      ],
      zones: [],
    },
    { kind: 'boat', id: 10, keel: [[614, 782], [690, 842], [770, 896], [870, 924], [990, 938], [1106, 942]], beam: 34, crew: [0.7, 0.98], rowers: 8 },
    // The wave rising in the bottom right corner.
    {
      kind: 'wave',
      id: 11,
      outline: [[955, 1013], [1017, 963], [1172, 892], [1265, 828], [1338, 764], [1427, 694], [1479, 668]],
      close: [[1500, 998]],
      stripes: [
        {
          a: [[1108, 987], [1218, 902], [1304, 780], [1484, 732]],
          b: [[1230, 1010], [1393, 1008], [1500, 998]],
          rows: 4,
          inks: ['aqua', 'blue', 'aqua', 'aqua'],
          w: 0.15,
        },
      ],
      slivers: [
        { spine: [[1335, 808], [1424, 806], [1532, 764]], w: 30, ink: 'deep' },
        { spine: [[1294, 878], [1366, 866], [1514, 835]], w: 30, ink: 'deep' },
        { spine: [[1216, 915], [1354, 914], [1530, 894]], w: 51, ink: 'deep' },
        { spine: [[1324, 1004], [1416, 1010], [1514, 999]], w: 22, ink: 'deep' },
      ],
      zones: [],
    },
  ],
};

// ------------------------------------------------------------ editions

const cache = new WeakMap<World, Composition>();

/** This seed's composition: Hokusai's own for edition 1831, otherwise a variation on it. */
export function composition(world: World): Composition {
  let c = cache.get(world);
  if (c) return c;
  c = world.original ? KANAGAWA : vary(world);
  cache.set(world, c);
  return c;
}

function vary(world: World): Composition {
  const r = new Rng(hash(world.s, 0xc0)), noise = new Noise(r);
  const amp = world.warp, sc = r.range(260, 420);
  // The great wave rears up or settles, about its foot in the bottom left.
  const rear = r.range(-0.12, 0.1), ox = 200, oy = 1000;
  const lift = r.range(-60, 40);
  const move = ([x, y]: Pt): Pt => {
    // A swell that fades toward the frame's edges, so the sea still meets them.
    const edge = Math.max(0, Math.min(1, (x + 40) / 160, (FRAME_W + 40 - x) / 160, (H + 20 - y) / 120));
    let X = x + noise.fbm(x / sc, y / sc, 3) * amp * edge, Y = y + noise.fbm(x / sc + 37.1, y / sc + 11.7, 3) * amp * edge;
    if (x < 900) { const k = Math.max(0, 1 - x / 900); Y = oy + (Y - oy) * (1 + rear * k); X = ox + (X - ox) * (1 + rear * 0.3 * k); }
    else Y += lift * Math.max(0, Math.min(1, (x - 900) / 400)) * Math.max(0, 1 - (Y - 400) / 600);
    return world.flipped ? [FRAME_W - X, Y] : [X, Y];
  };
  const mp = (pts: Pt[]) => pts.map(move);
  const fx = (x: number) => (world.flipped ? FRAME_W - x : x);
  const turn = (t: 1 | -1): 1 | -1 => (world.flipped ? (-t as 1 | -1) : t);
  const side = (s: 1 | -1): 1 | -1 => (world.flipped ? (-s as 1 | -1) : s);
  const shift = r.range(-60, 60);
  const elements: Element[] = [];
  for (const e of KANAGAWA.elements) {
    if (e.kind === 'fuji') elements.push({ ...e, x: fx(e.x + shift), h: e.h * r.range(0.8, 1.3), w: e.w * r.range(0.9, 1.15) });
    else if (e.kind === 'sea') elements.push({ ...e, top: mp(e.top) });
    else if (e.kind === 'boat') {
      // Now and then a boat has already gone under.
      if (r.chance(0.12)) continue;
      elements.push({ ...e, keel: mp(e.keel), rowers: Math.max(4, e.rowers + r.int(-2, 2)) });
    } else {
      elements.push({
        ...e, outline: mp(e.outline), close: mp(e.close),
        stripes: e.stripes?.map((s) => ({ ...s, a: mp(s.a), b: mp(s.b), rows: Math.max(3, s.rows + r.int(-1, 1)) })),
        slivers: e.slivers?.filter(() => r.chance(0.9)).map((v) => ({ ...v, spine: mp(v.spine), w: v.w * r.range(0.75, 1.3) })),
        zones: e.zones.map((z) => ({
          ...z, edge: mp(z.edge), close: mp(z.close),
          lobes: z.lobes && { ...z.lobes, side: side(z.lobes.side), period: z.lobes.period * r.range(0.85, 1.2), amp: z.lobes.amp * r.range(0.8, 1.25) },
          claws: z.claws && { ...z.claws, turn: turn(z.claws.turn), size: z.claws.size * r.range(0.85, 1.2) },
          strands: z.strands && { ...z.strands, to: mp(z.strands.to), n: Math.max(2, z.strands.n + r.int(-2, 2)) },
        })),
        crowns: e.crowns?.map((c) => ({ ...c, a: mp(c.a), b: mp(c.b), turn: turn(c.turn), size: c.size * r.range(0.85, 1.2) })),
      });
    }
  }
  return {
    ...KANAGAWA,
    cartouche: world.flipped ? [FRAME_W - KANAGAWA.cartouche[0] - 60, KANAGAWA.cartouche[1]] : KANAGAWA.cartouche,
    spray: KANAGAWA.spray.map((s) => ({ a: mp(s.a), b: mp(s.b), n: Math.round(s.n * r.range(0.6, 1.6)) })),
    elements,
  };
}
