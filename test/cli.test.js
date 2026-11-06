import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'paper-sphere-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

// A colourful RGB gradient of the given size, written as `name`.
async function makeInput(name, w, h, { channels = 3, depth } = {}) {
  const buf = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < channels; c++) buf[(y * w + x) * channels + c] = ((x * 255) / w + c * 60 + y) % 256;
  let img = sharp(buf, { raw: { width: w, height: h, channels } });
  if (depth === 16) img = img.toColourspace('rgb16');
  const file = join(dir, name);
  await img.toFile(file);
  return file;
}
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('--page letter --dpi 72 → 612×792 PNG with density 72', async () => {
  const input = await makeInput('a.png', 256, 128);
  const out = join(dir, 'a-out.png');
  const r = run(input, '-o', out, '--page', 'letter', '--dpi', '72');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Sphere diameter: \d+\.\d mm/);
  const m = await sharp(out).metadata();
  assert.deepEqual([m.width, m.height, m.density], [612, 792, 72]);
});

test('--preset original-low → 2850×4160', async () => {
  const input = await makeInput('b.png', 512, 256);
  const out = join(dir, 'b-out.png');
  const r = run(input, '-o', out, '--preset', 'original-low');
  assert.equal(r.status, 0, r.stderr);
  const m = await sharp(out).metadata();
  assert.deepEqual([m.width, m.height], [2850, 4160]);
});

test('3:1 input → exit 2 with "must be 2:1", no stack trace', async () => {
  const input = await makeInput('c.png', 300, 100);
  const r = run(input, '-o', join(dir, 'c-out.png'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Panorama must be 2:1 \(got 300×100\)/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('bad options and unreadable input → exit 2, message only', async () => {
  const input = await makeInput('d.png', 64, 32);
  for (const args of [['--page', 'foolscap'], ['--dpi', '10'], ['--bleed', 'x'], ['--page', '20x20mm', '--marks', 'silhouette'], ['--nope']]) {
    const r = run(input, '-o', join(dir, 'd-out.png'), ...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
  const missing = run(join(dir, 'missing.png'), '-o', join(dir, 'd-out.png'));
  assert.equal(missing.status, 2);
  assert.equal(run().status, 2);
});

test('64×32 input renders without error', async () => {
  const input = await makeInput('e.png', 64, 32);
  const out = join(dir, 'e-out.png');
  const r = run(input, '-o', out, '--dpi', '72');
  assert.equal(r.status, 0, r.stderr);
  const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const colours = new Set();
  for (let i = 0; i < data.length; i += 3 * 97) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  assert.ok(colours.size > 3, 'not blank');
});

test('grayscale, RGBA with transparency and 16-bit PNG all render to 8-bit sRGB', async () => {
  const gray = await makeInput('g.png', 128, 64, { channels: 1 });
  const rgba = await makeInput('t.png', 128, 64, { channels: 4 });
  const deep = await makeInput('h.png', 128, 64, { depth: 16 });
  assert.equal((await sharp(deep).metadata()).depth, 'ushort');
  for (const input of [gray, rgba, deep]) {
    const out = `${input}-out.png`;
    const r = run(input, '-o', out, '--dpi', '72');
    assert.equal(r.status, 0, `${input}: ${r.stderr}`);
    const m = await sharp(out).metadata();
    assert.deepEqual([m.depth, m.space, m.channels], ['uchar', 'srgb', 3]);
  }
});

test('--cut-file svg writes out.svg next to out.png', async () => {
  const input = await makeInput('s.png', 64, 32);
  const out = join(dir, 's-out.png');
  const r = run(input, '-o', out, '--dpi', '72', '--cut-file', 'svg', '--marks', 'silhouette', '--bleed', 'auto', '--no-outline', '--yaw', '30');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, 's-out.svg'), 'utf8'), /^<svg /);
  assert.ok(!existsSync(join(dir, 's-out.dxf')));
  const dxf = run(input, '-o', out, '--dpi', '72', '--cut-file', 'dxf');
  assert.equal(dxf.status, 0, dxf.stderr);
  assert.match(readFileSync(join(dir, 's-out.dxf'), 'utf8'), /ENTITIES/);
});

test('--bleed larger than the supported width is limited with a warning', async () => {
  const input = await makeInput('w.png', 64, 32);
  const r = run(input, '-o', join(dir, 'w-out.png'), '--dpi', '72', '--bleed', '50');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Bleed limited to \d+\.\d+ mm/);
});

test('.jpg output with --quality 80 is JPEG', async () => {
  const input = await makeInput('j.png', 64, 32);
  const out = join(dir, 'j-out.jpg');
  const r = run(input, '-o', out, '--dpi', '72', '--quality', '80');
  assert.equal(r.status, 0, r.stderr);
  const m = await sharp(out).metadata();
  assert.deepEqual([m.format, m.density], ['jpeg', 72]);
});

test('--margin -1 → exit 2 naming --margin; --margin=-1 reaches the option check', async () => {
  const input = await makeInput('m.png', 64, 32);
  const out = join(dir, 'm-out.png');
  const spaced = run(input, '-o', out, '--margin', '-1');
  assert.equal(spaced.status, 2);
  assert.match(spaced.stderr, /--margin/);
  assert.doesNotMatch(spaced.stderr, /\n\s+at /);
  const equals = run(input, '-o', out, '--margin=-1');
  assert.equal(equals.status, 2);
  assert.match(equals.stderr, /--margin must be ≥ 0 mm \(got -1\)/);
});

test('output in a missing directory → exit 1, message only, no stack trace', async () => {
  const input = await makeInput('n.png', 64, 32);
  const r = run(input, '-o', join(dir, 'no-such-dir', 'n-out.png'), '--dpi', '72');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unable to (open|write)|No such file/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('negative yaw, pitch and roll given as separate tokens render with exit 0', async () => {
  const input = await makeInput('neg.png', 256, 128);
  const out = join(dir, 'neg-out.png');
  const r = run(input, '-o', out, '--dpi', '72', '--yaw', '-42', '--pitch', '-20', '--roll', '-5');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /ambiguous/);
});

test('--margin -1 with a separate token reports the margin range error, not "ambiguous"', async () => {
  const input = await makeInput('mr.png', 64, 32);
  const r = run(input, '-o', join(dir, 'mr-out.png'), '--margin', '-1');
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /ambiguous/);
  assert.match(r.stderr, /--margin must be ≥ 0 mm \(got -1\)/);
});
