#!/usr/bin/env node
// Builds examples/demo.mp4: a 12s vertical clip with one of each defect, to try the tool on.
//   node examples/make-demo.mjs && npx remotion-qa check examples/demo.mp4 --beats examples/demo.srt
// Needs a TTF font: set DEMO_FONT, or it looks for Arial / DejaVu Sans in the usual places.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegPath } from '../src/ffmpeg.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const font = [
  process.env.DEMO_FONT,
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
].find((f) => f && existsSync(f));
if (!font) throw new Error('no font found; set DEMO_FONT=/path/to/font.ttf');

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019");
// Each line slides up over 0.4s from its beat's start, then holds.
const line = (text, size, x, y, from, to) =>
  `drawtext=fontfile='${font}':text='${esc(text)}':fontsize=${size}:fontcolor=0x1A1A1A:expansion=none:` +
  `x=${x}:y='${y}+max(0\\,(${from}+0.4-t))*150':enable='between(t,${from},${to})'`;

const filters = [
  // Beat 1, 0-1.2s: two lines that need ~2.9s on screen. Too fast.
  line('Most teams ship videos', 72, 80, 760, 0, 1.2),
  line('nobody can finish', 72, 80, 850, 0, 1.2),
  // Beat 2, 1.2-8s: needs ~1.9s, holds ~6.4s. Dead air.
  line("Here's the fix", 96, 80, 800, 1.2, 8),
  // Beat 3, 8-12s: a stat set wide enough to run under the like/comment buttons.
  line('37% of viewers', 120, 80, 760, 8, 12),
  line('watch with sound off', 64, 80, 900, 8, 12),
].join(',');

const out = path.join(here, 'demo.mp4');
execFileSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xF5F0E6:s=1080x1920:r=30:d=12',
  '-vf', filters, '-pix_fmt', 'yuv420p', '-crf', '20', out], { stdio: 'inherit' });
console.log(`wrote ${out}`);
