import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { fitDecodeSize, setJpegDpi, setPngDpi, tooLargeForCanvas } from '../../web/imageio.js';

test('fitDecodeSize(12000, 6000) → ≤ 16,777,216 px, 2:1, scaled true; (4000, 2000) unscaled', () => {
  const big = fitDecodeSize(12000, 6000);
  assert.ok(big.width * big.height <= 16_777_216);
  assert.equal(big.width, 2 * big.height);
  assert.equal(big.scaled, true);
  assert.ok((big.height + 1) * (big.height + 1) * 2 > 16_777_216, 'largest such size');
  assert.deepEqual(fitDecodeSize(4000, 2000), { width: 4000, height: 2000, scaled: false });
});

test('fitDecodeSize: resamples within 1% of 2:1, rejects other aspects, handles tiny and custom limits', () => {
  const near = fitDecodeSize(4010, 2000);
  assert.equal(near.width, 2 * near.height);
  assert.throws(() => fitDecodeSize(3000, 1000), /Panorama must be 2:1 \(got 3000×1000\)/);
  assert.deepEqual(fitDecodeSize(64, 32), { width: 64, height: 32, scaled: false });
  const small = fitDecodeSize(4000, 2000, 1_000_000);
  assert.ok(small.width * small.height <= 1_000_000 && small.width === 2 * small.height && small.scaled);
});

test('tooLargeForCanvas flags oversized sheets only', () => {
  assert.equal(tooLargeForCanvas(5700, 8320), false);
  assert.equal(tooLargeForCanvas(40000, 100), true);
  assert.equal(tooLargeForCanvas(20000, 20000), true);
});

// Reads a PNG's chunks: [{ type, data, crcOk }].
function pngChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let o = 8; o < bytes.length;) {
    const len = view.getUint32(o);
    const type = Buffer.from(bytes.subarray(o + 4, o + 8)).toString('latin1');
    const crcOk = view.getUint32(o + 8 + len) === crc32(bytes.subarray(o + 4, o + 8 + len));
    out.push({ type, data: bytes.subarray(o + 8, o + 8 + len), crcOk });
    o += 12 + len;
  }
  return out;
}

const pHYsOf = (c) => {
  const v = new DataView(c.data.buffer, c.data.byteOffset, 9);
  return [v.getUint32(0), v.getUint32(4), v.getUint8(8)];
};

async function samplePng() {
  return new Uint8Array(await sharp({ create: { width: 4, height: 3, channels: 3, background: '#789' } }).png().toBuffer());
}

test('setPngDpi: a re-read pHYs gives 11811 px/m for 300 dpi and the CRC is valid', async () => {
  const out = setPngDpi(await samplePng(), 300);
  const chunks = pngChunks(out);
  const phys = chunks.filter((c) => c.type === 'pHYs');
  assert.equal(phys.length, 1);
  assert.deepEqual(pHYsOf(phys[0]), [11811, 11811, 1]);
  assert.ok(chunks.every((c) => c.crcOk), 'all CRCs valid');
  assert.ok(chunks.findIndex((c) => c.type === 'pHYs') < chunks.findIndex((c) => c.type === 'IDAT'), 'before IDAT');
  assert.equal(chunks[0].type, 'IHDR');
  const meta = await sharp(out).metadata();
  assert.equal(meta.density, 300);
  assert.deepEqual(await sharp(out).raw().toBuffer(), await sharp(await samplePng()).raw().toBuffer());
});

test('setPngDpi replaces an existing pHYs rather than adding a second', async () => {
  const once = setPngDpi(await samplePng(), 72);
  const twice = setPngDpi(once, 600);
  const phys = pngChunks(twice).filter((c) => c.type === 'pHYs');
  assert.equal(phys.length, 1);
  assert.deepEqual(pHYsOf(phys[0]), [23622, 23622, 1]);
  assert.ok(pngChunks(twice).every((c) => c.crcOk));
});

test('setPngDpi works on a hand-built PNG and rejects non-PNG data', () => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 0, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 255]))), chunk('IEND', Buffer.alloc(0))]);
  const out = pngChunks(setPngDpi(new Uint8Array(png), 300));
  assert.deepEqual(out.map((c) => c.type), ['IHDR', 'pHYs', 'IDAT', 'IEND']);
  assert.ok(out.every((c) => c.crcOk));
  assert.throws(() => setPngDpi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 300), /Not a PNG/);
});

// JFIF APP0 density of a JPEG: { units, x, y } or null.
function jfifDensity(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let o = 2; o + 4 <= bytes.length && bytes[o] === 0xff;) {
    const marker = bytes[o + 1];
    const len = view.getUint16(o + 2);
    if (marker === 0xe0 && Buffer.from(bytes.subarray(o + 4, o + 9)).toString('latin1') === 'JFIF\0') {
      return { units: bytes[o + 11], x: view.getUint16(o + 12), y: view.getUint16(o + 14), length: len };
    }
    o += 2 + len;
  }
  return null;
}

async function sampleJpeg() {
  return new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#789' } }).jpeg().toBuffer());
}

test('setJpegDpi inserts an APP0 when the file has none: density reads back 300×300 with units 1', async () => {
  const src = await sampleJpeg();
  assert.equal(jfifDensity(src), null, 'sharp writes no JFIF header');
  const out = setJpegDpi(src, 300);
  assert.deepEqual(jfifDensity(out), { units: 1, x: 300, y: 300, length: 16 });
  assert.equal(out.length, src.length + 18);
  assert.equal((await sharp(out).metadata()).density, 300);
  assert.deepEqual(await sharp(out).raw().toBuffer(), await sharp(src).raw().toBuffer());
  assert.throws(() => setJpegDpi(new Uint8Array([1, 2, 3, 4]), 300), /Not a JPEG/);
});

test('setJpegDpi: JFIF density reads back 300×300 with units 1 when patching an existing APP0', async () => {
  const src = await sampleJpeg();
  // A JFIF header as browsers write it: units 0 (aspect ratio only), density 1×1.
  const app0 = Uint8Array.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const browser = new Uint8Array(Buffer.concat([src.subarray(0, 2), app0, src.subarray(2)]));
  assert.deepEqual(jfifDensity(browser), { units: 0, x: 1, y: 1, length: 16 });
  const out = setJpegDpi(browser, 300);
  assert.deepEqual(jfifDensity(out), { units: 1, x: 300, y: 300, length: 16 });
  assert.equal(out.length, browser.length);
  assert.equal((await sharp(out).metadata()).density, 300);
  assert.equal(browser[13], 0, 'input not modified');
});

test('setPngDpi rejects a truncated file, including a partial trailing chunk', async () => {
  const png = await samplePng();
  assert.throws(() => setPngDpi(png.subarray(0, png.length - 5), 300), /Truncated PNG/);
  assert.throws(() => setPngDpi(png.subarray(0, png.length - 12 + 4), 300), /Truncated PNG/);
});
