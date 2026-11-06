import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OptionError, normalizeOptions } from '../../src/options.js';
import { cliCommandFor, formToOptions } from '../../web/form.js';

const FULL = {
  preset: '', page: 'a4', pageWidth: '', pageHeight: '', dpi: '150', diameter: '120', margin: '10',
  outline: 'on', bleedMode: 'mm', bleedMm: '1.5', marks: 'silhouette', yaw: '-42', pitch: '10.5', roll: '3',
  format: 'jpg', quality: '80', cutFile: 'svg',
};

test('formToOptions maps every form field; checkbox absence = false', () => {
  const o = formToOptions(FULL);
  assert.deepEqual(o, {
    preset: null, page: { widthMm: 210, heightMm: 297 }, dpi: 150, diameterMm: 120, marginMm: 10, outline: true,
    bleedMm: 1.5, marks: 'silhouette', orientation: { yaw: -42, pitch: 10.5, roll: 3 }, format: 'jpg', jpegQuality: 80, cutFile: 'svg',
  });
  const { outline, ...noOutline } = FULL;
  assert.equal(formToOptions(noOutline).outline, false);
  assert.equal(formToOptions({ ...FULL, preset: 'original-low' }).preset, 'original-low');
  assert.equal(formToOptions({ ...FULL, bleedMode: 'auto' }).bleedMm, 'auto');
  assert.equal(formToOptions({ ...FULL, bleedMode: 'off' }).bleedMm, 0);
  assert.deepEqual(formToOptions({ ...FULL, page: 'custom', pageWidth: '200', pageHeight: '300' }).page, { widthMm: 200, heightMm: 300 });
  // Blank fields are defaults.
  assert.deepEqual(formToOptions({ outline: 'on' }), normalizeOptions({}));
});

test('formToOptions reports the offending option', () => {
  assert.throws(() => formToOptions({ ...FULL, dpi: '5000' }), (e) => e instanceof OptionError && /--dpi/.test(e.message));
  assert.throws(() => formToOptions({ ...FULL, page: 'custom', pageWidth: '', pageHeight: '' }), /--page/);
  assert.throws(() => formToOptions({ ...FULL, bleedMode: 'mm', bleedMm: '-1' }), /--bleed/);
});

// Parses a cliCommandFor string back into normalizeOptions input (the CLI's own flag semantics).
function parseCommand(cmd) {
  const t = cmd.split(' ');
  assert.equal(t[0], 'paper-sphere');
  const raw = { orientation: {}, outline: true };
  let out;
  for (let i = 2; i < t.length; i++) {
    const flag = t[i];
    const next = () => t[++i];
    if (flag === '-o') out = next();
    else if (flag === '--no-outline') raw.outline = false;
    else if (flag === '--diameter') raw.diameterMm = next();
    else if (flag === '--margin') raw.marginMm = next();
    else if (flag === '--quality') raw.jpegQuality = next();
    else if (flag === '--cut-file') raw.cutFile = next();
    else if (['--yaw', '--pitch', '--roll'].includes(flag)) raw.orientation[flag.slice(2)] = next();
    else raw[flag.slice(2)] = next();
  }
  raw.format = /\.(\w+)$/.exec(out)[1];
  return normalizeOptions(raw);
}

test('cliCommandFor omits defaults and round-trips through normalizeOptions', () => {
  assert.equal(cliCommandFor(normalizeOptions({}), 'photo.jpg'), 'paper-sphere photo.jpg -o sheet.pdf');
  assert.equal(cliCommandFor(normalizeOptions({ format: 'png' }), 'photo.jpg'), 'paper-sphere photo.jpg -o sheet.png');
  assert.equal(
    cliCommandFor(normalizeOptions({ outline: false, bleed: 'auto', orientation: { yaw: 42 } }), 'photo.jpg'),
    'paper-sphere photo.jpg -o sheet.pdf --no-outline --bleed auto --yaw 42',
  );
  const cases = [
    formToOptions(FULL),
    normalizeOptions({ preset: 'original-high', dpi: 600, bleed: 2, orientation: { pitch: -20, roll: -5.25 } }),
    normalizeOptions({ page: { widthMm: 200, heightMm: 300 }, format: 'jpg' }),
    normalizeOptions({ page: 'letter', bleed: 'off', marks: 'none', cutFile: 'dxf' }),
  ];
  for (const options of cases) {
    const cmd = cliCommandFor(options, 'photo.jpg');
    const back = parseCommand(cmd);
    if (options.preset) Object.assign(back, { page: options.page, diameterMm: options.diameterMm, marginMm: options.marginMm, marks: options.marks });
    assert.deepEqual(back, options, cmd);
  }
  assert.match(cliCommandFor(normalizeOptions({ preset: 'original-low', page: 'a3' }), 'a.png'), /^paper-sphere a\.png -o sheet\.pdf --preset original-low$/);
});

test('cliCommandFor quotes awkward input names and writes negative numbers as separate tokens', () => {
  const cmd = cliCommandFor(normalizeOptions({ orientation: { yaw: -42, pitch: -20 } }), "my pano's.jpg");
  assert.equal(cmd, "paper-sphere 'my pano'\\''s.jpg' -o sheet.pdf --yaw -42 --pitch -20");
});
