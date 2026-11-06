import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    bleedMm: 1.5, marks: 'silhouette', orientation: { yaw: -42, pitch: 10.5, roll: 3 }, format: 'jpg', jpegQuality: 80, cutFile: 'svg', tieMm: null,
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

test('bleed defaults to auto in the form and the select lists Auto first and selected', async () => {
  assert.equal(formToOptions({ outline: 'on' }).bleedMm, 'auto');
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const select = /<select id="bleedMode"[^>]*>([\s\S]*?)<\/select>/.exec(html)[1];
  assert.match(select, /^\s*<option value="auto" selected>Auto<\/option>\s*<option value="off">Off<\/option>/);
});

test('formToOptions: diameter and resolution choice controls', () => {
  assert.equal(formToOptions({ ...FULL, diameterMode: 'largest' }).diameterMm, null);
  assert.equal(formToOptions({ ...FULL, diameterMode: 'custom' }).diameterMm, 120);
  assert.equal(formToOptions({ ...FULL, dpi: '1200' }).dpi, 1200);
  assert.equal(formToOptions({ ...FULL, dpi: 'custom', dpiCustom: '450' }).dpi, 450);
  assert.equal(formToOptions({ ...FULL, dpi: 'custom' }).dpi, 300);
  assert.throws(() => formToOptions({ ...FULL, dpi: 'custom', dpiCustom: '5000' }), /--dpi/);
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
    else if (flag === '--ties') raw.ties = true;
    else if (flag === '--tie-width') raw.ties = next();
    else if (['--yaw', '--pitch', '--roll'].includes(flag)) raw.orientation[flag.slice(2)] = next();
    else raw[flag.slice(2)] = next();
  }
  raw.format = /\.(\w+)$/.exec(out)[1];
  return normalizeOptions(raw);
}

test('cliCommandFor omits defaults and round-trips through normalizeOptions', () => {
  assert.equal(cliCommandFor(normalizeOptions({}), 'photo.jpg'), 'paper-sphere photo.jpg -o sheet.pdf');
  assert.equal(cliCommandFor(normalizeOptions({ bleed: 'off' }), 'photo.jpg'), 'paper-sphere photo.jpg -o sheet.pdf --bleed off');
  assert.equal(cliCommandFor(normalizeOptions({ bleed: 1.5 }), 'photo.jpg'), 'paper-sphere photo.jpg -o sheet.pdf --bleed 1.5');
  assert.equal(cliCommandFor(normalizeOptions({ format: 'png' }), 'photo.jpg'), 'paper-sphere photo.jpg -o sheet.png');
  assert.equal(
    cliCommandFor(normalizeOptions({ outline: false, bleed: 'auto', orientation: { yaw: 42 } }), 'photo.jpg'),
    'paper-sphere photo.jpg -o sheet.pdf --no-outline --yaw 42',
  );
  const cases = [
    formToOptions(FULL),
    normalizeOptions({ preset: 'original-high', dpi: 600, bleed: 2, orientation: { pitch: -20, roll: -5.25 } }),
    normalizeOptions({ page: { widthMm: 200, heightMm: 300 }, format: 'jpg' }),
    normalizeOptions({ page: 'letter', bleed: 'off', marks: 'none', cutFile: 'dxf' }),
    normalizeOptions({ cutFile: 'svg', ties: true }),
    normalizeOptions({ cutFile: 'svg', ties: 1.25 }),
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

test('formToOptions: a Silhouette preset diameter sets diameterMm; studio3 is web-only', () => {
  const o = formToOptions({ page: 'letter', marks: 'silhouette', diameterMode: 'preset-50', diameter: '', cutFile: 'studio3' });
  assert.equal(o.diameterMm, 50);
  assert.equal(o.cutFile, null);
  assert.equal(o.marks, 'silhouette');
  assert.equal(formToOptions({ diameterMode: 'preset-62', cutFile: 'svg' }).cutFile, 'svg');
  assert.throws(() => formToOptions({ diameterMode: 'preset-abc' }), OptionError);
});

test('cliCommandFor: a Silhouette preset size is --page letter --marks silhouette --diameter, no studio3 flag', () => {
  const o = formToOptions({ page: 'letter', marks: 'silhouette', diameterMode: 'preset-50', cutFile: 'studio3', outline: 'on' });
  assert.equal(cliCommandFor(o, 'p.jpg'), 'paper-sphere p.jpg -o sheet.pdf --page letter --diameter 50 --marks silhouette');
});

test('ties: checkbox and width map to tieMm, and cliCommandFor writes --ties or --tie-width', () => {
  assert.equal(formToOptions({ outline: 'on' }).tieMm, null);
  assert.equal(formToOptions({ ties: 'on', tieWidth: '' }).tieMm, 0.5);
  assert.equal(formToOptions({ ties: 'on', tieWidth: '1.2' }).tieMm, 1.2);
  assert.equal(formToOptions({ tieWidth: '1.2' }).tieMm, null);
  assert.equal(cliCommandFor(normalizeOptions({ cutFile: 'svg', ties: true }), 'a.jpg'), 'paper-sphere a.jpg -o sheet.pdf --cut-file svg --ties');
  assert.equal(cliCommandFor(normalizeOptions({ cutFile: 'svg', ties: '1.2' }), 'a.jpg'), 'paper-sphere a.jpg -o sheet.pdf --cut-file svg --tie-width 1.2');
  assert.throws(() => formToOptions({ ties: 'on', tieWidth: '5' }), OptionError);
});
