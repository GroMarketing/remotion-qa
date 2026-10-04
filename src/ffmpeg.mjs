import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Resolve an ffmpeg binary: $REMOTION_QA_FFMPEG, then ffmpeg-static, then PATH. */
export function ffmpegPath() {
  if (process.env.REMOTION_QA_FFMPEG) return process.env.REMOTION_QA_FFMPEG;
  try {
    // Newer npm versions can skip install scripts, leaving ffmpeg-static without its binary.
    const p = require('ffmpeg-static');
    if (p && existsSync(p)) return p;
  } catch {}
  return 'ffmpeg';
}

/**
 * Read width, height, fps and duration from ffmpeg's banner.
 * `ffmpeg -i` with no output exits non-zero by design, so stderr is parsed.
 */
export function probe(file) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-nostdin', '-i', file], { encoding: 'utf8' });
  const err = r.stderr || '';
  const v = err.match(/Stream #\S+.*Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!v) throw new Error(`no video stream found in ${file}`);
  const fps = err.match(/(\d+(?:\.\d+)?) fps/) || err.match(/(\d+(?:\.\d+)?) tbr/);
  const dur = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return {
    width: Number(v[1]),
    height: Number(v[2]),
    fps: fps ? Number(fps[1]) : 30,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
  };
}

/**
 * Decode frames as 8-bit grey at w×h. `rate` samples that many frames per
 * second instead of every frame. Returns { data, w, h, n }.
 */
export function decodeGray(file, w, h, rate = null) {
  const vf = [rate ? `fps=${rate}` : null, `scale=${w}:${h}:flags=area`, 'format=gray'].filter(Boolean).join(',');
  const data = execFileSync(ffmpegPath(), ['-nostdin', '-loglevel', 'error', '-i', file, '-vf', vf, '-f', 'rawvideo', '-'], {
    maxBuffer: 1 << 30,
  });
  return { data, w, h, n: Math.floor(data.length / (w * h)) };
}
