import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const MISSING = `ffmpeg not found. Fix it one of these ways:
  - let the bundled copy download:  npm rebuild ffmpeg-static   (npm 11+ may skip install scripts by default)
  - install ffmpeg on your PATH:     brew install ffmpeg | apt install ffmpeg | winget install ffmpeg
  - or point at a binary:            REMOTION_QA_FFMPEG=/path/to/ffmpeg`;

const onPath = () => spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

let resolved;

/**
 * Resolve an ffmpeg binary: $REMOTION_QA_FFMPEG, then ffmpeg-static, then PATH.
 * Newer npm versions skip install scripts, which leaves ffmpeg-static without
 * its binary; in that case its own download step is run once, here.
 */
export function ffmpegPath() {
  if (resolved) return resolved;
  if (process.env.REMOTION_QA_FFMPEG) return (resolved = process.env.REMOTION_QA_FFMPEG);
  let bundled = null;
  try {
    bundled = require('ffmpeg-static');
  } catch {}
  if (bundled && existsSync(bundled)) return (resolved = bundled);
  if (onPath()) return (resolved = 'ffmpeg');
  if (bundled) {
    try {
      const installer = path.join(path.dirname(require.resolve('ffmpeg-static/package.json')), 'install.js');
      process.stderr.write('remotion-qa: downloading ffmpeg (one time)...\n');
      execFileSync(process.execPath, [installer], { cwd: path.dirname(installer), stdio: ['ignore', 'ignore', 'inherit'] });
    } catch {}
    if (existsSync(bundled)) return (resolved = bundled);
  }
  throw new Error(MISSING);
}

/**
 * Read width, height, fps and duration from ffmpeg's banner.
 * `ffmpeg -i` with no output exits non-zero by design, so stderr is parsed.
 */
export function probe(file) {
  if (!existsSync(file)) throw new Error(`file not found: ${file}`);
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-nostdin', '-i', file], { encoding: 'utf8' });
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? MISSING : r.error.message);
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
