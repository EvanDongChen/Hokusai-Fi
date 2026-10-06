// Depth into the picture. The sea's waves themselves are the field's (field.ts).

/** Depth into the picture of water whose foot is at y: 0 at the horizon (720), 1 just below the frame. */
export const zOf = (y: number) => Math.min(1, Math.max(0, (y - 720) / 380));
