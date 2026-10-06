// The lo-fi soundtrack. Nothing is sampled: a dusty beat, a warm electric-piano chord loop, a
// round bass, a koto that plucks a Japanese pentatonic melody over it, now and then a breathy
// shakuhachi, a temple bell, and under it all the sea and the crackle of an old record. All of
// it is synthesised with Web Audio and composed from the seed.
//
// The seed sets the key, the chord loop and the drum pattern; the weather sets the scale and the
// tempo (a snowfall is slow and hirajoshi, a squall is quick and iwato), so the music turns as the
// print does while you wander. The sea swells louder over the rough water and calms in the bay.

import { hash, Rng } from '../core/rng';
import { World, type Mood } from '../world/world';

/** Seven-note scales for the chords, each holding the pentatonic the koto plays in. */
const MODES: Record<Mood, readonly number[]> = {
  day: [0, 2, 3, 5, 7, 9, 10],      // dorian, holding yo
  dawn: [0, 2, 4, 5, 7, 9, 11],     // ionian, holding the major pentatonic
  dusk: [0, 2, 4, 5, 7, 9, 10],     // mixolydian
  night: [0, 1, 3, 5, 7, 8, 10],    // phrygian, holding in
  storm: [0, 1, 3, 5, 6, 8, 10],    // locrian, holding iwato
  snow: [0, 2, 3, 5, 7, 8, 10],     // aeolian, holding hirajoshi
};
const PENTA: Record<Mood, readonly number[]> = {
  day: [0, 2, 5, 7, 9], dawn: [0, 2, 4, 7, 9], dusk: [0, 2, 5, 7, 10],
  night: [0, 1, 5, 7, 8], storm: [0, 1, 5, 6, 10], snow: [0, 2, 3, 7, 8],
};
const BPM: Record<Mood, number> = { day: 80, dawn: 76, dusk: 78, night: 70, storm: 88, snow: 68 };

/** Chord loops as scale degrees. */
const LOOPS = [[0, 5, 3, 4], [0, 3, 5, 4], [0, 6, 5, 3], [3, 4, 0, 0], [0, 2, 3, 4], [5, 3, 0, 4]];
/** Kick patterns over sixteen steps. */
const KICKS = [
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface Scene { x: number; mode: 'gallery' | 'wander'; }

export class Music {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private keys!: GainNode;
  private verb!: GainNode;
  private wow!: GainNode;
  private noise!: AudioBuffer;
  private sea!: GainNode;
  private surf!: GainNode;
  private hiss!: GainNode;
  private world: World | null = null;
  private rng = new Rng(1);
  private enabled = false;
  private timer = 0;
  private scene: Scene = { x: 0, mode: 'gallery' };

  // The composition, from the seed.
  private root = 50;
  private loop = LOOPS[0];
  private kick = KICKS[0];

  // Scheduling state, in audio-context seconds.
  private step = 0;
  private nextStep = 0;
  private mood: Mood = 'day';
  private calm = 0;
  private nextCrackle = 0;
  private nextBell = 0;
  private nextFlute = 0;

  get on() { return this.enabled; }

  setWorld(world: World) {
    this.world = world;
    this.rng = new Rng(hash(world.s, 0x6c6f));
    this.root = 46 + Math.floor(this.rng.random() * 9);
    this.loop = this.rng.pick(LOOPS);
    this.kick = this.rng.pick(KICKS);
    this.step = 0;
    this.mood = world.mood;
    if (this.ctx) this.nextStep = this.ctx.currentTime + 0.1;
  }

  setScene(scene: Scene) {
    this.scene = scene;
    if (!this.ctx || !this.world) return;
    const w = this.world, t = this.ctx.currentTime;
    const b = scene.mode === 'gallery' ? { kanagawa: 1, swell: 0, fuji: 0, coast: 0, isles: 0 } : w.biomeWeights(scene.x);
    const rough = b.kanagawa + b.swell * 0.75 + b.isles * 0.5 + b.coast * 0.35 + b.fuji * 0.2;
    this.calm = b.fuji + b.coast * 0.5;
    this.sea.gain.setTargetAtTime(0.1 + rough * 0.22, t, 1.5);
    this.surf.gain.setTargetAtTime(0.02 + rough * 0.06 + (scene.mode === 'gallery' ? 0 : w.moodWeight(scene.x, 'storm') * 0.08), t, 1.5);
  }

  async setEnabled(on: boolean) {
    if (on && !this.ctx) this.build();
    if (!this.ctx) return;
    this.enabled = on;
    const t = this.ctx.currentTime;
    if (on) {
      await this.ctx.resume();
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0.8, t, 0.6);
      this.nextStep = Math.max(this.nextStep, this.ctx.currentTime + 0.1);
      this.setScene(this.scene);
      clearInterval(this.timer);
      this.timer = window.setInterval(() => this.tick(), 90);
    } else {
      this.master.gain.setTargetAtTime(0, t, 0.25);
      clearInterval(this.timer);
      setTimeout(() => { if (!this.enabled) this.ctx?.suspend(); }, 1200);
    }
  }

  // ------------------------------------------------------------ the rig

  private build() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = this.ctx = new AC();
    const sr = ctx.sampleRate;

    // Noise, shared by the drums, the sea and the crackle.
    this.noise = ctx.createBuffer(1, sr * 2, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Master: a soft compressor, then a dull tape-like low-pass.
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const tape = ctx.createBiquadFilter();
    tape.type = 'lowpass';
    tape.frequency.value = 5200;
    tape.Q.value = 0.4;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.bus = ctx.createGain();
    this.bus.connect(comp).connect(tape).connect(this.master).connect(ctx.destination);

    // A room: noise-burst impulse response.
    const conv = ctx.createConvolver(), len = sr * 2.4, ir = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.35;
    this.verb.connect(conv).connect(this.bus);

    // The keys bus ducks under each kick, the lo-fi pump.
    this.keys = ctx.createGain();
    this.keys.connect(this.bus);
    this.keys.connect(this.verb);

    // Wow: a slow wobble in pitch shared by every tonal voice, like a warped record.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.45;
    this.wow = ctx.createGain();
    this.wow.gain.value = 7;
    lfo.connect(this.wow);
    lfo.start();

    // The sea: a low rolling wash that swells and falls, and the hiss of surf on top.
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.11;
    const swellAmt = ctx.createGain();
    swellAmt.gain.value = 0.5;
    swell.connect(swellAmt);
    swell.start();
    const seaSrc = this.loopNoise(), seaLp = ctx.createBiquadFilter();
    seaLp.type = 'lowpass';
    seaLp.frequency.value = 420;
    const seaMod = ctx.createGain();
    seaMod.gain.value = 0.55;
    swellAmt.connect(seaMod.gain);
    this.sea = ctx.createGain();
    this.sea.gain.value = 0.15;
    seaSrc.connect(seaLp).connect(seaMod).connect(this.sea).connect(this.bus);
    const surfSrc = this.loopNoise(), surfBp = ctx.createBiquadFilter();
    surfBp.type = 'bandpass';
    surfBp.frequency.value = 2600;
    surfBp.Q.value = 0.6;
    const surfMod = ctx.createGain();
    surfMod.gain.value = 0.5;
    swellAmt.connect(surfMod.gain);
    this.surf = ctx.createGain();
    this.surf.gain.value = 0.04;
    surfSrc.connect(surfBp).connect(surfMod).connect(this.surf).connect(this.bus);

    // Record hiss.
    const hissSrc = this.loopNoise(), hissHp = ctx.createBiquadFilter();
    hissHp.type = 'highpass';
    hissHp.frequency.value = 5000;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0.012;
    hissSrc.connect(hissHp).connect(this.hiss).connect(this.master);

    if (this.world) this.setWorld(this.world);
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  }

  // ------------------------------------------------------------ the scheduler

  private tick() {
    if (!this.ctx || !this.world) return;
    const ahead = this.ctx.currentTime + 0.3;
    while (this.nextStep < ahead) {
      this.playStep(this.nextStep);
      // Sixteenths with a lazy swing on the off-steps.
      const s16 = 60 / BPM[this.mood] / 4, swing = this.step % 2 === 0 ? 1.16 : 0.84;
      this.nextStep += s16 * swing;
      this.step = (this.step + 1) % 64;
    }
    const t = this.ctx.currentTime;
    while (this.nextCrackle < ahead) {
      this.crackle(Math.max(t, this.nextCrackle));
      this.nextCrackle += Math.random() * Math.random() * 0.5;
    }
  }

  private playStep(t: number) {
    const w = this.world!, r = this.rng, s = this.step % 16, bar = Math.floor(this.step / 16);
    // The weather can turn at the top of each bar.
    if (s === 0) this.mood = this.scene.mode === 'gallery' ? w.mood : w.moodAt(this.scene.x);
    const mood = this.mood, mode = MODES[mood], beat = 60 / BPM[mood];
    const calm = this.calm;

    // Drums: thinner over the calm bay, a full beat on rough water.
    if (this.kick[s] && r.random() > calm * 0.6) this.kickDrum(t, s === 0 ? 1 : 0.8);
    if ((s === 4 || s === 12) && r.random() > calm * 0.5) this.snare(t);
    if (s % 2 === 0 || r.chance(0.22)) this.hat(t, s % 4 === 2 ? 0.55 : s % 2 ? 0.25 : 0.38);

    // Chords: one per bar, a stacked seventh (sometimes a ninth) from the mode.
    if (s === 0) {
      const deg = this.loop[bar % this.loop.length];
      const notes = [0, 2, 4, 6].concat(r.chance(0.5) ? [8] : []).map((k) => this.noteOf(mode, deg + k, 0));
      for (const [i, n] of notes.entries()) this.ep(t + i * 0.012, midi(n), beat * 3.6, 0.07);
      this.bass(t, midi(this.noteOf(mode, deg, -2)), beat * 1.6);
    }
    if (s === 10 && r.chance(0.6)) {
      const deg = this.loop[bar % this.loop.length];
      this.bass(t, midi(this.noteOf(mode, deg + (r.chance(0.5) ? 4 : 0), -2)), beat * 1.2);
    }

    // The koto: sparse pentatonic phrases, a little denser in the gallery.
    const pent = PENTA[mood];
    const density = (this.scene.mode === 'gallery' ? 0.32 : 0.24) * (s % 2 ? 0.5 : 1);
    if (r.random() < density && bar % 8 !== 7) {
      const k = r.int(0, 9), oct = Math.floor(k / pent.length);
      const n = this.root + 12 + oct * 12 + pent[k % pent.length];
      this.koto(t, midi(n), r.chance(0.12));
    }

    // Now and then, the flute or a temple bell.
    if (s === 0 && t > this.nextFlute && r.chance(mood === 'night' || mood === 'snow' ? 0.3 : 0.12)) {
      this.nextFlute = t + beat * 16;
      const n = this.root + 12 + pent[r.int(0, pent.length - 1)];
      this.shakuhachi(t, midi(n), beat * r.range(4, 7));
    }
    if (s === 0 && t > this.nextBell && r.chance(mood === 'dawn' || mood === 'night' ? 0.15 : 0.05)) {
      this.nextBell = t + beat * 24;
      this.bell(t + beat * 0.5, midi(this.root + 24));
    }
  }

  /** A note from a scale degree (may run past an octave), in the octave around the root. */
  private noteOf(mode: readonly number[], deg: number, oct: number): number {
    const n = mode.length, o = Math.floor(deg / n);
    return this.root + (oct + o) * 12 + mode[((deg % n) + n) % n];
  }

  // ------------------------------------------------------------ voices

  private env(t: number, peak: number, attack: number, decay: number, dest: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode, wow = true) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (wow) this.wow.connect(o.detune);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseBurst(t: number, dur: number, dest: AudioNode) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.connect(dest);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private kickDrum(t: number, v: number) {
    const ctx = this.ctx!, g = this.env(t, 0.55 * v, 0.003, 0.32, this.bus);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.4);
    // Duck the keys.
    this.keys.gain.cancelScheduledValues(t);
    this.keys.gain.setValueAtTime(0.55, t);
    this.keys.gain.setTargetAtTime(1, t + 0.04, 0.12);
  }

  private snare(t: number) {
    const ctx = this.ctx!, bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = this.env(t, 0.22, 0.002, 0.2, this.bus);
    g.connect(this.verb);
    bp.connect(g);
    this.noiseBurst(t, 0.25, bp);
    this.osc('triangle', 190, t, 0.1, this.env(t, 0.12, 0.002, 0.08, this.bus), false);
  }

  private hat(t: number, v: number) {
    const hp = this.ctx!.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    hp.connect(this.env(t, 0.06 * v, 0.001, 0.045, this.bus));
    this.noiseBurst(t, 0.06, hp);
  }

  /** A warm electric piano: sine body with a soft bell overtone, through a dull filter. */
  private ep(t: number, f: number, dur: number, v: number) {
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1900;
    lp.connect(this.keys);
    const g = this.env(t, v, 0.015, dur, lp);
    this.osc('sine', f, t, dur, g);
    this.osc('sine', f * 2, t, dur * 0.4, this.env(t, v * 0.25, 0.005, dur * 0.3, lp));
    this.osc('triangle', f, t, dur, this.env(t, v * 0.18, 0.02, dur * 0.8, lp));
  }

  private bass(t: number, f: number, dur: number) {
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.connect(this.bus);
    this.osc('triangle', f, t, dur, this.env(t, 0.32, 0.02, dur, lp));
    this.osc('sine', f / 2, t, dur, this.env(t, 0.2, 0.02, dur, lp));
  }

  /** A koto pluck: a bright attack and quick fall, the pitch settling from a touch sharp. */
  private koto(t: number, f: number, bend: boolean) {
    const ctx = this.ctx!, out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.keys);
    out.connect(this.verb);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(f * 7, t);
    bp.frequency.exponentialRampToValueAtTime(f * 2, t + 0.5);
    bp.connect(out);
    const o1 = this.osc('triangle', f, t, 1.6, this.env(t, 0.11, 0.003, 1.4, bp));
    const o2 = this.osc('sawtooth', f, t, 0.6, this.env(t, 0.035, 0.002, 0.4, bp));
    for (const o of [o1, o2]) {
      o.frequency.setValueAtTime(f * 1.012, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      // Oshide: pressing behind the bridge to bend the note up.
      if (bend) {
        o.frequency.setValueAtTime(f, t + 0.25);
        o.frequency.linearRampToValueAtTime(f * Math.pow(2, 2 / 12), t + 0.45);
      }
    }
    const pick = ctx.createBiquadFilter();
    pick.type = 'bandpass';
    pick.frequency.value = f * 4;
    pick.connect(this.env(t, 0.05, 0.001, 0.03, out));
    this.noiseBurst(t, 0.04, pick);
  }

  /** A shakuhachi: breathy, sliding up into the note, its vibrato deepening as it is held. */
  private shakuhachi(t: number, f: number, dur: number) {
    const ctx = this.ctx!, g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.075, t + dur * 0.25);
    g.gain.setValueAtTime(0.075, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(this.keys);
    g.connect(this.verb);
    const o = this.osc('sine', f, t, dur, g);
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.3);
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 5;
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.012, t + dur * 0.8);
    vib.connect(vg).connect(o.frequency);
    vib.start(t);
    vib.stop(t + dur + 0.05);
    this.osc('triangle', f * 2, t, dur, this.env(t, 0.008, dur * 0.3, dur * 0.7, g));
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2;
    bp.Q.value = 3;
    const breath = ctx.createGain();
    breath.gain.setValueAtTime(0, t);
    breath.gain.linearRampToValueAtTime(0.3, t + 0.15);
    breath.gain.linearRampToValueAtTime(0.12, t + dur);
    bp.connect(breath).connect(g);
    this.noiseBurst(t, dur, bp);
  }

  /** A temple bell: inharmonic partials ringing away slowly. */
  private bell(t: number, f: number) {
    for (const [k, v, d] of [[0.5, 0.05, 7], [1, 0.04, 5], [1.19, 0.025, 4], [2.4, 0.015, 3], [2.98, 0.01, 2]] as const) {
      const g = this.env(t, v, 0.004, d, this.verb);
      g.connect(this.bus);
      this.osc('sine', f * k, t, d, g, false);
    }
  }

  private crackle(t: number) {
    const hp = this.ctx!.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    hp.connect(this.env(t, 0.03 + Math.random() * 0.05, 0.0005, 0.004, this.master));
    this.noiseBurst(t, 0.006, hp);
  }
}
