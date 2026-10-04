/**
 * Platform safe zones and mobile type floors.
 *
 * Insets are in canvas px on the channel's native canvas and are scaled to any
 * other resolution with the same aspect. They mark where the platform's own UI
 * (captions, buttons, progress bar, username) sits on top of your video.
 *
 * Type floors are calibrated to the smallest mainstream phone in the field, a
 * 360pt-wide Android (Galaxy S23 class, density 3.00): on-device pt = canvas px / 3.
 * Treat them as FLOORS, not targets: size every element as large as its layout allows.
 */

export const DEVICES = {
  'galaxy-s23': { label: 'Galaxy S23', widthPt: 360, density: 3.0 },
  'iphone-se': { label: 'iPhone SE', widthPt: 375, density: 2.88 },
  'iphone-15': { label: 'iPhone 15', widthPt: 393, density: 2.75 },
  'iphone-15-pro-max': { label: 'iPhone 15 Pro Max', widthPt: 430, density: 2.51 },
};

/** The smallest device the floors promise legibility on. */
export const DESIGNED_TO = 'galaxy-s23';

/** BBC caption-readability floor, in on-device points. */
export const MIN_READABLE_PT = 8.5;

const VERTICAL_MIN = {
  hero: 74, // display headline
  statHero: 160, // full-bleed number
  statCardNum: 110, // number inside a card
  body: 38,
  statLabel: 38,
  ctaLabel: 52,
  ctaSub: 32,
  eyebrow: 24, // tracked uppercase kicker
  source: 24, // footnote / source tag
};

export const CHANNELS = {
  // Worst-case union of the three vertical feeds, so one render serves all of them.
  //   IG Reels  T220 B340 L60 R180
  //   FB Reels  T220 B360 L60 R140
  //   YT Shorts T220 B280 L60 R160
  'reels-union': {
    label: 'Reels union (IG Reels, FB Reels, YT Shorts)',
    canvas: { w: 1080, h: 1920 },
    insets: { top: 220, bottom: 360, left: 60, right: 180 },
    min: VERTICAL_MIN,
  },
  'ig-reels': { label: 'Instagram Reels', canvas: { w: 1080, h: 1920 }, insets: { top: 220, bottom: 340, left: 60, right: 180 }, min: VERTICAL_MIN },
  'fb-reels': { label: 'Facebook Reels', canvas: { w: 1080, h: 1920 }, insets: { top: 220, bottom: 360, left: 60, right: 140 }, min: VERTICAL_MIN },
  'yt-shorts': { label: 'YouTube Shorts', canvas: { w: 1080, h: 1920 }, insets: { top: 220, bottom: 280, left: 60, right: 160 }, min: VERTICAL_MIN },
  // Right 300px holds YouTube's end-screen cards in the last ~20s; bottom is the control bar.
  'yt-landscape': {
    label: 'YouTube 16:9',
    canvas: { w: 1920, h: 1080 },
    insets: { top: 120, bottom: 60, left: 60, right: 300 },
    min: { hero: 84, statHero: 220, statCardNum: 130, body: 40, statLabel: 40, ctaLabel: 56, ctaSub: 34, eyebrow: 24, source: 24 },
  },
  'feed-square': { label: 'Square feed (IG, FB, LinkedIn)', canvas: { w: 1080, h: 1080 }, insets: { top: 60, bottom: 120, left: 60, right: 60 }, min: VERTICAL_MIN },
  'feed-portrait': { label: '4:5 portrait feed', canvas: { w: 1080, h: 1350 }, insets: { top: 60, bottom: 140, left: 60, right: 60 }, min: VERTICAL_MIN },
};

/** Pick the channel whose canvas aspect matches w×h. Vertical defaults to the union. */
export function detectChannel(w, h) {
  const a = w / h;
  const near = (x) => Math.abs(a - x) < 0.01;
  if (near(1080 / 1920)) return 'reels-union';
  if (near(1920 / 1080)) return 'yt-landscape';
  if (near(1)) return 'feed-square';
  if (near(1080 / 1350)) return 'feed-portrait';
  throw new Error(`no channel matches a ${w}x${h} canvas; pass --channel`);
}

export function getChannel(name) {
  const c = CHANNELS[name];
  if (!c) throw new Error(`unknown channel "${name}". Known: ${Object.keys(CHANNELS).join(', ')}`);
  return c;
}

/** Insets scaled from the channel's native canvas to a w×h frame. */
export function scaledInsets(channel, w, h) {
  const c = getChannel(channel);
  const sx = w / c.canvas.w;
  const sy = h / c.canvas.h;
  const i = c.insets;
  return { top: i.top * sy, bottom: i.bottom * sy, left: i.left * sx, right: i.right * sx };
}

/** Canvas px to on-device points. `canvasWidth` is the video's width in px. */
export function devicePt(px, { device = DESIGNED_TO, canvasWidth = 1080 } = {}) {
  const d = DEVICES[device];
  if (!d) throw new Error(`unknown device "${device}"`);
  return px / (canvasWidth / d.widthPt);
}

/**
 * Minimum canvas px for a text role. `fontFactor` raises the floor for faces
 * with less stem mass than the calibration faces (a heavy geometric display
 * face and a humanist sans); 1.08 is right for Manrope 600/700, for example.
 */
export function minPx(role, { channel = 'reels-union', fontFactor = 1 } = {}) {
  const c = getChannel(channel);
  const base = c.min[role];
  if (base == null) throw new Error(`unknown role "${role}". Known: ${Object.keys(c.min).join(', ')}`);
  return Math.ceil(base * fontFactor);
}

/** Throw if `px` is below the floor for `role`. For use inside a composition. */
export function assertLegible(px, role, opts = {}) {
  const floor = minPx(role, opts);
  if (px < floor) {
    throw new Error(`${role} at ${px}px is under its ${floor}px floor (${devicePt(px).toFixed(1)}pt on a ${DEVICES[DESIGNED_TO].label})`);
  }
  return px;
}
