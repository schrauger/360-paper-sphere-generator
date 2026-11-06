// UI state and events: the options form, three linked interactive previews and the render button.
// The heavy work happens in worker.js; this file only holds the orientation (rotation / viewRotation)
// and turns pointer drags into new rotations with src/interact/drag.js.
import { OptionError } from '../src/options.js';
import { MODEL_360CRAFT as model } from '../src/model/360craft.js';
import { totalRotation } from '../src/render/warp.js';
import { apply, equirectToDirection } from '../src/sphere/orient.js';
import { dragPhoto, orbitView, rollPhoto, userYPR } from '../src/interact/drag.js';
import { cliCommandFor, formToOptions } from './form.js';
import { SILHOUETTE_PRESETS, studio3Path } from '../src/layout/silhouette-presets.js';

const $ = (id) => document.getElementById(id);
const form = $('options');
const canvases = { panorama: $('panorama-view'), sheet: $('sheet-view'), globe: $('globe-view') };
const ROLL_DEG_PER_PX = 0.25;
const IDENTITY = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const ORIENTATION_FIELDS = ['yaw', 'pitch', 'roll'];

let rotation = totalRotation(model, { yaw: 0, pitch: 0, roll: 0 }); // band frame → panorama
let viewRotation = IDENTITY; // globe view space → band frame
let loaded = false;
let fileName = 'panorama.jpg';
let sheetMap = null; // { width, height, alpha, vec } of the current sheet preview
let inflight = false;
let dirty = false;
let rendering = false;

let worker = null;

// ---- options -------------------------------------------------------------------------------

function entries() {
  return Object.fromEntries(new FormData(form));
}

/** The form's RenderOptions, or null (with the message shown) when a field is invalid. */
function currentOptions() {
  try {
    const options = formToOptions(entries());
    $('form-error').textContent = '';
    return options;
  } catch (e) {
    if (!(e instanceof OptionError)) throw e;
    $('form-error').textContent = e.message;
    return null;
  }
}

// Show a conditional field only when its choice asks for it; hidden fields are disabled so FormData skips them.
function toggleField(wrapperId, inputIds, on) {
  $(wrapperId).hidden = !on;
  for (const id of inputIds) $(id).disabled = !on;
}

let savedMargin = null; // the user's margin while Silhouette marks force 10 mm

// ---- Silhouette preset sizes ---------------------------------------------------------------

const presetOptions = SILHOUETTE_PRESETS.letter.map((mm) => Object.assign(document.createElement('option'), {
  value: `preset-${mm}`, textContent: `${mm} mm · Silhouette cut file`,
}));
const isPresetMode = (mode) => mode.startsWith('preset-');

/** Preset diameters are offered only for Letter + Silhouette marks (and no 360craft preset); otherwise they are removed and a chosen preset size becomes the same size as a Custom diameter. */
function syncPresetChoices(presetSheet) {
  const select = $('diameterMode');
  const offer = !presetSheet && $('page').value === 'letter' && $('marks').value === 'silhouette';
  const listed = presetOptions[0].parentNode === select;
  if (offer && !listed) select.append(...presetOptions);
  else if (!offer && listed) {
    const chosen = isPresetMode(select.value) ? select.value.slice('preset-'.length) : null;
    presetOptions.forEach((o) => o.remove());
    if (chosen) {
      select.value = 'custom';
      $('diameter').value = chosen;
    }
  }
  const preset = isPresetMode(select.value);
  $('studio3-option').disabled = !preset;
  if (!preset && $('cutFile').value === 'studio3') $('cutFile').value = '';
}

const studio3Exists = new Map(); // repo-relative path → Promise<boolean>
function hasStudio3(path) {
  if (!studio3Exists.has(path)) {
    const url = new URL(`../${path}`, import.meta.url);
    studio3Exists.set(path, fetch(url, { method: 'HEAD' }).then((r) => r.ok, () => false));
  }
  return studio3Exists.get(path);
}

let studio3Token = 0;
/** Beside the sheet download: a link to the committed .studio3 for the chosen preset, or a note that it is not available yet. */
async function showStudio3() {
  const status = $('studio3-status');
  const mode = $('diameterMode').value;
  const wanted = $('cutFile').value === 'studio3' && isPresetMode(mode);
  const token = ++studio3Token;
  if (!wanted) {
    status.hidden = true;
    status.replaceChildren();
    return;
  }
  const path = studio3Path('letter', Number(mode.slice('preset-'.length)));
  const exists = await hasStudio3(path);
  if (token !== studio3Token) return;
  if (exists) {
    const name = path.split('/').pop();
    status.replaceChildren('Silhouette cut file: ', Object.assign(document.createElement('a'), {
      href: new URL(`../${path}`, import.meta.url).href, download: name, textContent: name,
    }));
  } else {
    status.textContent = "The Silhouette cut file for this size isn't available yet; use the SVG cut file instead.";
  }
  status.hidden = false;
}

function syncFormState() {
  const preset = $('preset').value !== '';
  const silhouette = $('marks').value === 'silhouette';
  syncPresetChoices(preset);
  for (const id of ['page', 'pageWidth', 'pageHeight', 'diameterMode', 'diameter']) $(id).disabled = preset;
  for (const button of document.querySelectorAll('[data-marks]')) {
    button.disabled = preset;
    button.setAttribute('aria-pressed', String(button.dataset.marks === $('marks').value));
  }
  toggleField('custom-page', ['pageWidth', 'pageHeight'], $('page').value === 'custom' && !preset);
  toggleField('custom-diameter', ['diameter'], $('diameterMode').value === 'custom' && !preset);
  // Spheres per sheet matters only with a chosen diameter (Largest is always one pair).
  toggleField('copies-field', ['copies'], $('diameterMode').value !== 'largest' && !preset);
  toggleField('custom-bleed', ['bleedMm'], $('bleedMode').value === 'mm');
  toggleField('custom-dpi', ['dpiCustom'], $('dpi').value === 'custom');
  const cutting = ['svg', 'dxf'].includes($('cutFile').value);
  $('ties').disabled = !cutting;
  $('ties-field').hidden = !cutting;
  toggleField('custom-tie', ['tieWidth'], cutting && $('ties').checked);
  toggleField('custom-quality', ['quality'], $('format').value === 'jpg');
  // Silhouette marks ignore the margin (10 mm); a preset ignores it too. Show that instead of the typed value.
  const marginFixed = silhouette || preset;
  if (silhouette && !preset && savedMargin === null) {
    savedMargin = $('margin').value;
    $('margin').value = '10';
  } else if (!(silhouette && !preset) && savedMargin !== null) {
    $('margin').value = savedMargin;
    savedMargin = null;
  }
  $('margin').disabled = marginFixed;
  $('margin-hint').hidden = !(silhouette && !preset);
  $('preset-hint').hidden = !preset;
}

function updateCliText() {
  const options = currentOptions();
  $('cli-text').value = options ? cliCommandFor(options, fileName) : '';
}

// ---- orientation fields (two-way) ----------------------------------------------------------

const fmt = (x) => String(Number(x.toFixed(2)) || 0); // 2 decimals, never "-0"

function showOrientation() {
  const ypr = userYPR(model, rotation);
  for (const name of ORIENTATION_FIELDS) {
    const field = $(name);
    if (document.activeElement !== field) field.value = fmt(ypr[name]);
    $(`${name}-range`).value = fmt(ypr[name]);
  }
}

function orientationFromFields() {
  const ypr = Object.fromEntries(ORIENTATION_FIELDS.map((name) => [name, $(name).value.trim() === '' ? 0 : Number($(name).value)]));
  if (Object.values(ypr).every(Number.isFinite)) rotation = totalRotation(model, ypr);
}

// Each dial is a number field (the one named input, typed values may exceed the range) and a range slider
// that mirrors it (the thumb clamps).
for (const name of ORIENTATION_FIELDS) {
  $(name).addEventListener('input', () => {
    $(`${name}-range`).value = $(name).value;
    orientationFromFields();
    orientationChanged();
  });
  $(`${name}-range`).addEventListener('input', () => {
    $(name).value = $(`${name}-range`).value;
    orientationFromFields();
    orientationChanged();
  });
}

function orientationChanged() {
  showOrientation();
  updateCliText();
  requestPreview();
}

// ---- previews ------------------------------------------------------------------------------

function requestPreview() {
  if (!loaded) return;
  if (inflight) {
    dirty = true;
    return;
  }
  const options = currentOptions();
  if (!options) return;
  inflight = true;
  worker.postMessage({
    type: 'preview', rotation, viewRotation, options,
    sizes: { sheet: { width: 600, height: 900 }, panoramaWidth: canvases.panorama.width, globeSize: canvases.globe.width },
  });
}

function drawFrame(canvas, bitmap) {
  if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
  if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
}

function previewDone() {
  inflight = false;
  if (dirty) {
    dirty = false;
    requestPreview();
  }
}

let lastDiameter = null;

function showDiameter(diameterMm, copies = 1) {
  const count = copies > 1 ? ` · ${copies} spheres on this sheet` : '';
  $('info').textContent = `Sphere diameter: ${diameterMm.toFixed(1)} mm${count}`;
  $('largest-option').textContent = `Largest (${diameterMm.toFixed(1)} mm)`;
  if ($('diameterMode').value === 'largest') lastDiameter = diameterMm;
}

function showWarnings(warnings) {
  const list = $('warnings');
  list.replaceChildren(...warnings.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
}

function handleMessage(event) {
  const m = event.data;
  if (m.type === 'preview-skipped') {
    previewDone();
  } else if (m.type === 'loaded') {
    loaded = true;
    $('drop').classList.add('loaded');
    const note = m.scaled ? ` Downscaled from ${m.sourceWidth}×${m.sourceHeight} to fit the browser's canvas limit.` : '';
    $('load-status').textContent = `${fileName}: ${m.width}×${m.height} px.${note}`;
    $('render').disabled = false;
    requestPreview();
  } else if (m.type === 'frames') {
    if (m.sheetMap) sheetMap = m.sheetMap;
    drawFrame(canvases.sheet, m.sheet);
    drawFrame(canvases.panorama, m.panorama);
    drawFrame(canvases.globe, m.globe);
    showDiameter(m.diameterMm, m.copies);
    showWarnings(m.warnings);
    $('render-error').textContent = '';
    previewDone();
  } else if (m.type === 'done') {
    finishRender(m).catch((e) => {
      setRendering(false);
      $('render-error').textContent = e.message;
    });
  } else if (m.type === 'error') {
    if (m.context === 'load') {
      loaded = false;
      $('drop').classList.remove('loaded');
      $('load-status').textContent = m.message;
      $('render').disabled = true;
    } else if (m.context === 'render') {
      setRendering(false);
      $('render-error').textContent = m.message;
    } else {
      $('render-error').textContent = m.message;
      previewDone();
    }
  }
}

// A worker that dies (out of memory, uncaught error) loses the decoded panorama: start a new one.
function workerFailed(message) {
  worker?.terminate();
  loaded = false;
  inflight = false;
  dirty = false;
  sheetMap = null;
  setRendering(false);
  $('render').disabled = true;
  $('render-error').textContent = `${message} Load the panorama again, or lower the DPI / use the CLI.`;
  startWorker();
}

function startWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = handleMessage;
  worker.onerror = (e) => {
    e.preventDefault?.();
    workerFailed(`The image worker stopped${e.message ? ` (${e.message})` : ''}.`);
  };
  worker.onmessageerror = () => workerFailed('The image worker sent an unreadable message.');
}
startWorker();
// ---- loading -------------------------------------------------------------------------------

function loadFile(file) {
  if (!file) return;
  fileName = file.name;
  loaded = false;
  sheetMap = null;
  $('load-status').textContent = `Loading ${file.name}…`;
  $('render-error').textContent = '';
  updateCliText();
  worker.postMessage({ type: 'load', file });
}

$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});

form.addEventListener('input', (e) => {
  if (e.target.id === 'diameterMode' && e.target.value === 'custom' && !$('diameter').value && lastDiameter) {
    $('diameter').value = String(Number(lastDiameter.toFixed(1)));
  }
  syncFormState();
  updateCliText();
  showStudio3();
  requestPreview();
});
for (const button of document.querySelectorAll('[data-marks]')) {
  button.addEventListener('click', () => {
    $('marks').value = button.dataset.marks;
    form.dispatchEvent(new Event('input'));
  });
}
form.addEventListener('submit', (e) => e.preventDefault());

// ---- dragging ------------------------------------------------------------------------------

/** Canvas pixel coordinates of a pointer event (the canvas is CSS-scaled). */
function canvasPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height];
}

// The band-frame axis through the middle of the globe view: Shift+drag and the roll slider turn the photo about it.
const rollAxis = () => apply(viewRotation, [0, 0, 1]);

const normalize = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

// Each view maps a canvas point to a unit vector (or null) and says what a drag from a to b does.
const views = {
  panorama: {
    point: (x, y, c) => equirectToDirection(x, y, c.width, c.height),
    drag: (a, b) => (rotation = dragPhoto(rotation, a, b)),
  },
  sheet: {
    point: (x, y) => {
      if (!sheetMap) return null;
      const i = Math.floor(x);
      const j = Math.floor(y);
      if (i < 0 || j < 0 || i >= sheetMap.width || j >= sheetMap.height) return null;
      const k = j * sheetMap.width + i;
      return sheetMap.alpha[k] >= 128 ? [sheetMap.vec[3 * k], sheetMap.vec[3 * k + 1], sheetMap.vec[3 * k + 2]] : null;
    },
    drag: (a, b) => (rotation = dragPhoto(rotation, a, b)),
  },
  globe: {
    // A view-space point on the visible hemisphere; outside the disk it is clamped to the rim.
    point: (x, y, c) => {
      const nx = (x / c.width) * 2 - 1;
      const ny = 1 - (y / c.height) * 2;
      const r2 = nx * nx + ny * ny;
      return r2 < 1 ? [nx, ny, Math.sqrt(1 - r2)] : normalize([nx, ny, 0]);
    },
    drag: (a, b) => {
      if ($('move-photo').checked) rotation = dragPhoto(rotation, apply(viewRotation, a), apply(viewRotation, b));
      else viewRotation = orbitView(viewRotation, a, b);
    },
  },
};

for (const [name, canvas] of Object.entries(canvases)) {
  const view = views[name];
  let last = null; // { p: previous unit vector, clientX }
  canvas.addEventListener('pointerdown', (e) => {
    if (!loaded || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    last = { p: view.point(...canvasPoint(canvas, e), canvas), clientX: e.clientX };
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last) return;
    if (e.shiftKey) {
      rotation = rollPhoto(rotation, rollAxis(), (e.clientX - last.clientX) * ROLL_DEG_PER_PX);
      last.clientX = e.clientX;
      last.p = view.point(...canvasPoint(canvas, e), canvas) ?? last.p;
    } else {
      const p = view.point(...canvasPoint(canvas, e), canvas);
      last.clientX = e.clientX;
      if (p && last.p) view.drag(last.p, p);
      if (p) last.p = p;
    }
    orientationChanged();
  });
  const end = (e) => {
    last = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// ---- roll slider, reset, copy ---------------------------------------------------------------

const slider = $('roll-slider');
let sliderValue = 0;
slider.addEventListener('input', () => {
  const value = Number(slider.value);
  rotation = rollPhoto(rotation, rollAxis(), value - sliderValue);
  sliderValue = value;
  orientationChanged();
});
slider.addEventListener('change', () => {
  slider.value = '0';
  sliderValue = 0;
});

$('reset').addEventListener('click', () => {
  rotation = totalRotation(model, { yaw: 0, pitch: 0, roll: 0 });
  viewRotation = IDENTITY;
  slider.value = '0';
  sliderValue = 0;
  for (const name of ORIENTATION_FIELDS) $(name).value = '0';
  orientationChanged();
});

$('copy-cli').addEventListener('click', async () => {
  updateCliText();
  const text = $('cli-text').value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    $('info').textContent = 'CLI command copied.';
  } catch {
    $('cli-text').select();
    $('info').textContent = 'Could not copy automatically; the command is selected below.';
  }
});

// ---- render & download ----------------------------------------------------------------------

function setRendering(on) {
  rendering = on;
  $('render').disabled = on || !loaded;
  $('render').textContent = on ? 'Rendering…' : 'Download sheet';
}

$('render').addEventListener('click', () => {
  const options = currentOptions();
  if (!options || rendering || !loaded) return;
  setRendering(true);
  $('render-error').textContent = '';
  $('downloads').textContent = '';
  downloadUrls.forEach((u) => URL.revokeObjectURL(u));
  downloadUrls = [];
  $('info').textContent = 'Rendering the full-resolution sheet…';
  worker.postMessage({ type: 'render', options });
});

let downloadUrls = [];

/** { url, name } of the chosen preset's .studio3 when ".studio3 (Silhouette)" is chosen and the file exists, else null. */
async function studio3Choice() {
  const mode = $('diameterMode').value;
  if ($('cutFile').value !== 'studio3' || !isPresetMode(mode)) return null;
  const path = studio3Path('letter', Number(mode.slice('preset-'.length)));
  if (!(await hasStudio3(path))) return null;
  return { url: new URL(`../${path}`, import.meta.url).href, name: path.split('/').pop() };
}

/** Start the download of a static file (like download() does for a blob) and return a link to it. */
function downloadUrl(url, name) {
  const a = Object.assign(document.createElement('a'), { href: url, download: name, textContent: name });
  document.body.append(a);
  a.click();
  a.remove();
  return Object.assign(document.createElement('a'), { href: url, download: name, textContent: name });
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  downloadUrls.push(url);
  const a = Object.assign(document.createElement('a'), { href: url, download: name, textContent: name });
  document.body.append(a);
  a.click();
  a.remove();
  return Object.assign(document.createElement('a'), { href: url, download: name, textContent: name });
}

const FORMATS = new Set(['pdf', 'png', 'jpg']);

async function finishRender({ blob, format, cutFile, diameterMm, copies, warnings }) {
  setRendering(false);
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'panorama';
  if (!FORMATS.has(format)) throw new Error(`Unexpected sheet format ${format || '(none)'}`);
  const links = [download(blob, `${base}-sheet.${format}`)];
  const studio3 = await studio3Choice();
  if (cutFile) {
    const type = cutFile.type === 'svg' ? 'image/svg+xml' : 'application/dxf';
    links.push(download(new Blob([cutFile.content], { type }), `${base}-sheet.${cutFile.type}`));
  }
  if (studio3) links.push(downloadUrl(studio3.url, studio3.name));
  showDiameter(diameterMm, copies);
  $('downloads').replaceChildren('Downloaded: ', ...links.flatMap((a, i) => (i ? [' · ', a] : [a])));
  showWarnings(warnings);
}

// ---- start ----------------------------------------------------------------------------------

$('render').disabled = true;
syncFormState();
showOrientation();
updateCliText();
