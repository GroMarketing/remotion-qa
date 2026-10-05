import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzePace, analyzeSafeZone, requiredSeconds, parseSubtitles, minPx, devicePt, assertLegible } from '../src/index.mjs';
import { ffmpegPath } from '../src/ffmpeg.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remotion-qa-'));
const clip = (name) => path.join(dir, name);
const ff = (...args) => execFileSync(ffmpegPath(), ['-y', '-loglevel', 'error', ...args]);
const CREAM = 'color=c=0xF5F0E6:s=540x960:r=30';

before(() => {
  // 6s at 30fps: a dark block slides in over the first second, then nothing moves.
  ff('-f', 'lavfi', '-i', `${CREAM}:d=6`, '-f', 'lavfi', '-i', 'color=c=0x1A1A1A:s=200x60:r=30:d=6',
    '-filter_complex', "[0][1]overlay=x='min(t*170,170)':y=400", '-pix_fmt', 'yuv420p', clip('pace.mp4'));
  // A static block whose bottom edge sits in the bottom overlay (native y 1800-1880).
  ff('-f', 'lavfi', '-i', `${CREAM}:d=2`, '-vf', 'drawbox=x=100:y=900:w=300:h=40:color=0x1A1A1A:t=fill',
    '-pix_fmt', 'yuv420p', clip('intrude.mp4'));
  // The same block well inside the safe area.
  ff('-f', 'lavfi', '-i', `${CREAM}:d=2`, '-vf', 'drawbox=x=100:y=400:w=300:h=40:color=0x1A1A1A:t=fill',
    '-pix_fmt', 'yuv420p', clip('clean.mp4'));
  // Noise stands in for footage: no flat ground, so it must be skipped, not judged.
  ff('-f', 'lavfi', '-i', 'nullsrc=s=540x960:r=30:d=2,geq=random(1)*255:128:128', '-pix_fmt', 'yuv420p', clip('footage.mp4'));
});

test('requiredSeconds: longest line drives it, +0.4s per extra line, +1s settle', () => {
  assert.equal(requiredSeconds(''), 0);
  assert.equal(requiredSeconds('x'.repeat(30)), 3);
  assert.equal(requiredSeconds('x'.repeat(30) + '\nshort\nshort'), 3.8);
});

test('parseSubtitles reads SRT and WebVTT', () => {
  const srt = parseSubtitles('1\n00:00:01,000 --> 00:00:02,500\nHello\nworld\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n');
  assert.deepEqual(srt, [{ start: 1, end: 2.5, text: 'Hello\nworld' }, { start: 3, end: 4, text: 'Bye' }]);
  const vtt = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000 align:center\n<b>Hi</b>\n');
  assert.deepEqual(vtt, [{ start: 1, end: 2, text: 'Hi' }]);
});

test('pace finds the hold after the slide-in', () => {
  const r = analyzePace(clip('pace.mp4'));
  assert.equal(r.fps, 30);
  assert.equal(r.runs.length, 1);
  assert.ok(Math.abs(r.runs[0].start - 1) < 0.1, `run starts ${r.runs[0].start}`);
  assert.ok(r.longest > 4.8 && r.longest < 5.1, `longest ${r.longest}`);
});

test('pace separates reading time from dead air', () => {
  // 15 chars needs 2s, so of the 5s hold from t=1, about 2s is reading and the rest is dead.
  const r = analyzePace(clip('pace.mp4'), { beats: [{ start: 0, end: 6, text: 'fifteen chars!!' }] });
  assert.ok(Math.abs(r.runs[0].required - 2) < 1e-9);
  assert.ok(r.deadAir > 3.8 && r.deadAir < 4.1, `dead air ${r.deadAir}`);
  assert.equal(r.tooFast.length, 0);
});

test('pace flags a beat too short to read', () => {
  const r = analyzePace(clip('pace.mp4'), { beats: [{ start: 0, end: 1, text: 'a line far too long to read in a single second' }] });
  assert.equal(r.tooFast.length, 1);
  assert.ok(r.tooFast[0].short > 2);
});

test('safezone measures how far ink reaches into the bottom overlay', () => {
  const r = analyzeSafeZone(clip('intrude.mp4'));
  assert.equal(r.channel, 'reels-union');
  assert.equal(r.intrusions.length, 1);
  const [x] = r.intrusions;
  assert.equal(x.side, 'bottom');
  // ink reaches native y≈1880; the overlay starts at 1920-360=1560
  assert.ok(x.depth > 300 && x.depth < 340, `depth ${x.depth}`);
});

test('safezone passes content inside the safe area', () => {
  assert.equal(analyzeSafeZone(clip('clean.mp4')).intrusions.length, 0);
});

test('safezone skips footage instead of guessing', () => {
  const r = analyzeSafeZone(clip('footage.mp4'));
  assert.equal(r.skippedBands, r.sampled * 4);
  assert.equal(r.intrusions.length, 0);
});

test('a file named like an option is still treated as a file after --', () => {
  const odd = clip('--frames.mp4');
  fs.copyFileSync(clip('clean.mp4'), odd);
  const out = execFileSync(process.execPath, [path.resolve('bin/remotion-qa.mjs'), 'safezone', '--', odd], { encoding: 'utf8' });
  assert.match(out, /--frames\.mp4/);
  assert.match(out, /clear: nothing under the platform UI/);
});

test('inputs are opened as local files only', async () => {
  const { inputArgs } = await import('../src/ffmpeg.mjs');
  const a = inputArgs('concat:a.mp4|b.mp4');
  assert.deepEqual(a.slice(0, 3), ['-protocol_whitelist', 'file', '-i']);
  assert.match(a[3], /^file:\//);
});

test('type floors and device points', () => {
  assert.equal(minPx('hero'), 74);
  assert.equal(minPx('hero', { fontFactor: 1.08 }), 80);
  assert.equal(devicePt(90), 30);
  assert.throws(() => assertLegible(70, 'hero'), /under its 74px floor/);
  assert.equal(assertLegible(80, 'hero'), 80);
});
