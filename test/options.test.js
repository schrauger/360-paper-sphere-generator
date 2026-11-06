import test from 'node:test';
import assert from 'node:assert/strict';
import { OptionError, PAGE_SIZES, checkAspect, normalizeOptions } from '../src/options.js';

test('defaults', () => {
  assert.deepEqual(normalizeOptions({}), {
    preset: null,
    page: { widthMm: 215.9, heightMm: 279.4 },
    dpi: 300,
    diameterMm: null,
    marginMm: 6.35,
    outline: true,
    bleedMm: 'auto',
    marks: 'none',
    orientation: { yaw: 0, pitch: 0, roll: 0 },
    format: 'pdf',
    jpegQuality: 92,
    copies: 'max',
    cutFile: null,
    tieMm: null,
  });
  assert.deepEqual(normalizeOptions(), normalizeOptions({}));
  assert.deepEqual(PAGE_SIZES.a4, [210, 297]);
});

test('custom page "200x300mm", named pages, and string numbers', () => {
  assert.deepEqual(normalizeOptions({ page: '200x300mm' }).page, { widthMm: 200, heightMm: 300 });
  assert.deepEqual(normalizeOptions({ page: 'A4' }).page, { widthMm: 210, heightMm: 297 });
  const o = normalizeOptions({ dpi: '150', diameterMm: '120.5', bleed: '1.5', orientation: { yaw: '10', pitch: -20, roll: 0 } });
  assert.deepEqual([o.dpi, o.diameterMm, o.bleedMm, o.orientation.yaw, o.orientation.pitch], [150, 120.5, 1.5, 10, -20]);
  assert.equal(normalizeOptions({ bleed: 'auto' }).bleedMm, 'auto');
  assert.equal(normalizeOptions({ bleed: 'off' }).bleedMm, 0);
});

const rejects = (raw, flag) => assert.throws(() => normalizeOptions(raw), (e) => e instanceof OptionError && e.message.includes(flag), flag);

test('bad values throw OptionError naming the option', () => {
  rejects({ page: 'foolscap' }, '--page');
  rejects({ page: '0x300mm' }, '--page');
  rejects({ page: 'constructor' }, '--page');
  rejects({ page: '__proto__' }, '--page');
  rejects({ preset: 'huge' }, '--preset');
  rejects({ dpi: 71 }, '--dpi');
  rejects({ dpi: 'abc' }, '--dpi');
  rejects({ diameterMm: 0 }, '--diameter');
  rejects({ bleed: -1 }, '--bleed');
  rejects({ bleed: 'wide' }, '--bleed');
  rejects({ bleed: NaN }, '--bleed');
  rejects({ marks: 'cricut' }, '--marks');
  rejects({ cutFile: 'pdf' }, '--cut-file');
  rejects({ format: 'gif' }, '--format');
  rejects({ jpegQuality: 0 }, '--quality');
  rejects({ orientation: { yaw: NaN } }, '--yaw');
  rejects({ orientation: { pitch: 'up' } }, '--pitch');
});

test('format is pdf, png or jpg', () => {
  for (const format of ['pdf', 'png', 'jpg']) assert.equal(normalizeOptions({ format }).format, format);
});

test('marginMm must be finite and ≥ 0', () => {
  rejects({ marginMm: -1 }, '--margin');
  rejects({ marginMm: Infinity }, '--margin');
  assert.equal(normalizeOptions({ marginMm: 0 }).marginMm, 0);
});

test('checkAspect', () => {
  assert.deepEqual(checkAspect(4000, 2000), { ok: true, width: 4000, height: 2000 });
  assert.deepEqual(checkAspect(4020, 2000), { ok: true, width: 4010, height: 2005 });
  assert.deepEqual(checkAspect(3000, 1000), { ok: false, message: 'Panorama must be 2:1 (got 3000×1000)' });
  assert.equal(checkAspect(4041, 2000).ok, false);
});

test('ties: off by default, true = 0.5 mm, width 0.1-3 mm', () => {
  assert.equal(normalizeOptions({}).tieMm, null);
  assert.equal(normalizeOptions({ ties: false }).tieMm, null);
  assert.equal(normalizeOptions({ ties: true }).tieMm, 0.5);
  assert.equal(normalizeOptions({ ties: '1.5' }).tieMm, 1.5);
  assert.throws(() => normalizeOptions({ ties: 0.05 }), /--tie-width/);
  assert.throws(() => normalizeOptions({ ties: 3.5 }), /--tie-width/);
  assert.throws(() => normalizeOptions({ ties: 'wide' }), /--tie-width/);
});

test('copies: max by default, whole numbers ≥ 1 otherwise', () => {
  assert.equal(normalizeOptions({ copies: 'max' }).copies, 'max');
  assert.equal(normalizeOptions({ copies: '3' }).copies, 3);
  assert.equal(normalizeOptions({ copies: '' }).copies, 'max');
  for (const bad of ['0', '1.5', '-2', 'many']) assert.throws(() => normalizeOptions({ copies: bad }), /--copies/, bad);
});
