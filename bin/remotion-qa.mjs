#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { analyzePace } from '../src/pace.mjs';
import { mkdirSync } from 'node:fs';
import { analyzeSafeZone, saveIntrusionFrames } from '../src/safezone.mjs';
import { loadBeats } from '../src/reading.mjs';
import { CHANNELS, DEVICES, DESIGNED_TO, devicePt, minPx } from '../src/channels.mjs';

const HELP = `remotion-qa: measure a rendered video for sound-off readability

  remotion-qa pace <video>... [--beats <file.srt|.vtt|.json>] [--max <s>] [--max-dead <s>] [--json]
      Static runs (nothing on screen changing). With --beats, how much of each
      run is dead air after the text has been read, and which beats are too short to read.

  remotion-qa safezone <video>... [--channel <name>] [--frames <dir>] [--json]
      Text or graphics under the platform UI (captions, buttons, progress bar).
      --frames saves each flagged frame with the overlay zones shaded, for review.

  remotion-qa check <video>... [--beats <file>] [--channel <name>] [--json]
      pace + safezone; exits 1 on dead air over 1s, a too-fast beat, or any intrusion.

  remotion-qa render <CompId> <out.mp4> [--max <s>] [--entry <index.ts>] [-- <remotion args>]
      npx remotion render, then the pace gate. A failing render is moved to
      <out>.failed-pace.mp4 so nothing sits at the path people send from.

  remotion-qa floors [--channel <name>] [--font-factor <n>]
      Minimum font size per text role, in canvas px and on-device points.

Channels: ${Object.keys(CHANNELS).join(', ')}`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const sep = argv.indexOf('--');
const own = sep < 0 ? argv : argv.slice(0, sep);
const passthrough = sep < 0 ? [] : argv.slice(sep + 1);
const VALUED = new Set(['--frames', '--beats', '--max', '--max-dead', '--channel', '--entry', '--font-factor']);
const opt = {};
const pos = [];
for (let i = 0; i < own.length; i++) {
  const a = own[i];
  if (VALUED.has(a)) opt[a.slice(2)] = own[++i];
  else if (a.startsWith('--')) opt[a.slice(2)] = true;
  else pos.push(a);
}
const json = Boolean(opt.json);
const f2 = (x) => x.toFixed(2);
const name = (f) => f.split('/').pop();

function pace(files, gate) {
  let fail = false;
  const reports = [];
  for (const file of files) {
    const r = analyzePace(file, { beats: opt.beats ? loadBeats(opt.beats) : null });
    reports.push(r);
    const overMax = gate.max != null && r.longest > gate.max;
    const overDead = gate.maxDead != null && r.deadAir != null && r.deadAir > gate.maxDead;
    if (overMax || overDead || (gate.tooFast && r.tooFast.length)) fail = true;
    if (json) continue;
    console.log(`\n${name(file)}  ${r.frames} frames, ${f2(r.seconds)}s at ${r.fps}fps`);
    for (const run of r.runs) {
      let line = `  still ${f2(run.start)}s -> ${f2(run.end)}s  ${f2(run.seconds)}s`;
      if (run.required != null) line += `  needs ${f2(run.required)}s  dead air ${f2(run.deadAir)}s${run.deadAir > (gate.maxDead ?? 1) ? '  <- DEAD AIR' : ''}`;
      else if (gate.max != null && run.seconds > gate.max) line += '  <- OVER';
      console.log(line);
    }
    console.log(`  longest static run ${f2(r.longest)}s${r.deadAir != null ? `, worst dead air ${f2(r.deadAir)}s` : ''}`);
    for (const b of r.tooFast) {
      console.log(`  TOO FAST ${f2(b.start)}s-${f2(b.end)}s: on screen ${f2(b.seconds)}s, needs ${f2(b.required)}s  "${b.text.replace(/\n/g, ' / ')}"`);
    }
  }
  return { fail, reports };
}

function safezone(files) {
  let fail = false;
  const reports = [];
  for (const file of files) {
    const r = analyzeSafeZone(file, { channel: opt.channel || null });
    reports.push(r);
    if (r.intrusions.length) fail = true;
    if (opt.frames && r.intrusions.length) {
      mkdirSync(opt.frames, { recursive: true });
      r.frames = saveIntrusionFrames(r, opt.frames);
    }
    if (json) continue;
    console.log(`\n${name(file)}  ${CHANNELS[r.channel].label}: ${r.sampled} frames sampled; ${r.skippedBands} of ${r.sampled * 4} overlay bands held footage and were not judged`);
    if (!r.intrusions.length) console.log('  clear: nothing under the platform UI');
    r.intrusions.forEach((x, k) => console.log(`  INTRUDES ${x.side}: ${x.depth}px into the inset at ${f2(x.at)}s${r.frames ? `  -> ${r.frames[k]}` : ''}`));
  }
  return { fail, reports };
}

function render() {
  const [comp, out] = pos;
  if (!comp || !out) { console.error(HELP); process.exit(2); }
  const max = Number(opt.max ?? 5);
  execFileSync('npx', ['remotion', 'render', ...(opt.entry ? [opt.entry] : []), comp, out, '--log=error', ...passthrough], { stdio: 'inherit' });
  if (!existsSync(out)) { console.error(`render produced no file: ${out}`); process.exit(1); }
  const { fail } = pace([out], { max });
  if (fail) {
    const parked = out.replace(/\.mp4$/i, '') + '.failed-pace.mp4';
    rmSync(parked, { force: true });
    renameSync(out, parked);
    console.error(`\nPACE GATE FAILED (a static run over ${max}s). Moved to ${parked}`);
    console.error('A still frame is not automatically dead air: compare it to the text on screen');
    console.error('(remotion-qa pace --beats). Prefer staggering a reveal over trimming the beat.');
    process.exit(1);
  }
  console.log(`ok  ${out}`);
}

function floors() {
  const channel = opt.channel || 'reels-union';
  const fontFactor = Number(opt['font-factor'] || 1);
  const c = CHANNELS[channel];
  if (!c) { console.error(`unknown channel ${channel}`); process.exit(2); }
  console.log(`${c.label}, ${c.canvas.w}x${c.canvas.h}, floors for a ${DEVICES[DESIGNED_TO].label}${fontFactor !== 1 ? `, font factor ${fontFactor}` : ''}`);
  console.log(`safe area: inset T${c.insets.top} B${c.insets.bottom} L${c.insets.left} R${c.insets.right}`);
  for (const role of Object.keys(c.min)) {
    const px = minPx(role, { channel, fontFactor });
    console.log(`  ${role.padEnd(12)} ${String(px).padStart(4)}px  ${devicePt(px, { canvasWidth: c.canvas.w }).toFixed(1)}pt`);
  }
}

const finish = (res) => {
  if (json) console.log(JSON.stringify(res.length === 1 ? res[0] : res, null, 2));
  process.exit(res.some((r) => r.fail) ? 1 : 0);
};

switch (cmd) {
  case 'pace':
    if (!pos.length) break;
    finish([pace(pos, { max: opt.max != null ? Number(opt.max) : null, maxDead: opt['max-dead'] != null ? Number(opt['max-dead']) : null, tooFast: Boolean(opt.beats) && opt['max-dead'] != null })]);
    break;
  case 'safezone':
    if (!pos.length) break;
    finish([safezone(pos)]);
    break;
  case 'check':
    if (!pos.length) break;
    finish([pace(pos, { max: opt.max != null ? Number(opt.max) : null, maxDead: opt.beats ? Number(opt['max-dead'] ?? 1) : null, tooFast: Boolean(opt.beats) }), safezone(pos)]);
    break;
  case 'render':
    render();
    process.exit(0);
  case 'floors':
    floors();
    process.exit(0);
}
console.log(HELP);
process.exit(cmd && !['-h', '--help', 'help'].includes(cmd) ? 2 : 0);
