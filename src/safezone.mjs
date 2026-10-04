import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { decodeGray, ffmpegPath, probe } from './ffmpeg.mjs';
import { detectChannel, getChannel, scaledInsets } from './channels.mjs';

/** Analyse at half the native canvas; plenty to locate an ink edge to ~2px. */
const SCALE = 0.5;
/**
 * An overlay band is judged only when this share of it sits within ±8 luma of
 * one value: a flat ground with marks on it. Footage, photos and gradients
 * filling the band fail this and are skipped, because their edges can't be
 * told apart from text. Judging per band (not per frame) keeps a flat caption
 * strip over footage checkable.
 */
const FLAT_SHARE = 0.8;
/** Luma distance from the band's ground that counts as ink. */
const INK_DELTA = 48;
/** A row or column needs this many ink px to count, which ignores specks and noise. */
const MIN_INK = 3;

/** Ground luma of a region if it is flat, else null. */
function flatGround(px, w, x0, y0, x1, y1) {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[px[y * w + x]]++; total++; }
  if (!total) return null;
  let win = 0;
  for (let v = 0; v <= 16; v++) win += hist[v];
  let best = win;
  let lo = 0;
  for (let v = 1; v + 16 < 256; v++) {
    win += hist[v + 16] - hist[v - 1];
    if (win > best) { best = win; lo = v; }
  }
  if (best / total < FLAT_SHARE) return null;
  let sum = 0;
  for (let v = lo; v <= lo + 16; v++) sum += v * hist[v];
  return sum / best;
}

export function analyzeSafeZone(file, { channel = null, rate = 2 } = {}) {
  const meta = probe(file);
  const ch = channel || detectChannel(meta.width, meta.height);
  const native = getChannel(ch).canvas;
  const w = Math.round((meta.width * SCALE) / 2) * 2;
  const h = Math.round((meta.height * SCALE) / 2) * 2;
  const ins = scaledInsets(ch, w, h);
  const toNative = native.w / w;
  const { data, n } = decodeGray(file, w, h, rate);
  const size = w * h;

  const worst = { top: null, bottom: null, left: null, right: null };
  let skippedBands = 0;

  for (let f = 0; f < n; f++) {
    const px = data.subarray(f * size, (f + 1) * size);
    const at = f / rate;
    const t = Math.round(ins.top);
    const btm = h - Math.round(ins.bottom);
    const l = Math.round(ins.left);
    const r = w - Math.round(ins.right);
    // Each band: its rectangle, and how to scan it from the safe edge outward.
    const bands = [
      { side: 'top', rect: [0, 0, w, t], lines: t, ink: (k) => row(t - 1 - k, 0, w) },
      { side: 'bottom', rect: [0, btm, w, h], lines: h - btm, ink: (k) => row(btm + k, 0, w) },
      { side: 'left', rect: [0, t, l, btm], lines: l, ink: (k) => col(l - 1 - k, t, btm) },
      { side: 'right', rect: [r, t, w, btm], lines: w - r, ink: (k) => col(r + k, t, btm) },
    ];
    let ground = null;
    const row = (y, x0, x1) => { let c = 0; for (let x = x0; x < x1; x++) if (Math.abs(px[y * w + x] - ground) > INK_DELTA) c++; return c; };
    const col = (x, y0, y1) => { let c = 0; for (let y = y0; y < y1; y++) if (Math.abs(px[y * w + x] - ground) > INK_DELTA) c++; return c; };
    let judged = 0;
    for (const band of bands) {
      ground = flatGround(px, w, ...band.rect);
      if (ground === null) continue;
      judged++;
      // Deepest line, counted from the safe edge, that still carries ink.
      let deepest = 0;
      for (let k = 0; k < band.lines; k++) if (band.ink(k) >= MIN_INK) deepest = k + 1;
      const d = Math.round(deepest * toNative);
      if (d > 0 && (!worst[band.side] || d > worst[band.side].depth)) worst[band.side] = { side: band.side, depth: d, at };
    }
    skippedBands += bands.length - judged;
  }

  return { file, channel: ch, sampled: n, skippedBands, intrusions: Object.values(worst).filter(Boolean) };
}

/**
 * Save the frame behind each intrusion with the overlay zones shaded red, so a
 * person can tell text (a defect) from decoration (fine under the UI) at a glance.
 * Returns the written paths.
 */
export function saveIntrusionFrames(report, dir) {
  const meta = probe(report.file);
  const i = scaledInsets(report.channel, meta.width, meta.height);
  const R = (x) => Math.round(x);
  const shade = (x, y, w, h) => `drawbox=x=${R(x)}:y=${R(y)}:w=${R(w)}:h=${R(h)}:color=red@0.25:t=fill`;
  const vf = [
    shade(0, 0, meta.width, i.top),
    shade(0, meta.height - i.bottom, meta.width, i.bottom),
    shade(0, i.top, i.left, meta.height - i.top - i.bottom),
    shade(meta.width - i.right, i.top, i.right, meta.height - i.top - i.bottom),
  ].join(',');
  const base = path.basename(report.file).replace(/\.[^.]+$/, '');
  return report.intrusions.map((x) => {
    const out = path.join(dir, `${base}-${x.side}-${x.at.toFixed(2)}s.png`);
    execFileSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-ss', String(x.at), '-i', report.file, '-frames:v', '1', '-vf', vf, out]);
    return out;
  });
}
