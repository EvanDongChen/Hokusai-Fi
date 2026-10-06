// Curves for carving: smooth splines through a handful of control points, and the measures a
// carver needs along them (length, normals, a point and heading at any fraction of the way).
import type { Pt } from './print';

/**
 * A centripetal Catmull-Rom spline through the control points, sampled about every `step` px.
 * A point repeated twice in a row makes a sharp corner.
 */
export function spline(ctrl: Pt[], step = 6, closed = false): Pt[] {
  const n = ctrl.length;
  if (n < 3) return ctrl.map((p) => [p[0], p[1]] as Pt);
  const at = (i: number): Pt => (closed ? ctrl[(i + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))]);
  const out: Pt[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (d < 1e-6) continue;
    const t01 = Math.max(1e-4, Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
    const t12 = Math.sqrt(d);
    const t23 = Math.max(1e-4, Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])));
    // Tangents of the centripetal parameterisation, scaled to the segment.
    const m1: Pt = [0, 0], m2: Pt = [0, 0];
    for (let k = 0; k < 2; k++) {
      m1[k] = t12 * ((p1[k] - p0[k]) / t01 - (p2[k] - p0[k]) / (t01 + t12) + (p2[k] - p1[k]) / t12);
      m2[k] = t12 * ((p2[k] - p1[k]) / t12 - (p3[k] - p1[k]) / (t12 + t23) + (p3[k] - p2[k]) / t23);
    }
    // A corner: a repeated neighbour flattens that side's tangent.
    if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-6) { m1[0] = p2[0] - p1[0]; m1[1] = p2[1] - p1[1]; }
    if (Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) < 1e-6) { m2[0] = p2[0] - p1[0]; m2[1] = p2[1] - p1[1]; }
    const m = Math.max(2, Math.ceil(d / step));
    for (let j = i === 0 ? 0 : 1; j <= m; j++) {
      const t = j / m, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push([
        h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0],
        h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1],
      ]);
    }
  }
  if (closed) out.pop();
  return out;
}

/** A polyline with its running length, for walking along it by distance or fraction. */
export class Path {
  readonly pts: Pt[];
  readonly len: number[];
  readonly total: number;

  constructor(pts: Pt[]) {
    this.pts = pts;
    this.len = [0];
    for (let i = 1; i < pts.length; i++) this.len.push(this.len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.total = this.len[this.len.length - 1] || 1e-6;
  }

  private seg(s: number): [number, number] {
    const L = this.len;
    s = Math.max(0, Math.min(this.total, s));
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L[mid] <= s) lo = mid; else hi = mid;
    }
    return [lo, (s - L[lo]) / Math.max(1e-9, L[hi] - L[lo])];
  }

  /** The point at fraction f (0..1) of the way along. */
  at(f: number): Pt {
    const [i, t] = this.seg(f * this.total), a = this.pts[i], b = this.pts[Math.min(this.pts.length - 1, i + 1)];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /** Unit heading at fraction f. */
  dir(f: number): Pt {
    const e = Math.min(0.01, 4 / this.total);
    const a = this.at(Math.max(0, f - e)), b = this.at(Math.min(1, f + e));
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  }

  /** Unit normal at fraction f: the heading turned a quarter clockwise on screen (to its right). */
  normal(f: number): Pt {
    const d = this.dir(f);
    return [-d[1], d[0]];
  }

  /** Points every `step` px between fractions a and b. */
  slice(a: number, b: number, step = 4): Pt[] {
    const n = Math.max(1, Math.ceil(Math.abs(b - a) * this.total / step)), out: Pt[] = [];
    for (let i = 0; i <= n; i++) out.push(this.at(a + (b - a) * i / n));
    return out;
  }
}

/** Piecewise-linear profile through [x, y] knots, sorted by x; flat beyond the ends. */
export function profile(knots: readonly (readonly [number, number])[], x: number): number {
  if (!knots.length) return 0;
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    if (x <= knots[i][0]) {
      const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
      const t = (x - x0) / Math.max(1e-9, x1 - x0), s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * s;
    }
  }
  return knots[knots.length - 1][1];
}
