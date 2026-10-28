// Rack Panel Generator: UI, 3D preview and STEP download.
import * as THREE from '../vendor/three/three.module.js';
import * as C from './panel-core.js';

const $ = (id) => document.getElementById(id);
const ids = ['u', 'holes', 'holeAlign', 'radius', 'chamfer', 'chamferFaces', 'holeChamfer', 'holeChamferFaces',
  'width', 'pitch', 'thickness', 'holeD', 'travel', 'clearance'];
const STORE = 'rack-panel-generator:v2';
const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toString();

// earcut triangulation (via three.js) for the flat front and back faces of the preview mesh
const triangulate = (outer, holes) => {
  const V = (a) => a.map(([x, y]) => new THREE.Vector2(x, y));
  return THREE.ShapeUtils.triangulateShape(V(outer), holes.map(V));
};

// ---------- settings ----------
function readOpts() {
  const o = {};
  for (const k of ids) { const el = $(k); o[k] = el.tagName === 'SELECT' ? el.value : parseFloat(el.value); }
  return o;
}
function writeOpts(o) { for (const k of ids) if (o[k] !== undefined && $(k)) $(k).value = o[k]; }
try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved) writeOpts(saved); } catch { /* storage unavailable */ }

let current = null; // { p, name }
const fileBase = (p) => `rack-panel-${fmt(p.u, 1)}U-${fmt(p.W, 1)}mm`;
function setStatus(t, cls) { const s = $('status'); s.textContent = t; s.className = 'status' + (cls ? ' ' + cls : ''); }

function update() {
  const o = readOpts();
  try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* ignore */ }
  const p = C.resolve(o);
  $('holes').max = p.maxHoles;
  $('alignField').hidden = p.holeY.length !== 1 || p.maxHoles < 2;
  $('holesHint').textContent = p.maxHoles
    ? `Up to ${p.maxHoles} per side fit at ${fmt(p.u, 1)}U, on the standard 10-inch hole heights.`
    : 'No hole position fits at this size.';

  const sum = $('sum');
  sum.replaceChildren();
  const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; sum.append(dt, dd); };
  add('Panel', `${fmt(p.W)} × ${fmt(p.H)} × ${fmt(p.T)} mm`);
  add('Holes', p.holeY.length ? `${p.holeY.length} per side at y = ${p.holeY.map((y) => fmt(y)).join(', ')} mm` : 'none');
  add('Slots', p.holeY.length
    ? `Ø${fmt(p.rho * 2)} mm, ${p.L > 0 ? `±${fmt(p.L)} mm travel` : 'round'}, centres ${fmt(p.pitch)} mm apart`
      + (p.hc > 0 ? `, ${fmt(p.hc)} mm chamfer (${p.hfaces === 'both' ? 'both sides' : p.hfaces + ' only'})` : '')
    : '–');
  add('Edges', `R${fmt(p.r)} corners, ${p.c > 0 ? `${fmt(p.c)} mm chamfer (${p.faces === 'both' ? 'front and back' : p.faces + ' only'})` : 'no chamfer'}`);
  add('Volume', `${fmt(C.volume(p) / 1000, 1)} cm³`);
  $('dims').textContent = `${fmt(p.W)} × ${fmt(p.H)} × ${fmt(p.T)} mm`;

  const msgs = $('msgs');
  msgs.replaceChildren();
  for (const w of p.warnings) { const li = document.createElement('li'); li.textContent = w; msgs.append(li); }
  for (const e of p.errors) { const li = document.createElement('li'); li.className = 'err'; li.textContent = e; msgs.append(li); }

  const ok = p.errors.length === 0;
  $('dl').disabled = !ok;
  $('copy').disabled = !ok;
  if (!ok) { current = null; setStatus('Fix the settings above to export.', 'err'); clearMesh(); return; }
  current = { p, name: fileBase(p) };
  setStatus('', '');
  $('fallback').hidden = true;
  let mesh = null;
  try { mesh = C.buildMesh(p, triangulate); } catch { mesh = null; }
  showMesh(p, mesh);
}

let tmr = null;
const schedule = () => { clearTimeout(tmr); tmr = setTimeout(update, 60); };
for (const k of ids) { $(k).addEventListener('input', schedule); $(k).addEventListener('change', update); }
document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
  const el = $(b.dataset.step);
  const d = parseFloat(b.dataset.d);
  let v = (parseFloat(el.value) || 0) + d;
  if (el.min !== '') v = Math.max(parseFloat(el.min), v);
  if (el.max !== '' && d > 0) v = Math.min(parseFloat(el.max), v);
  el.value = v;
  update();
}));
$('reset').addEventListener('click', () => { writeOpts(C.DEFAULTS); update(); });

// ---------- export ----------
function buildStepOrReport() {
  try { return C.buildStep(current.p, current.name); } catch (e) { setStatus(e.message, 'err'); return null; }
}
$('dl').addEventListener('click', () => {
  if (!current) return;
  const step = buildStepOrReport();
  if (!step) return;
  const url = URL.createObjectURL(new Blob([step], { type: 'application/step' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = current.name + '.step';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setStatus(`Downloaded ${current.name}.step`, 'ok');
});
$('copy').addEventListener('click', async () => {
  if (!current) return;
  const step = buildStepOrReport();
  if (!step) return;
  try {
    await navigator.clipboard.writeText(step);
    setStatus(`Copied. Paste it into a file named ${current.name}.step.`, 'ok');
  } catch {
    const ta = $('fallback'); ta.value = step; ta.hidden = false; ta.focus(); ta.select();
    setStatus(`Clipboard blocked. The text is selected below: copy it into ${current.name}.step.`, '');
  }
});

// ---------- 3D preview ----------
const stage = $('stage');
let renderer = null, scene, camera, group, meshObj = null, edgeObj = null, matMesh, matEdge;
const cam = { theta: -0.5, phi: 1.15, dist: 400, target: { x: 0, y: 0, z: 0 } };
const setTarget = (x, y, z) => { cam.target.x = x; cam.target.y = y; cam.target.z = z; };
let fitDist = 400, curView = 'iso';

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function applyTheme() {
  if (!renderer) return;
  renderer.setClearColor(new THREE.Color(cssVar('--bg') || '#15181c'), 1);
  matMesh.color.set(cssVar('--model') || '#9aa7b4');
  matEdge.color.set(cssVar('--edge') || '#2b323a');
  draw();
}

try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
  // three.js uses physically based light units, so these intensities carry a factor of pi
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.75 * Math.PI));
  const key = new THREE.DirectionalLight(0xffffff, 0.7 * Math.PI); key.position.set(-1, 1.4, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35 * Math.PI); rim.position.set(2, -1, -1.5); scene.add(rim);
  group = new THREE.Group();
  scene.add(group);
  matMesh = new THREE.MeshStandardMaterial({ color: 0x9aa7b4, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  matEdge = new THREE.LineBasicMaterial({ color: 0x2b323a });
} catch {
  renderer = null;
  $('nogl').hidden = false;
}

function clearMesh() {
  if (!group) return;
  if (meshObj) { group.remove(meshObj); meshObj.geometry.dispose(); meshObj = null; }
  if (edgeObj) { group.remove(edgeObj); edgeObj.geometry.dispose(); edgeObj = null; }
  draw();
}
function showMesh(p, mesh) {
  if (!renderer) return;
  clearMesh();
  if (!mesh) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  meshObj = new THREE.Mesh(g, matMesh);
  edgeObj = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), matEdge);
  group.add(meshObj, edgeObj);
  const ratio = showMesh.done ? cam.dist / fitDist : 1;
  computeFit(p);
  if (curView !== 'edge') { setTarget(0, p.H / 2, p.T / 2); cam.dist = fitDist * ratio; }
  showMesh.done = true;
  applyTheme();
}

// distance at which the whole panel fits, from both the vertical and the horizontal field of view
function computeFit(p) {
  if (!camera) return;
  const vt = Math.tan((camera.fov * Math.PI / 180) / 2);
  const ht = vt * camera.aspect;
  fitDist = Math.max((p.W / 2) / ht, (p.H / 2) / vt) * 1.18 + p.T;
}
function resize() {
  if (!renderer) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  const ratio = cam.dist / fitDist;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  if (current) { computeFit(current.p); if (curView !== 'edge') cam.dist = fitDist * ratio; }
  draw();
}
function draw() {
  if (!renderer || !camera) return;
  const d = cam.dist, sp = Math.sin(cam.phi);
  camera.position.set(cam.target.x + d * sp * Math.sin(cam.theta), cam.target.y + d * Math.cos(cam.phi), cam.target.z + d * sp * Math.cos(cam.theta));
  camera.up.set(0, 1, 0);
  camera.lookAt(cam.target.x, cam.target.y, cam.target.z);
  renderer.render(scene, camera);
}

const VIEWS = { iso: [-0.5, 1.15], front: [0, Math.PI / 2], back: [Math.PI, Math.PI / 2], edge: [0.75, 1.05] };
const markView = (v) => document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
function setView(v, zoom) {
  const [t, ph] = VIEWS[v];
  cam.theta = t; cam.phi = ph; curView = v;
  if (v === 'edge' && current) {
    const p = current.p;
    // close-up of the right-hand slot nearest the bottom, or the corner when there are no holes
    if (p.holeY.length) setTarget(p.pitch / 2 + 3, p.holeY[0], p.T / 2);
    else setTarget(p.W / 2 - Math.max(p.r, 6), Math.max(p.r, 6), p.T / 2);
    cam.dist = Math.max(45, 6 * p.T + 4 * Math.max(p.r, 6));
  } else {
    if (current) setTarget(0, current.p.H / 2, current.p.T / 2);
    if (zoom) cam.dist = fitDist;
  }
  markView(v);
  draw();
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view, true)));

// pointer controls: left-drag orbits, middle-drag (or Shift + left-drag) pans, wheel and pinch zoom
const ptrs = new Map();
let pinch0 = 0, dist0 = 0, panning = false;
stage.addEventListener('pointerdown', (e) => {
  if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
  panning = e.button === 1 || (e.button === 0 && e.shiftKey);
  stage.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { panning = false; const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = cam.dist; }
});
stage.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
stage.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

// move the orbit target in the screen plane so the model follows the cursor 1:1 at the target depth
function pan(dx, dy) {
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const s = 2 * cam.dist * Math.tan((camera.fov * Math.PI / 180) / 2) / Math.max(1, stage.clientHeight);
  setTarget(cam.target.x - (right.x * dx - up.x * dy) * s, cam.target.y - (right.y * dx - up.y * dy) * s, cam.target.z - (right.z * dx - up.z * dy) * s);
}
stage.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId) || !renderer) return;
  const prev = ptrs.get(e.pointerId);
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 1 && panning) {
    pan(e.clientX - prev[0], e.clientY - prev[1]);
    markView(null); curView = 'free';
  } else if (ptrs.size === 1) {
    cam.theta -= (e.clientX - prev[0]) * 0.008;
    cam.phi = Math.min(Math.PI - 0.05, Math.max(0.05, cam.phi - (e.clientY - prev[1]) * 0.008));
    markView(null); if (curView !== 'edge') curView = 'free';
  } else if (ptrs.size === 2 && pinch0) {
    const [a, b] = [...ptrs.values()];
    const now = Math.hypot(a[0] - b[0], a[1] - b[1]);
    cam.dist = Math.min(fitDist * 4, Math.max(fitDist * 0.08, dist0 * pinch0 / Math.max(1, now)));
  }
  draw();
});
const release = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0; if (!ptrs.size) panning = false; };
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = Math.min(fitDist * 4, Math.max(fitDist * 0.08, cam.dist * Math.exp(e.deltaY * 0.0012)));
  draw();
}, { passive: false });
stage.addEventListener('dblclick', () => setView('iso', true));

new ResizeObserver(resize).observe(stage);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

update();
resize();
setView('iso', true);
