import fs from 'node:fs';

/** Characters per second a sound-off viewer reads comfortably on a phone. */
export const CHARS_PER_SECOND = 15;

/**
 * Seconds a block of on-screen text needs:
 *   longest line / 15 cps + 0.4s per extra line + 1s to find and settle on it.
 * The longest line, not the total, drives it: the eye scans lines, and the
 * longest one is the slowest to finish.
 */
export function requiredSeconds(text, { cps = CHARS_PER_SECOND } = {}) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return 0;
  const longest = Math.max(...lines.map((l) => [...l].length));
  return longest / cps + 0.4 * (lines.length - 1) + 1;
}

const ts = (s) => {
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
  if (!m) throw new Error(`bad timestamp "${s}"`);
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
};

/** Parse SubRip (.srt) or WebVTT into [{ start, end, text }]. */
export function parseSubtitles(src) {
  const out = [];
  for (const block of src.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    out.push({ start: ts(a), end: ts(b.split(/\s/).filter(Boolean)[0]), text: lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim() });
  }
  return out;
}

/**
 * Load beats from .srt, .vtt or .json. JSON is an array of
 * { start, end, text } in seconds, or { from, to, text } in frames with `fps`.
 */
export function loadBeats(file, fps = 30) {
  const src = fs.readFileSync(file, 'utf8');
  if (/\.(srt|vtt)$/i.test(file)) return parseSubtitles(src);
  const j = JSON.parse(src);
  const arr = Array.isArray(j) ? j : j.beats;
  if (!Array.isArray(arr)) throw new Error(`${file}: expected an array of beats or { beats: [...] }`);
  return arr.map((b) =>
    b.from != null
      ? { start: b.from / (b.fps || j.fps || fps), end: b.to / (b.fps || j.fps || fps), text: b.text }
      : { start: Number(b.start), end: Number(b.end), text: b.text },
  );
}
