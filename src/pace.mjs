import { decodeGray, probe } from './ffmpeg.mjs';
import { requiredSeconds } from './reading.mjs';

/**
 * Analysis area in px. Downscaling averages a moving glyph edge against a big
 * field of unchanged ground, so too small and a word rise on a light ground
 * reads as "still". At 64x114 an 80px word rise registered as static for 4.1s
 * of a 4.2s beat; ~192x342 (65K px) sees it. Change this and STILL together.
 */
const AREA = 192 * 342;
/** Mean per-pixel 0-255 delta under which a frame counts as unchanged. */
export const STILL = 0.12;
/** Shortest run worth reporting, in frames. Ignores flicker. */
export const MIN_RUN = 12;

const even = (x) => Math.max(2, Math.round(x / 2) * 2);

/**
 * Find static runs (frames where nothing on screen changes) and, given the
 * text on screen per beat, how much of each run is dead air.
 *
 * Returns { file, fps, frames, seconds, runs, longest, tooFast, deadAir }.
 */
export function analyzePace(file, { beats = null, still = STILL, minRun = MIN_RUN } = {}) {
  const meta = probe(file);
  const aspect = meta.width / meta.height;
  const w = even(Math.sqrt(AREA * aspect));
  const h = even(w / aspect);
  const { data, n } = decodeGray(file, w, h);
  const size = w * h;
  const fps = meta.fps;

  const runs = [];
  let start = null;
  const close = (i) => {
    if (start !== null && i - start >= minRun) runs.push({ start: start / fps, end: i / fps });
    start = null;
  };
  for (let f = 1; f < n; f++) {
    let sum = 0;
    const a = (f - 1) * size;
    const b = f * size;
    for (let i = 0; i < size; i++) sum += Math.abs(data[a + i] - data[b + i]);
    if (sum / size < still) {
      if (start === null) start = f - 1;
    } else close(f - 1);
  }
  close(n - 1);

  for (const r of runs) {
    r.seconds = r.end - r.start;
    if (!beats) continue;
    // The beat on screen for most of this run.
    let best = null;
    let bestOverlap = 0;
    for (const b of beats) {
      const o = Math.min(r.end, b.end) - Math.max(r.start, b.start);
      if (o > bestOverlap) { bestOverlap = o; best = b; }
    }
    if (!best) continue;
    r.text = best.text;
    r.required = requiredSeconds(best.text);
    // The viewer starts reading when the beat arrives; anything still after
    // they have finished is dead air. A frozen frame while they read is fine.
    const readDone = best.start + r.required;
    r.deadAir = Math.max(0, Math.min(r.end, best.end) - Math.max(r.start, readDone));
  }

  const tooFast = (beats || [])
    .map((b) => ({ ...b, seconds: b.end - b.start, required: requiredSeconds(b.text) }))
    .filter((b) => b.text && b.seconds + 1e-6 < b.required)
    .map((b) => ({ ...b, short: b.required - b.seconds }));

  return {
    file,
    fps,
    frames: n,
    seconds: n / fps,
    runs,
    longest: runs.reduce((m, r) => Math.max(m, r.seconds), 0),
    deadAir: beats ? runs.reduce((m, r) => Math.max(m, r.deadAir || 0), 0) : null,
    tooFast,
  };
}
