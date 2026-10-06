// The composition of the print: what is where, before a single mark is cut.
//
// Hokusai's design is held here as a handful of curves per element (the back of the great wave,
// the edge where its blue meets its foam, the hollow under the lip, the swells on the right, the
// hulls of the three boats, Fuji) plus a few numbers that tell the carving procedures in
// src/paint/ how to work along them: how far apart the fingers of foam are, how big the talons
// grow, how many strands run through the blue. Every mark in the print is made by those
// procedures from the seed; nothing here is a picture.
//
// Edition 1831 is the composition as Hokusai drew it. Every other seed composes a new painting
// from its parts (the great curling wave, the small wave that echoes Fuji, the striped swells,
// the boats): how many great waves rise and where, how big, which way they break, where Fuji
// stands and how near, which boats are out, all pushed about by a seeded swell.

import type { Pt } from '../core/print';
import { FRAME_W, type World } from './world';

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
    { kind: 'fuji', id: 1, x: 936, base: 744, h: 64, w: 117 },
    { kind: 'sea', id: 2, top: [[614, 703], [736, 734], [849, 724], [1005, 741], [1126, 681]], bottom: 790 },
    // The swell on the right that lifts the third boat, its crest breaking back toward the left.
    {
      kind: 'wave',
      id: 3,
      outline: [[935, 770], [1100, 732], [1180, 690], [1251, 632], [1304, 588], [1339, 541], [1392, 474], [1429, 432], [1535, 366]],
      close: [[1500, 900], [964, 900]],
      zones: [
        {
          ink: 'deep',
          edge: [[1480, 530], [1452, 552], [1438, 600], [1366, 652], [1323, 680], [1248, 736], [1171, 755], [1112, 792]],
          close: [[1092, 780], [1264, 744], [1496, 708]],
          lobes: { period: 30, amp: 16, side: 1, lean: 0.51 },
          claws: { size: 18, turn: -1 },
          fringe: 11,
          strands: { to: [[1488, 718], [1284, 738], [1054, 794]], n: 2, w: 0.16, ink: 'blue' },
        },
      ],
      crowns: [
        { a: [[1531, 451], [1440, 486], [1406, 520]], b: [[1500, 524], [1440, 540], [1398, 568]], rows: 2, step: 30, size: 12, turn: -1 },
      ],
    },
    {
      kind: 'boat',
      id: 4,
      keel: [[1361, 550], [1306, 601], [1226, 666], [1126, 720], [1016, 750], [916, 748], [834, 716]],
      beam: 30,
      crew: [0.06, 0.36],
      rowers: 8,
    },
    // The great wave.
    {
      kind: 'wave',
      id: 5,
      outline: [[-22, 347], [0, 366], [78, 367], [126, 346], [179, 296], [218, 248], [251, 226], [302, 183], [366, 142], [413, 115], [476, 97], [503, 96], [559, 86], [595, 96], [632, 113], [682, 134], [724, 195], [724, 274], [755, 349]],
      close: [[707, 380], [660, 336], [590, 395], [590, 474], [597, 526], [616, 565], [646, 612], [670, 652], [714, 686], [756, 726], [808, 760], [806, 1000], [-30, 1000]],
      key: [0, 0.8],
      zones: [
        { ink: 'deep', edge: [[-32, 370], [23, 340], [67, 360], [152, 412]], close: [[86, 378], [43, 402], [-30, 420]], flecks: 6 },
        {
          ink: 'deep',
          edge: [[428, 392], [388, 376], [370, 340], [368, 282], [416, 216], [466, 220], [548, 208], [582, 238], [632, 256], [644, 288], [634, 338]],
          close: [[624, 350], [606, 392], [598, 452], [599, 510], [616, 565], [655, 612], [664, 654], [720, 662], [685, 680], [608, 622], [570, 574], [510, 526], [518, 424]],
          lobes: { period: 43, amp: 18, side: -1, lean: 0.42 },
          claws: { size: 28, turn: 1 },
          fringe: 5.86,
          strands: { to: [[563, 639], [598, 560], [624, 442], [608, 411], [616, 368], [648, 341]], n: 5, w: 0.02, ink: 'blue' },
          flecks: 9,
        },
        {
          ink: 'deep',
          edge: [[98, 738], [42, 704], [76, 632], [134, 542], [174, 456], [220, 485], [300, 552], [366, 452], [426, 456], [471, 486], [538, 521], [548, 560]],
          close: [[453, 608], [389, 670], [302, 710], [196, 728], [92, 774]],
          lobes: { period: 32, amp: 13, side: -1, lean: 0.57 },
          claws: { size: 26, turn: 1 },
          fringe: 18,
          strands: { to: [[98, 740], [261, 663], [394, 668], [480, 608]], n: 4, w: 0.02, ink: 'blue' },
          flecks: 10,
        },
      ],
      crowns: [
        {
          a: [[564, 64], [618, 114], [700, 166], [729, 200], [812, 232], [828, 266], [870, 312], [870, 344], [850, 388], [814, 436]],
          b: [[532, 218], [618, 213], [660, 253], [710, 318], [740, 332], [762, 368], [792, 395], [804, 425]],
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
    { kind: 'boat', id: 6, keel: [[18, 486], [78, 551], [158, 631], [240, 696], [310, 734]], beam: 34, crew: [0.25, 0.7], rowers: 7 },
    // The small wave in front, which echoes Fuji, and the breakers along the bottom.
    {
      kind: 'wave',
      id: 7,
      outline: [[-22, 776], [54, 742], [172, 756], [264, 760], [358, 734], [418, 690], [466, 634], [486, 588], [508, 576], [530, 580], [562, 618], [616, 668], [660, 706], [720, 750], [778, 774], [857, 820]],
      close: [[860, 1010], [-30, 1010]],
      zones: [
        {
          ink: 'deep',
          edge: [[24, 896], [82, 884], [157, 860], [235, 894], [297, 922], [434, 961], [481, 941], [541, 902], [658, 880], [702, 896]],
          close: [[752, 1010], [0, 1014]],
          lobes: { period: 40, amp: 23, side: -1, lean: 0.49 },
          claws: { size: 26, turn: 1 },
          fringe: 28,
          strands: { to: [[12, 990], [316, 958], [647, 1052]], n: 4, w: 0.04, ink: 'blue' },
          flecks: 6,
        },
      ],
      crowns: [
        {
          a: [[20, 806], [144, 780], [306, 762], [394, 718], [470, 680]],
          b: [[8, 866], [154, 862], [308, 868], [455, 864], [560, 850]],
          rows: 3,
          step: 40,
          size: 12,
          turn: 1,
        },
      ],
    },
    // The trough in front of Fuji, striped with the swells running into it.
    {
      kind: 'wave',
      id: 8,
      outline: [[546, 591], [672, 696], [768, 776], [852, 814], [956, 818], [1060, 789], [1181, 762]],
      close: [[1180, 1010], [708, 1022], [636, 914], [604, 752]],
      key: [0, 0],
      stripes: [
        {
          a: [[578, 732], [704, 785], [805, 835], [977, 823], [1192, 792]],
          b: [[628, 970], [817, 998], [980, 1022], [1192, 986]],
          rows: 5,
          inks: ['aqua', 'blue', 'aqua', 'blue', 'aqua'],
          w: 0.05,
        },
      ],
      slivers: [
        { spine: [[610, 748], [616, 835], [684, 901], [755, 950], [826, 978]], w: 71, ink: 'deep' },
        { spine: [[698, 770], [750, 804], [824, 848], [894, 874]], w: 29, ink: 'deep' },
        { spine: [[820, 805], [898, 848], [1002, 876], [1110, 880]], w: 26, ink: 'deep' },
        { spine: [[778, 972], [912, 975], [1008, 973], [1086, 983]], w: 34, ink: 'deep' },
      ],
      zones: [],
    },
    // The long swell behind the second boat, rising to the right.
    {
      kind: 'wave',
      id: 9,
      outline: [[803, 748], [875, 762], [983, 778], [1078, 782], [1178, 764], [1246, 740], [1323, 714], [1414, 672], [1508, 630]],
      close: [[1500, 1010], [1100, 1010], [966, 974], [884, 860]],
      stripes: [
        {
          a: [[782, 792], [992, 825], [1095, 828], [1260, 802], [1480, 700]],
          b: [[764, 996], [996, 990], [1278, 940], [1527, 909]],
          rows: 5,
          inks: ['aqua', 'blue', 'aqua', 'aqua', 'blue'],
          w: 0.09,
        },
      ],
      slivers: [
        { spine: [[1158, 780], [1238, 790], [1330, 752]], w: 21, ink: 'deep' },
        { spine: [[1056, 818], [1117, 836], [1244, 822], [1324, 773]], w: 33, ink: 'deep' },
        { spine: [[1023, 891], [1175, 888], [1221, 858]], w: 42, ink: 'deep' },
        { spine: [[1090, 950], [1200, 956], [1270, 944]], w: 22, ink: 'deep' },
      ],
      zones: [],
    },
    { kind: 'boat', id: 10, keel: [[606, 786], [682, 846], [762, 900], [862, 928], [982, 942], [1098, 946]], beam: 34, crew: [0.7, 0.98], rowers: 8 },
    // The wave rising in the bottom right corner.
    {
      kind: 'wave',
      id: 11,
      outline: [[963, 1005], [1017, 963], [1172, 892], [1265, 828], [1338, 764], [1427, 694], [1479, 668]],
      close: [[1508, 998]],
      stripes: [
        {
          a: [[1100, 979], [1218, 902], [1308, 772], [1476, 732]],
          b: [[1230, 1010], [1405, 1008], [1500, 998]],
          rows: 4,
          inks: ['aqua', 'blue', 'aqua', 'aqua'],
          w: 0.15,
        },
      ],
      slivers: [
        { spine: [[1343, 808], [1424, 806], [1532, 756]], w: 31, ink: 'deep' },
        { spine: [[1294, 878], [1366, 866], [1518, 835]], w: 30, ink: 'deep' },
        { spine: [[1216, 915], [1354, 914], [1530, 894]], w: 51, ink: 'deep' },
        { spine: [[1316, 1004], [1416, 1010], [1514, 999]], w: 22, ink: 'deep' },
      ],
      zones: [],
    },
  ],
};

// ------------------------------------------------------------ editions

const cache = new WeakMap<World, Composition>();

/**
 * This seed's composition. Edition 1831 is Hokusai's own; every other edition is a window onto
 * the generated sea (src/world/field.ts), and keeps only the print's title cartouche.
 */
export function composition(world: World): Composition {
  let c = cache.get(world);
  if (c) return c;
  c = world.original ? KANAGAWA : {
    ...KANAGAWA, elements: [], spray: [],
    cartouche: world.flipped ? [FRAME_W - KANAGAWA.cartouche[0] - 60, KANAGAWA.cartouche[1]] : KANAGAWA.cartouche,
  };
  cache.set(world, c);
  return c;
}
