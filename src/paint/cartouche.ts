// The title cartouche in the corner of the print, the artist's column beside it, and a red seal
// carved from the seed. Drawn on the page (not in the workers) so it can use the page's fonts.

import { css, type RGB } from '../core/color';
import { hash, hashString, Rng } from '../core/rng';
import { FRAME_W, H, type World } from '../world/world';
import type { View } from '../anim/life';

/** Right-to-left columns: the series, then the title, as in the original's cartouche. */
const TITLE = ['冨嶽無限景', '神奈川沖', '浪裏'];
/** "Printed by machine", in place of the artist's signature. */
const SIGNED = ['電脳摺'];

export const CJK = '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", "MS Mincho", serif';
const PAPER: RGB = [240, 228, 200];
const VERMILION: RGB = [190, 52, 38];

function column(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  for (const [i, ch] of [...text].entries()) g.fillText(ch, x, y + i * size * 1.06);
}

/** Draws the cartouche over the print at its place in the classic frame. */
export function drawCartouche(g: CanvasRenderingContext2D, view: View, world: World) {
  const s = view.scale, X = (x: number) => (x - view.x0) * s + view.offsetX;
  const t = world.tintAt(FRAME_W * 0.08), size = 15;
  const w = 3 * size * 1.5 + 10, h = 5 * size * 1.06 + 16;
  const x0 = world.flipped ? FRAME_W - 26 - w - size * 2.2 : 26, y0 = H * 0.035;
  if (X(x0 + w + 80) < 0 || X(x0 - 80) > (view.x1 - view.x0) * s + view.offsetX) return;

  g.save();
  g.translate(X(x0), y0 * s);
  g.scale(s, s);
  // The cartouche: a pale panel with a double rule.
  g.fillStyle = css(PAPER, 0.92);
  g.fillRect(0, 0, w, h);
  g.strokeStyle = css(t.key, 0.85);
  g.lineWidth = 1.2;
  g.strokeRect(0.5, 0.5, w - 1, h - 1);
  g.lineWidth = 0.6;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = css(t.key, 0.92);
  g.font = `600 ${size}px ${CJK}`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  TITLE.forEach((col, i) => column(g, col, w - 8 - size * 0.75 - i * size * 1.5, 8, size));

  // Beside it, the signature column and the seal.
  const sx = world.flipped ? -size * 1.2 : w + size * 1.2;
  g.fillStyle = css(t.key, 0.85);
  g.font = `500 ${size * 0.9}px ${CJK}`;
  column(g, SIGNED[0], sx, 4, size * 0.9);
  seal(g, sx - size * 0.62, 4 + size * 3.1, size * 1.24, world.seed);
  g.restore();
}

/** A square seal in vermilion, its white strokes laid out from the seed like carved seal script. */
export function seal(g: CanvasRenderingContext2D, x: number, y: number, size: number, seed: string) {
  const r = new Rng(hash(hashString(seed), 0x5ea1)), n = 4, cell = (size - 4) / n;
  g.save();
  g.translate(x, y);
  g.fillStyle = css(VERMILION, 0.92);
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(250,238,220,0.92)';
  g.lineCap = 'square';
  g.lineWidth = Math.max(0.8, cell * 0.28);
  g.strokeRect(1.4, 1.4, size - 2.8, size - 2.8);
  g.beginPath();
  for (let k = 0; k < 7; k++) {
    const i = r.int(0, n - 1), j = r.int(0, n - 1), horiz = r.chance(0.5), len = r.int(1, 2);
    const ax = 2 + (i + 0.5) * cell, ay = 2 + (j + 0.5) * cell;
    g.moveTo(ax, ay);
    g.lineTo(Math.min(size - 3, ax + (horiz ? len * cell : 0)), Math.min(size - 3, ay + (horiz ? 0 : len * cell)));
  }
  g.stroke();
  g.restore();
}
