// The living print: an animation layer drawn over the finished impression each frame.
//
//  - Spray leaps from the lips of the curling waves and falls back like the flecks of foam
//    Hokusai scattered over the sky.
//  - Seabirds cross now and then, a loose skein of flickering ink marks.
//  - The weather moves: snow drifts down, squalls slant in lines of rain, petals blow past at dawn.
//  - The sun and moon breathe.
//
// Everything lives in world coordinates, so it works the same in the gallery and while wandering.
// It never changes what a seed prints.

import { css, type RGB } from '../core/color';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { breakersNear } from '../world/field';
import { H, HZ, World } from '../world/world';

/** Maps world coordinates to canvas pixels. */
export interface View { x0: number; x1: number; scale: number; offsetX: number; }

interface Fleck { x: number; y: number; vx: number; vy: number; r: number; age: number; life: number; foam: RGB; key: RGB; }
interface Bird { x: number; y: number; vx: number; ph: number; size: number; }
interface Flake { x: number; y: number; vx: number; vy: number; r: number; ph: number; kind: 'snow' | 'rain' | 'petal'; }

export class Life {
  /** 0.3..1: thinned out by the page when frames run long. */
  quality = 1;
  private flecks: Fleck[] = [];
  private birds: Bird[] = [];
  private flakes: Flake[] = [];
  private rng = new Rng((Math.random() * 2 ** 32) >>> 0);
  private t = 0;
  private nextFlock = 4;

  constructor(private world: World) {}

  update(dt: number, view: View) {
    const r = this.rng, w = this.world, mid = (view.x0 + view.x1) / 2, span = view.x1 - view.x0;
    this.t += dt;

    // Spray from each breaking lip, more from the bigger ones.
    for (const { packet, curl } of breakersNear(w, view.x0, view.x1)) {
      const rate = (packet.E / 300) * 9 * this.quality, o = curl.outer;
      let n = rate * dt;
      const t = w.tintAt(packet.c);
      while (n > 0 && this.flecks.length < 500) {
        if (n < 1 && r.random() > n) break;
        n -= 1;
        // From the leading half of the lip, flung on along it and outward.
        const i = Math.floor(r.range(0.4, 0.95) * (o.length - 2)), a = o[i], b = o[i + 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l;
        const sp = r.range(20, 70) * Math.sqrt(packet.E / 300);
        this.flecks.push({
          x: a[0], y: a[1], vx: tx * sp * 0.9 + ty * sp * 0.5 * packet.dir, vy: ty * sp * 0.9 - tx * sp * 0.5 * packet.dir - 10,
          r: curl.R * r.range(0.02, 0.05) + 0.6, age: 0, life: r.range(1.4, 3.2), foam: t.foam, key: t.key,
        });
      }
    }
    for (const f of this.flecks) {
      f.age += dt;
      f.vy += 38 * dt;
      f.vx *= 1 - dt * 0.3;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.flecks = this.flecks.filter((f) => f.age < f.life && f.y < H + 20);

    // A skein of seabirds every so often.
    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = r.range(14, 32);
      const n = r.int(3, 8), dir = r.chance(0.5) ? 1 : -1, y0 = H * r.range(0.1, 0.42), size = r.range(6, 11);
      for (let i = 0; i < n; i++) {
        this.birds.push({
          x: (dir > 0 ? view.x0 - 40 : view.x1 + 40) - dir * i * r.range(18, 34), y: y0 + Math.abs(i - n / 2) * r.range(6, 12) + r.range(-6, 6),
          vx: dir * r.range(55, 75), ph: r.range(0, 6), size: size * r.range(0.85, 1.15),
        });
      }
    }
    for (const b of this.birds) { b.x += b.vx * dt; b.ph += dt * 7; }
    this.birds = this.birds.filter((b) => b.x > view.x0 - 400 && b.x < view.x1 + 400);

    // Weather, by how much of each mood is in view.
    const snow = w.moodWeight(mid, 'snow'), rain = w.moodWeight(mid, 'storm'), petals = w.moodWeight(mid, 'dawn') * 0.5;
    const want = (k: number, max: number) => Math.round(k * max * this.quality * clamp(span / 1500, 0.4, 1.4));
    const counts = { snow: 0, rain: 0, petal: 0 };
    for (const f of this.flakes) counts[f.kind]++;
    const spawn = (kind: Flake['kind'], need: number) => {
      for (let i = counts[kind]; i < need; i++) {
        const top = r.chance(0.7);
        this.flakes.push({
          kind, x: view.x0 + r.random() * span * 1.2 - span * 0.1, y: top ? -10 : r.random() * H, ph: r.range(0, 6),
          vx: kind === 'rain' ? -140 : r.range(-14, 6), vy: kind === 'rain' ? r.range(520, 680) : kind === 'snow' ? r.range(26, 52) : r.range(18, 34),
          r: kind === 'snow' ? r.range(1.3, 3.4) : kind === 'petal' ? r.range(3, 5) : r.range(18, 40),
        });
      }
    };
    spawn('snow', want(snow, 160));
    spawn('rain', want(rain, 140));
    spawn('petal', want(petals, 26));
    for (const f of this.flakes) {
      f.ph += dt;
      f.x += (f.vx + (f.kind === 'rain' ? 0 : Math.sin(f.ph * 1.3) * 12)) * dt;
      f.y += f.vy * dt;
    }
    // Retire flakes that fall out of view or whose weather has passed.
    const keep = { snow: want(snow, 160), rain: want(rain, 140), petal: want(petals, 26) };
    const seen = { snow: 0, rain: 0, petal: 0 };
    this.flakes = this.flakes.filter((f) => {
      if (f.y > H + 40 || f.x < view.x0 - 200 || f.x > view.x1 + 200) return false;
      return ++seen[f.kind] <= keep[f.kind] + 10;
    });
  }

  draw(ctx: CanvasRenderingContext2D, view: View) {
    const X = (x: number) => (x - view.x0) * view.scale + view.offsetX, s = view.scale;
    ctx.save();

    // The sun and moon breathe.
    for (const o of this.world.orbsNear(view.x0 - 200, view.x1 + 200)) {
      const a = 0.12 + 0.08 * Math.sin(this.t * 0.8 + o.id % 7), R = o.r * 2.6 * s;
      const g = ctx.createRadialGradient(X(o.x), o.y * s, o.r * s, X(o.x), o.y * s, R);
      const c = o.kind === 'sun' ? '236,120,80' : '240,232,196';
      g.addColorStop(0, `rgba(${c},${a})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(X(o.x) - R, o.y * s - R, R * 2, R * 2);
    }

    for (const f of this.flecks) {
      const a = clamp(Math.min(f.age * 6, (f.life - f.age) / 0.6), 0, 1);
      ctx.beginPath();
      ctx.arc(X(f.x), f.y * s, f.r * s, 0, Math.PI * 2);
      ctx.fillStyle = css(f.foam, a);
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, 0.8 * s);
      ctx.strokeStyle = css(f.key, a * 0.8);
      ctx.stroke();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const b of this.birds) {
      const k = this.world.tintAt(b.x).key, flap = Math.sin(b.ph) * 0.6, x = X(b.x), y = b.y * s, z = b.size * s;
      ctx.strokeStyle = css(k, 0.85);
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.beginPath();
      ctx.moveTo(x - z, y - z * flap);
      ctx.quadraticCurveTo(x - z * 0.45, y - z * (0.25 + flap * 0.5), x, y);
      ctx.quadraticCurveTo(x + z * 0.45, y - z * (0.25 + flap * 0.5), x + z, y - z * flap);
      ctx.stroke();
    }

    for (const f of this.flakes) {
      const x = X(f.x), y = f.y * s;
      if (f.kind === 'snow') {
        ctx.fillStyle = 'rgba(252,251,246,0.9)';
        ctx.beginPath();
        ctx.arc(x, y, f.r * s, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.kind === 'rain') {
        if (f.y > HZ + 60) continue;
        ctx.strokeStyle = 'rgba(40,46,62,0.32)';
        ctx.lineWidth = Math.max(0.6, 0.9 * s);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - f.r * 0.24 * s, y + f.r * s);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(242,186,196,0.9)';
        ctx.beginPath();
        ctx.ellipse(x, y, f.r * s, f.r * 0.55 * s, f.ph * 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

