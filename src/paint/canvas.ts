// Canvases that work both in a worker and on the page.

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Print code is written against the page's context type; an offscreen one has the same drawing API.
 * Chunk canvases are rasterised on the CPU (willReadFrequently): thousands of shapes sent to the GPU
 * would queue up in front of the page's own frames and make scrolling stutter.
 */
export function context2d(c: AnyCanvas): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
}
