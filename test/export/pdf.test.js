import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { rgbFromRgba, sheetPdf } from '../../src/export/pdf.js';

// A small RGB ramp: widthPx × heightPx pixels, 3 bytes each.
function rgbRamp(widthPx, heightPx) {
  const rgb = new Uint8Array(widthPx * heightPx * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 7) & 255;
  return rgb;
}

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1'); // one char per byte: offsets stay byte offsets

// Parses the xref table: object number → byte offset (object 0 is the free head).
function xrefOffsets(bytes) {
  const text = latin1(bytes);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
  assert.equal(text.slice(start, start + 4), 'xref', 'startxref points at the xref table');
  const head = /^xref\n0 (\d+)\n/.exec(text.slice(start));
  const count = Number(head[1]);
  const entries = text.slice(start + head[0].length, start + head[0].length + count * 20).split('\n').filter(Boolean);
  assert.equal(entries.length, count);
  assert.ok(entries.every((e) => e.length === 19), 'every xref entry is 20 bytes including its EOL');
  return entries.map((e) => Number(e.slice(0, 10)));
}

// Inflates the image XObject (object 4) back to its RGB bytes.
function imageBytes(bytes, offsets) {
  const text = latin1(bytes);
  const dict = text.indexOf('stream\n', offsets[4]) + 'stream\n'.length;
  const len = Number(/\/Length (\d+)/.exec(text.slice(offsets[4], dict))[1]);
  return inflateSync(bytes.subarray(dict, dict + len));
}

test('sheetPdf is a single-page PDF 1.4 whose xref offsets all point at their objects', () => {
  const pdf = sheetPdf({ widthPx: 300, heightPx: 150, dpi: 300, rgbDeflated: deflateSync(rgbRamp(300, 150)) });
  const text = latin1(pdf);
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/Count 1 /);
  const offsets = xrefOffsets(pdf);
  for (let n = 1; n < offsets.length; n++) {
    assert.equal(text.slice(offsets[n], offsets[n] + `${n} 0 obj`.length), `${n} 0 obj`, `object ${n}`);
  }
});

test('letter at 300 dpi has a 612 × 792 pt MediaBox and draws the image over the whole page', () => {
  const pdf = sheetPdf({ widthPx: 2550, heightPx: 3300, dpi: 300, rgbDeflated: deflateSync(new Uint8Array(3)) });
  const text = latin1(pdf);
  assert.match(text, /\/MediaBox \[0 0 612 792\]/);
  assert.match(text, /q 612 0 0 792 0 0 cm \/Im0 Do Q/);
  assert.match(text, /\/Width 2550 \/Height 3300 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode/);
  assert.match(text, /\/PrintScaling \/None/);
});

test('the image stream inflates back to the input RGB bytes', () => {
  const rgb = rgbRamp(40, 20);
  const pdf = sheetPdf({ widthPx: 40, heightPx: 20, dpi: 72, rgbDeflated: deflateSync(rgb) });
  assert.deepEqual(Buffer.from(imageBytes(pdf, xrefOffsets(pdf))), Buffer.from(rgb));
});

test('the page size follows the dpi: 40 px at 72 dpi is 40 pt wide', () => {
  const pdf = sheetPdf({ widthPx: 40, heightPx: 20, dpi: 72, rgbDeflated: deflateSync(rgbRamp(40, 20)) });
  assert.match(latin1(pdf), /\/MediaBox \[0 0 40 20\]/);
});

test('rgbFromRgba keeps the colour channels and drops alpha', () => {
  const rgba = Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 0]);
  assert.deepEqual(rgbFromRgba(rgba), Uint8Array.from([1, 2, 3, 4, 5, 6]));
});
