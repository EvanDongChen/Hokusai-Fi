import { Life, type View } from './anim/life';
import { Music } from './audio/music';
import { clamp } from './core/math';
import { CJK, drawCartouche } from './paint/cartouche';
import { palette } from './paint/kanagawa';
import { ChunkPool } from './paint/pool';
import { renderPostcard } from './postcard';
import { css } from './core/color';
import { hash } from './core/rng';
import { ORIGINAL } from './world/kanagawa';
import { BIOME_NAMES, CW, FRAME_W, H, MOOD_NAMES, World } from './world/world';

type Mode = 'studio' | 'voyage';

/** The inks in the tray, as the printer calls them. */
const INKS = [
  ['paper', '胡粉', 'shell white'], ['aqua', '浅葱', 'pale indigo'], ['blue', '藍', 'Prussian blue'], ['deep', '紺', 'deep indigo'],
  ['key', '墨', 'key block'], ['boat', '黄土', 'ochre'], ['shade', '鼠', 'grey'],
] as const;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ADJ = ['quiet', 'rolling', 'indigo', 'salt', 'windswept', 'autumn', 'restless', 'moonlit', 'silver', 'distant', 'spring', 'winter', 'misty', 'crested', 'prussian'];
const NOUN = ['wave', 'fuji', 'tide', 'gull', 'oar', 'pine', 'crest', 'foam', 'swell', 'boat', 'shore', 'current', 'reef', 'harbor', 'crane'];

function randomSeed(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(ADJ)}-${pick(NOUN)}-${1 + Math.floor(Math.random() * 999)}`;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Phones and tablets: paint at a lower resolution and keep the page's frame budget for scrolling. */
const coarse = matchMedia('(pointer: coarse)').matches;
const pretty = (seed: string) => seed.replace(/-/g, ' ');

/** One ri, the old Japanese league, in world units: distances on the HUD are in ri out to sea. */
const RI = 1000;

class App {
  private app = $('app');
  private wanderCanvas = $<HTMLCanvasElement>('voyage-canvas');
  private wctx = this.wanderCanvas.getContext('2d')!;
  private galleryCanvas = $<HTMLCanvasElement>('print-canvas');
  private gctx = this.galleryCanvas.getContext('2d')!;
  private seedInput = $<HTMLInputElement>('seed-input');
  private speedInput = $<HTMLInputElement>('speed');
  private playBtn = $('btn-play');
  private animBtn = $('btn-anim');
  private soundBtn = $('btn-sound');
  private music = new Music();
  private about = $('about');
  private toastEl = $('toast');
  private radio = document.querySelector<HTMLElement>('.radio')!;

  private mode: Mode = 'studio';
  private world!: World;
  private pool!: ChunkPool;
  private life!: Life;
  private readonly renderScale: number;

  /** Camera left edge, in world units. */
  private camX = 0;
  /** Momentum from dragging, scrolling and arrow keys, in world units per second. */
  private vel = 0;
  private playing = !reducedMotion;
  private animating = !reducedMotion;
  private speed = 45;
  private dragging = false;
  private lastX = 0;
  private lastT = 0;
  private lastFrame = 0;
  private toastTimer = 0;
  private dirty = true;
  private lastScene = 0;
  private slowFor = 0;
  private smooth = 1 / 60;

  constructor() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderScale = clamp((innerHeight * dpr) / H, 0.75, coarse ? 1 : 1.5);

    const params = new URLSearchParams(location.search);
    if (params.get('intro') === '0') $('intro').remove();
    this.speed = Number(params.get('speed') ?? this.speed);
    this.speedInput.value = String(this.speed);
    if (params.get('animate') === '0') this.animating = false;
    this.bind();
    this.setSeed(params.get('seed') || randomSeed());
    // A shared link can point at a spot along the sea.
    if (params.has('x')) this.camX = Number(params.get('x')) || 0;
    this.setMode(params.get('mode') === 'voyage' || params.get('mode') === 'wander' ? 'voyage' : 'studio');
    this.setPlaying(this.playing);
    this.setAnimating(this.animating);
    this.setSound(false);
    this.onSpeed();
    this.resize();
    // The cartouche uses a web font; redraw once it has arrived.
    document.fonts?.load(`600 16px ${CJK}`, '冨嶽').then(() => { this.dirty = true; }).catch(() => {});
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ state

  private setSeed(seed: string) {
    this.pool?.dispose();
    this.world = new World(seed);
    this.pool = new ChunkPool(seed, this.renderScale, () => { this.dirty = true; });
    this.life = new Life(this.world);
    this.music.setWorld(this.world);
    this.camX = 0;
    this.vel = 0;
    this.dirty = true;

    this.galleryCanvas.width = this.pool.chunkPx * 2;
    this.galleryCanvas.height = this.pool.chunkPy;

    this.seedInput.value = pretty(seed);
    $('edition').textContent = pretty(seed);
    $('edition-note').textContent = this.world.original ? 'as Hokusai drew it' : this.world.flipped ? 'mirrored' : '';
    $('marks').textContent = 'pulling the blocks…';
    $('pull').style.opacity = '1';
    $('weather').textContent = MOOD_NAMES[this.world.mood];
    this.tune();
    this.fillTray();
    this.syncUrl();
  }

  /** The radio's dial: every sea has its own frequency on the FM band. */
  private tune() {
    const f = this.world.original ? 1 : (hash(this.world.s, 0xf3) % 1000) / 1000;
    const mhz = 76 + f * 32;
    $('needle').parentElement!.style.setProperty('--tune', f.toFixed(3));
    $('freq').textContent = `FM ${mhz.toFixed(1)}`;
    this.radio.classList.add('tuning');
    setTimeout(() => this.radio.classList.remove('tuning'), 900);
  }

  /** The tray holds a dish of each ink this edition is printed in. */
  private fillTray() {
    const pal = palette(this.world), ul = $('inks');
    ul.replaceChildren(...INKS.map(([k, jp, en]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dish" style="--c:${css(pal[k])}"></span><span class="ink-name"><b lang="ja">${jp}</b><span>${en}</span></span>`;
      return li;
    }));
  }

  private updateRadio() {
    const on = this.music.on;
    this.radio.classList.toggle('on', on);
    const p = $('playing'), i = this.music.info();
    const text = on ? `♪ koto in ${i.scale} · ${i.key} · ${i.bpm} bpm` : 'radio off · press play';
    if (p.textContent !== text) p.textContent = text;
    $('vu').style.height = `${Math.round(this.music.level() * 100)}%`;
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    this.app.dataset.mode = mode;
    const b = $('btn-mode'), sail = mode === 'studio';
    b.querySelector('span')!.textContent = sail ? 'Set sail' : 'Back to the bench';
    b.title = sail ? 'Set sail along the sea (W)' : 'Back to the bench (G)';
    b.setAttribute('aria-label', sail ? 'Set sail' : 'Back to the bench');
    if (mode === 'voyage') this.resize();
    this.dirty = true;
    this.syncUrl();
  }

  private setPlaying(on: boolean) {
    this.playing = on;
    this.playBtn.classList.toggle('paused', !on);
    this.playBtn.setAttribute('aria-label', on ? 'Pause drifting' : 'Resume drifting');
    this.playBtn.title = on ? 'Pause (Space)' : 'Drift (Space)';
  }

  private setAnimating(on: boolean) {
    this.animating = on;
    this.dirty = true;
    this.animBtn.classList.toggle('active', on);
    this.animBtn.setAttribute('aria-pressed', String(on));
    this.animBtn.title = on ? 'Still the print (A)' : 'Bring the print to life (A)';
  }

  private async setSound(on: boolean) {
    try {
      await this.music.setEnabled(on);
    } catch {
      this.toast('Sound is not available here');
      on = false;
    }
    this.soundBtn.setAttribute('aria-pressed', String(on));
    this.soundBtn.title = on ? 'Turn the radio off (M)' : 'Play the radio (M)';
    this.soundBtn.setAttribute('aria-label', on ? 'Turn the radio off' : 'Play the radio');
    this.updateRadio();
  }

  private syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('seed', this.world.seed);
    if (this.mode === 'voyage') url.searchParams.set('mode', 'voyage');
    else url.searchParams.delete('mode');
    for (const k of ['intro', 'speed', 'animate', 'x']) url.searchParams.delete(k);
    history.replaceState(null, '', url);
  }

  // ------------------------------------------------------------ frame loop

  /** Canvas pixels per world unit while sailing. */
  private get viewScale() { return this.wanderCanvas.height / H; }
  private get viewW() { return this.wanderCanvas.width / this.viewScale; }

  private visibleChunks(): number[] {
    const a = World.chunkOf(this.camX), b = World.chunkOf(this.camX + this.viewW);
    const out: number[] = [];
    for (let c = a; c <= b; c++) out.push(c);
    return out;
  }

  private wanted(): number[] {
    if (this.mode === 'studio') return [0, 1];
    const vis = this.visibleChunks();
    const a = vis[0], b = vis[vis.length - 1];
    const forward = this.vel + (this.playing ? this.speed : 0) >= 0;
    // Paint what's on screen first, then the road ahead, then a little behind.
    return forward ? [...vis, b + 1, b + 2, a - 1] : [...vis.reverse(), a - 1, a - 2, b + 1];
  }

  private loop(t: number) {
    const dt = Math.min(0.05, (t - (this.lastFrame || t)) / 1000);
    this.lastFrame = t;

    // If frames keep taking too long, thin out the animation layer instead of letting the page stutter.
    this.smooth += (dt - this.smooth) * 0.05;
    this.slowFor = this.smooth > 0.034 ? this.slowFor + dt : 0;
    if (this.slowFor > 2.5) {
      this.life.quality = Math.max(0.3, this.life.quality * 0.7);
      this.slowFor = 0;
    }

    if (this.mode === 'voyage' && !this.dragging) {
      const before = this.camX;
      this.camX += ((this.playing ? this.speed : 0) + this.vel) * dt;
      this.vel *= Math.exp(-dt * 2.5);
      if (Math.abs(this.vel) < 1) this.vel = 0;
      if (this.camX !== before) this.dirty = true;
    }

    const sceneX = this.mode === 'studio' ? FRAME_W / 2 : this.camX + this.viewW / 2;
    if (t - this.lastScene > 400) {
      this.lastScene = t;
      this.music.setScene({ x: sceneX, mode: this.mode === 'studio' ? 'gallery' : 'wander' });
      const mood = MOOD_NAMES[this.world.moodAt(sceneX)], el = $('log-mood'), sea = BIOME_NAMES[this.world.biomeAt(sceneX)];
      if (el.textContent !== mood) el.textContent = mood;
      if ($('log-sea').textContent !== sea) $('log-sea').textContent = sea;
    }

    const wanted = this.wanted();
    this.pool.request(wanted);

    const view: View = this.mode === 'studio'
      ? { x0: 0, x1: FRAME_W, scale: this.galleryCanvas.width / FRAME_W, offsetX: 0 }
      : { x0: this.camX, x1: this.camX + this.viewW, scale: this.viewScale, offsetX: 0 };
    if (this.animating) this.life.update(dt, view);

    if (this.dirty || this.animating) {
      if (this.mode === 'studio') this.drawGallery(view);
      else this.drawWander(view);
      this.dirty = false;
    }

    if (this.mode === 'studio') this.updateGalleryProgress();
    else {
      const busy = this.visibleChunks().some((c) => !this.pool.get(c)?.done);
      $('log-printing').classList.toggle('on', busy);
      $('log-distance').textContent = (this.camX / RI).toFixed(2);
    }
    this.updateRadio();

    const keep = new Set(wanted), here = World.chunkOf(this.camX);
    this.pool.evict((c) => keep.has(c) || c === 0 || c === 1 || (this.mode === 'voyage' && Math.abs(c - here) <= 4));
    this.world.prune(this.mode === 'studio' ? 0 : here);
    requestAnimationFrame((n) => this.loop(n));
  }

  private drawGallery(view: View) {
    const g = this.gctx;
    g.fillStyle = '#e2d3b0';
    g.fillRect(0, 0, this.galleryCanvas.width, this.galleryCanvas.height);
    for (const c of [0, 1]) {
      const img = this.pool.get(c)?.image;
      if (img) g.drawImage(img, c * this.pool.chunkPx, 0);
    }
    if (this.pool.get(0)?.done && this.pool.get(1)?.done) {
      drawCartouche(g, view, this.world);
      if (this.animating) this.life.draw(g, view);
    }
  }

  private updateGalleryProgress() {
    const a = this.pool.get(0), b = this.pool.get(1);
    const p = ((a?.progress ?? 0) + (b?.progress ?? 0)) / 2;
    const bar = $('pull');
    bar.style.width = `${(p * 100).toFixed(1)}%`;
    bar.style.opacity = p >= 1 ? '0' : '1';
    // The dishes light up in turn as the print is pulled: a progress bar in ink.
    const dishes = $('inks').children;
    for (let i = 0; i < dishes.length; i++) dishes[i].classList.toggle('used', p >= 1 || p > i / dishes.length);
    if (p >= 1 && a?.strokes && b?.strokes) {
      const text = `pulled in ${(a.strokes + b.strokes).toLocaleString()} impressions`, count = $('marks');
      if (count.textContent !== text) count.textContent = text;
    }
  }

  private drawWander(view: View) {
    const ctx = this.wctx, W = this.wanderCanvas.width, Hh = this.wanderCanvas.height, v = this.viewScale;
    ctx.fillStyle = '#e2d3b0';
    ctx.fillRect(0, 0, W, Hh);
    ctx.imageSmoothingQuality = 'medium';
    let allDone = true;
    for (const c of this.visibleChunks()) {
      const ch = this.pool.get(c);
      if (!ch?.done) allDone = false;
      if (!ch?.image) continue;
      // Snap to whole pixels and overlap by one so neighbouring chunks never show a hairline seam.
      const x = (c * CW - this.camX) * v, dx = Math.floor(x);
      ctx.drawImage(ch.image, dx, 0, Math.ceil(x + CW * v) - dx + 1, Hh);
    }
    if (allDone && this.animating) this.life.draw(ctx, view);
  }

  private resize() {
    // Wander redraws the whole screen every frame, so keep its backing store modest on dense displays.
    const dpr = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.5);
    this.wanderCanvas.width = Math.round(this.wanderCanvas.clientWidth * dpr);
    this.wanderCanvas.height = Math.round(this.wanderCanvas.clientHeight * dpr);
    this.dirty = true;
  }

  // ------------------------------------------------------------ actions

  /** The visible print, composed from its chunks, plus where it sits in the world. */
  private compose() {
    const s = this.pool.scale, out = document.createElement('canvas');
    const x0 = this.mode === 'studio' ? 0 : this.camX, w = this.mode === 'studio' ? FRAME_W : this.viewW;
    out.width = Math.round(w * s);
    out.height = this.pool.chunkPy;
    const ctx = out.getContext('2d')!;
    let strokes = 0;
    for (let c = World.chunkOf(x0); c <= World.chunkOf(x0 + w); c++) {
      const ch = this.pool.get(c);
      if (ch?.image) ctx.drawImage(ch.image, Math.round((c * CW - x0) * s), 0);
      strokes += ch?.strokes ?? 0;
    }
    drawCartouche(ctx, { x0, x1: x0 + w, scale: s, offsetX: 0 }, this.world);
    return { out, x0, w, strokes };
  }

  private download(canvas: HTMLCanvasElement, name: string) {
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      // Phones often ignore blob downloads; hand the picture to the share sheet (Save Image, Messages...) instead.
      if (coarse) {
        const file = new File([blob], name, { type: 'image/png' });
        try {
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Hokusai-Fi' });
            return;
          }
        } catch (e) {
          if ((e as DOMException).name === 'AbortError') return;
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.toast('Saved to your downloads');
    }, 'image/png');
  }

  /** Save the view as a postcard carrying the same details as the pencil notes and the radio. */
  private async save(plain = false) {
    // Wait (briefly) for the visible chunks to finish printing, so the postcard is never half-blank.
    const visible = () => (this.mode === 'studio' ? [0, 1] : this.visibleChunks());
    if (visible().some((c) => !this.pool.get(c)?.done)) {
      this.toast('Still printing. Your postcard will be ready in a moment…');
      for (let i = 0; i < 100 && visible().some((c) => !this.pool.get(c)?.done); i++) await new Promise((r) => setTimeout(r, 200));
    }
    const { out, x0, w, strokes } = this.compose(), wander = this.mode === 'voyage', wd = this.world;
    const mid = x0 + w / 2, suffix = wander ? `-${Math.round(this.camX)}` : '';
    if (plain) return this.download(out, `great-wave-${wd.seed}${suffix}.png`);

    const near = wd.near(World.chunkOf(mid));
    const boats = near.boats.filter((b) => b.x > x0 && b.x < x0 + w).length;
    const details: [string, string][] = [
      ['Weather', MOOD_NAMES[wander ? wd.moodAt(mid) : wd.mood]],
      ['Sea', BIOME_NAMES[wander ? wd.biomeAt(mid) : 'kanagawa']],
      ['Boats', boats ? `${boats} at the oars` : 'None in sight'],
      ['Blocks', strokes ? strokes.toLocaleString() : 'Countless'],
    ];
    if (!wander && wd.flipped) details.push(['Composition', 'Mirrored']);
    this.toast('Pulling your postcard…');
    const card = await renderPostcard({
      art: out, seed: wd.seed, title: 'The Great Wave', details,
      lines: ['After Katsushika Hokusai', 'Procedural woodblock print, 2026'],
      place: wander ? `${(mid / RI).toFixed(2)} ri out to sea` : 'The print studio',
    });
    this.download(card, `postcard-${wd.seed}${suffix}.png`);
  }

  private async share() {
    const url = new URL(location.href);
    if (this.mode === 'voyage') url.searchParams.set('x', String(Math.round(this.camX)));
    const text = `The Great Wave, No. ${pretty(this.world.seed)}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Hokusai-Fi', text, url: url.toString() });
        return;
      }
      await navigator.clipboard.writeText(url.toString());
      this.toast('Link copied. Anyone who opens it sees this exact sea.');
    } catch {
      this.toast(url.toString());
    }
  }

  private toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => this.toast('Fullscreen is not available here'));
  }

  private toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  private onSpeed() {
    this.speed = Number(this.speedInput.value);
    this.speedInput.style.setProperty('--fill', `${(this.speed / Number(this.speedInput.max)) * 100}%`);
  }

  private newSeed(seed = randomSeed()) {
    this.setSeed(seed);
    this.toast(seed === ORIGINAL ? 'Tuned to 1831: the sea as Hokusai drew it' : `Tuned to ${pretty(seed)}`);
  }

  private toggleAbout(open = this.about.hidden) {
    this.about.hidden = !open;
  }

  // ------------------------------------------------------------ input

  private bind() {
    $('btn-mode').onclick = () => this.setMode(this.mode === 'studio' ? 'voyage' : 'studio');
    $('btn-new').onclick = () => this.newSeed();
    $('btn-save').onclick = () => this.save();
    $('btn-share').onclick = () => this.share();
    $('btn-full').onclick = () => this.toggleFullscreen();
    $('btn-about').onclick = (e) => { e.stopPropagation(); this.toggleAbout(); };
    $('about-close').onclick = () => this.toggleAbout(false);
    this.animBtn.onclick = () => this.setAnimating(!this.animating);
    this.soundBtn.onclick = () => this.setSound(!this.music.on);
    this.playBtn.onclick = () => this.setPlaying(!this.playing);
    this.speedInput.oninput = () => this.onSpeed();
    this.seedInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        this.newSeed(this.seedInput.value.trim().toLowerCase().replace(/\s+/g, '-') || randomSeed());
        this.seedInput.blur();
      }
      e.stopPropagation();
    };
    document.addEventListener('click', (e) => {
      if (!this.about.hidden && !this.about.contains(e.target as Node)) this.toggleAbout(false);
    });
    addEventListener('resize', () => this.resize());

    // A swipe across the print steps into it and keeps rowing.
    const gallery = document.querySelector<HTMLElement>('.bench')!;
    let sx = 0, sy = 0, st = 0;
    gallery.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); });
    gallery.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (this.mode !== 'studio' || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      this.setMode('voyage');
      this.vel = clamp((-dx / Math.max(0.12, (performance.now() - st) / 1000)) * 0.6, -1500, 1500);
    });

    const c = this.wanderCanvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.vel = 0;
      this.lastX = e.clientX;
      this.lastT = performance.now();
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const now = performance.now(), dpr = this.wanderCanvas.width / innerWidth;
      const dx = ((e.clientX - this.lastX) * dpr) / this.viewScale;
      this.camX -= dx;
      this.dirty = true;
      const dt = Math.max(1, now - this.lastT) / 1000;
      this.vel = clamp(-dx / dt, -4000, 4000) * 0.6 + this.vel * 0.4;
      this.lastX = e.clientX;
      this.lastT = now;
    });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      c.classList.remove('dragging');
      if (performance.now() - this.lastT > 80) this.vel = 0;
      this.vel -= this.playing ? this.speed : 0;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dpr = this.wanderCanvas.width / innerWidth;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.camX += (d * dpr) / this.viewScale;
      this.dirty = true;
    }, { passive: false });

    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'g') this.setMode('studio');
      else if (k === 'w') this.setMode('voyage');
      else if (k === 'n') this.newSeed();
      else if (k === 's') this.save(e.shiftKey);
      else if (k === 'm') this.setSound(!this.music.on);
      else if (k === 'a') this.setAnimating(!this.animating);
      else if (k === 'c') this.share();
      else if (k === 'f') this.toggleFullscreen();
      else if (k === '?' || k === 'i') this.toggleAbout();
      else if (k === 'escape') this.toggleAbout(false);
      else if (k === ' ' && this.mode === 'voyage') { e.preventDefault(); this.setPlaying(!this.playing); }
      else if (k === 'arrowright' || k === 'arrowleft') {
        if (this.mode === 'studio') this.setMode('voyage');
        this.vel += k === 'arrowright' ? 700 : -700;
      }
    });
  }
}

new App();
