// UI state and events: the options form, three linked interactive previews and the render button.
// The heavy work happens in worker.js; this file only holds the orientation (rotation / viewRotation)
// and turns pointer drags into new rotations with src/interact/drag.js.
import { OptionError } from '../src/options.js';
import { MODEL_360CRAFT as model } from '../src/model/360craft.js';
import { totalRotation } from '../src/render/warp.js';
import { apply, equirectToDirection } from '../src/sphere/orient.js';
import { dragPhoto, orbitView, rollPhoto, userYPR } from '../src/interact/drag.js';
import { cliCommandFor, formToOptions } from './form.js';

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

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

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

function syncFormState() {
  const preset = $('preset').value !== '';
  $('page-fields').disabled = preset;
  $('custom-page').hidden = $('page').value !== 'custom';
  $('bleedMm').disabled = $('bleedMode').value !== 'mm';
  $('quality').disabled = $('format').value !== 'jpg';
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
  }
}

function orientationFromFields() {
  const ypr = Object.fromEntries(ORIENTATION_FIELDS.map((name) => [name, $(name).value.trim() === '' ? 0 : Number($(name).value)]));
  if (Object.values(ypr).every(Number.isFinite)) rotation = totalRotation(model, ypr);
}

for (const name of ORIENTATION_FIELDS) $(name).addEventListener('input', orientationFromFields);

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

function showWarnings(warnings) {
  const list = $('warnings');
  list.replaceChildren(...warnings.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
}

worker.onmessage = (event) => {
  const m = event.data;
  if (m.type === 'loaded') {
    loaded = true;
    const note = m.scaled ? ` Downscaled from ${m.sourceWidth}×${m.sourceHeight} to fit the browser's canvas limit.` : '';
    $('load-status').textContent = `${fileName}: ${m.width}×${m.height} px.${note}`;
    $('render').disabled = false;
    requestPreview();
  } else if (m.type === 'frames') {
    if (m.sheetMap) sheetMap = m.sheetMap;
    drawFrame(canvases.sheet, m.sheet);
    drawFrame(canvases.panorama, m.panorama);
    drawFrame(canvases.globe, m.globe);
    $('info').textContent = `Sphere diameter: ${m.diameterMm.toFixed(1)} mm`;
    showWarnings(m.warnings);
    $('render-error').textContent = '';
    previewDone();
  } else if (m.type === 'done') {
    finishRender(m);
  } else if (m.type === 'error') {
    if (m.context === 'load') {
      loaded = false;
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
};

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

form.addEventListener('input', () => {
  syncFormState();
  updateCliText();
  requestPreview();
});
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
  $('render').textContent = on ? 'Rendering…' : 'Render & download';
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

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  downloadUrls.push(url);
  const a = Object.assign(document.createElement('a'), { href: url, download: name, textContent: name });
  document.body.append(a);
  a.click();
  a.remove();
  return Object.assign(document.createElement('a'), { href: url, download: name, textContent: name });
}

function finishRender({ blob, cutFile, diameterMm, warnings }) {
  setRendering(false);
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'panorama';
  const links = [download(blob, `${base}-sheet.${blob.type === 'image/png' ? 'png' : 'jpg'}`)];
  if (cutFile) {
    const type = cutFile.type === 'svg' ? 'image/svg+xml' : 'application/dxf';
    links.push(download(new Blob([cutFile.content], { type }), `${base}-sheet.${cutFile.type}`));
  }
  $('info').textContent = `Sphere diameter: ${diameterMm.toFixed(1)} mm. Downloaded:`;
  $('downloads').replaceChildren(...links.flatMap((a, i) => (i ? [' · ', a] : [a])));
  showWarnings(warnings);
}

// ---- start ----------------------------------------------------------------------------------

$('render').disabled = true;
syncFormState();
showOrientation();
updateCliText();
