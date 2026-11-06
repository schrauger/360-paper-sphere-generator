// A single-page PDF holding the sheet as one RGB image at its physical size. Pure (no node imports):
// the caller compresses the pixels (Node: zlib.deflateSync; browser: CompressionStream('deflate')).

const encoder = new TextEncoder();
const pt = (x) => String(Number(x.toFixed(4))); // points, trimmed of float noise

/** RGBA bytes (4 per pixel, as renderSheet returns) → RGB bytes (3 per pixel); alpha is dropped. */
export function rgbFromRgba(data) {
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return rgb;
}

/**
 * A PDF 1.4 Uint8Array: one page whose MediaBox is the sheet's size in points (px / dpi × 72), with
 * the image (widthPx × heightPx, DeviceRGB, 8 bits, FlateDecode) drawn over all of it. rgbDeflated is
 * the zlib-compressed RGB bytes (rgbFromRgba, then deflate). Viewers print the page at 100%.
 */
export function sheetPdf({ widthPx, heightPx, dpi, rgbDeflated }) {
  if (![widthPx, heightPx].every((n) => Number.isInteger(n) && n > 0)) throw new RangeError('sheetPdf needs a positive integer size');
  const w = pt((widthPx / dpi) * 72);
  const h = pt((heightPx / dpi) * 72);
  const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`);

  const chunks = [];
  let length = 0;
  const put = (part) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const offsets = []; // offsets[n] is the byte offset of object n
  const object = (n, body) => {
    offsets[n] = length;
    put(`${n} 0 obj\n`);
    for (const part of body) put(part);
    put('\nendobj\n');
  };
  const stream = (dict, data) => [`<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream'];

  put('%PDF-1.4\n');
  put(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary comment: marks the file as binary
  object(1, ['<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>']);
  object(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  object(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>`]);
  object(4, stream(`/Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, rgbDeflated));
  object(5, stream('', content));

  const xrefAt = length;
  const size = offsets.length; // objects 0…5
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  put(xref);
  put(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
