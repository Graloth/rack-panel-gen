/**
 * Rack panel generator core: settings -> validated geometry -> STEP (AP214 B-rep) and a preview mesh.
 *
 * Coordinates: X across the panel (centred on 0), Y up (0 = panel bottom), Z through the thickness
 * (0 = back face, T = front face). All lengths in millimetres.
 *
 * The STEP output is exact geometry: planes, cylinders and cones bounded by line and circle edges,
 * written as one MANIFOLD_SOLID_BREP. No CAD kernel is needed at runtime.
 */

const U_MM = 44.45;
const EIA_IN_U = [6.35, 22.225, 38.1]; // hole heights above each U boundary

const DEFAULTS = {
  u: 1, holes: 2, holeAlign: 'middle', radius: 5, chamfer: 0.5, chamferFaces: 'both',
  holeChamfer: 0, holeChamferFaces: 'both',
  width: 306, pitch: 286, thickness: 4, holeD: 5.5, travel: 1.5, clearance: 0.8,
};

// ---------- parameters ----------
function resolve(input) {
  const o = Object.assign({}, DEFAULTS, input || {});
  const warnings = [];
  const errors = [];
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  let u = Math.max(0.5, Math.round(num(o.u, 1) * 2) / 2);
  const W = Math.max(20, num(o.width, 306));
  const T = Math.max(0.6, num(o.thickness, 4));
  const clr = Math.max(0, num(o.clearance, 0.8));
  const H = u * U_MM - clr;
  const pitch = num(o.pitch, 286);
  const d = Math.max(1, num(o.holeD, 5.5));
  const rho = d / 2;
  const L = Math.max(0, num(o.travel, 1.5));
  const faces = ['both', 'front', 'back'].includes(o.chamferFaces) ? o.chamferFaces : 'both';
  const hfaces = ['both', 'front', 'back'].includes(o.holeChamferFaces) ? o.holeChamferFaces : 'both';
  const align = ['top', 'middle', 'bottom'].includes(o.holeAlign) ? o.holeAlign : 'middle';

  let c = Math.max(0, num(o.chamfer, 0.5));
  if (c > 0 && c > T / 2 - 0.05) { c = Math.max(0, +(T / 2 - 0.05).toFixed(2)); warnings.push(`Chamfer reduced to ${c} mm so the side wall keeps some height.`); }
  let r = Math.max(0, num(o.radius, 5));
  const rMax = Math.min(W, H) / 2 - 0.05;
  if (r > rMax) { r = +rMax.toFixed(2); warnings.push(`Corner radius reduced to ${r} mm to fit the panel height.`); }
  if (r > 0 && c > 0 && r <= c + 0.05) { r = +(c + 0.1).toFixed(2); warnings.push(`Corner radius raised to ${r} mm; it has to be larger than the chamfer.`); }

  let hc = Math.max(0, num(o.holeChamfer, 0));
  const hcMax = (hfaces === 'both' ? T / 2 : T) - 0.3;
  if (hc > hcMax) { hc = Math.max(0, +hcMax.toFixed(2)); warnings.push(`Hole chamfer reduced to ${hc} mm so the hole keeps a straight section.`); }
  const rhoOut = rho + hc;          // widest point of a hole, at a chamfered face

  // candidate EIA positions that fit inside the panel with margin
  const margin = c + 1.0;
  const cands = [];
  for (let k = 0; k < Math.ceil(u) + 1; k++) {
    for (const h of EIA_IN_U) {
      const y = k * U_MM + h - clr / 2;          // in panel coordinates
      if (y - rhoOut >= margin && y + rhoOut <= H - margin) cands.push(+y.toFixed(4));
    }
  }
  let n = Math.max(0, Math.round(num(o.holes, 2)));
  if (n > cands.length) { warnings.push(`Only ${cands.length} hole position${cands.length === 1 ? '' : 's'} per side fit a ${u}U panel.`); n = cands.length; }
  let holeY = [];
  if (n === 1) holeY = [cands[align === 'bottom' ? 0 : align === 'top' ? cands.length - 1 : Math.floor((cands.length - 1) / 2)]];
  else if (n > 1) {
    const idx = new Set();
    for (let i = 0; i < n; i++) idx.add(Math.round(i * (cands.length - 1) / (n - 1)));
    holeY = [...idx].sort((a, b) => a - b).map((i) => cands[i]);
  }

  const p = { u, W, H, T, r, c, faces, pitch, rho, L, hc, hfaces, align, clr, holeY, maxHoles: cands.length, warnings, errors };

  // slots must sit fully inside the outline with a margin
  if (holeY.length) {
    const outer = pitch / 2 + L + rhoOut;
    if (pitch / 2 - L - rhoOut <= 0) errors.push('The slot pitch is too small: the slots overlap the panel centre.');
    for (const y of holeY) for (const sx of [-pitch / 2, pitch / 2]) {
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * 2 * Math.PI;
        const px = sx + Math.sign(Math.cos(a)) * L + rhoOut * Math.cos(a);
        const py = y + rhoOut * Math.sin(a);
        if (!insideOutline(p, px, py, c + 0.8)) { errors.push(`A slot at x = ±${(pitch / 2).toFixed(2)} mm runs into the panel edge or corner (outer slot edge at ${outer.toFixed(2)} mm, panel half-width ${(W / 2).toFixed(2)} mm).`); break; }
      }
      if (errors.length) break;
    }
  }
  return p;
}

function insideOutline(p, x, y, inset) {
  const { W, H, r } = p;
  const ax = Math.abs(x);
  if (ax > W / 2 - inset || y < inset || y > H - inset) return false;
  if (r <= 0) return true;
  const cx = W / 2 - r, cyLo = r, cyHi = H - r;
  if (ax > cx && (y < cyLo || y > cyHi)) {
    const cy = y < cyLo ? cyLo : cyHi;
    return Math.hypot(ax - cx, y - cy) <= r - inset;
  }
  return true;
}

// ---------- topology ----------
// A loop is a closed CCW (about +Z) list of segments; each segment runs from verts[i] to verts[i+1].
function perimeterLoop(p, off) {
  const { W, H, r } = p;
  if (r <= 0) {
    const v = [[-W / 2 + off, off], [W / 2 - off, off], [W / 2 - off, H - off], [-W / 2 + off, H - off]];
    return { verts: v, segs: v.map((_, i) => ({ kind: 'line' })) };
  }
  const BR = [W / 2 - r, r], TR = [W / 2 - r, H - r], TL = [-W / 2 + r, H - r], BL = [-W / 2 + r, r];
  const v = [
    [-W / 2 + r, off], [W / 2 - r, off], [W / 2 - off, r], [W / 2 - off, H - r],
    [W / 2 - r, H - off], [-W / 2 + r, H - off], [-W / 2 + off, H - r], [-W / 2 + off, r],
  ];
  const segs = [
    { kind: 'line' }, { kind: 'arc', c: BR, rad: r - off, base: r },
    { kind: 'line' }, { kind: 'arc', c: TR, rad: r - off, base: r },
    { kind: 'line' }, { kind: 'arc', c: TL, rad: r - off, base: r },
    { kind: 'line' }, { kind: 'arc', c: BL, rad: r - off, base: r },
  ];
  return { verts: v, segs };
}

function slotLoop(sx, sy, L, rho) {
  if (L <= 0) {
    return {
      verts: [[sx, sy - rho], [sx, sy + rho]],
      segs: [{ kind: 'arc', c: [sx, sy], rad: rho }, { kind: 'arc', c: [sx, sy], rad: rho }],
    };
  }
  return {
    verts: [[sx - L, sy - rho], [sx + L, sy - rho], [sx + L, sy + rho], [sx - L, sy + rho]],
    segs: [{ kind: 'line' }, { kind: 'arc', c: [sx + L, sy], rad: rho }, { kind: 'line' }, { kind: 'arc', c: [sx - L, sy], rad: rho }],
  };
}

// Perimeter levels bottom to top: [z, inset]
function perimeterLevels(p) {
  const { T, c, faces } = p;
  const back = c > 0 && (faces === 'both' || faces === 'back');
  const front = c > 0 && (faces === 'both' || faces === 'front');
  const lv = [];
  if (back) lv.push([0, c], [c, 0]); else lv.push([0, 0]);
  if (front) lv.push([T - c, 0], [T, c]); else lv.push([T, 0]);
  return lv;
}

// Hole levels bottom to top: [z, enlargement]; a chamfer widens the hole at the face
function slotLevels(p) {
  const { T, hc, hfaces } = p;
  const back = hc > 0 && (hfaces === 'both' || hfaces === 'back');
  const front = hc > 0 && (hfaces === 'both' || hfaces === 'front');
  const lv = [];
  if (back) lv.push([0, hc], [hc, 0]); else lv.push([0, 0]);
  if (front) lv.push([T - hc, 0], [T, hc]); else lv.push([T, 0]);
  return lv;
}
function slotSpecs(p) {
  const out = [];
  for (const y of p.holeY) for (const sx of [-p.pitch / 2, p.pitch / 2]) out.push({ sx, sy: y });
  return out;
}
// per hole: one loop per level, bottom to top
function slots(p) {
  const lv = slotLevels(p);
  return slotSpecs(p).map(({ sx, sy }) => lv.map(([z, off]) => ({ z, off, lp: slotLoop(sx, sy, p.L, p.rho + off) })));
}

// ---------- STEP ----------
function f(v) {
  if (Math.abs(v) < 1e-12) return '0.';
  let s = String(Number(v.toPrecision(15)));
  if (/e/i.test(s)) {
    const [m, e] = v.toExponential(12).split('e');
    let mm = String(Number(m)); if (!mm.includes('.')) mm += '.';
    const ee = +e;
    return `${mm}E${ee < 0 ? '-' : '+'}${String(Math.abs(ee)).padStart(2, '0')}`;
  }
  if (!s.includes('.')) s += '.';
  return s;
}

function buildStep(p, name) {
  if (p.errors.length) throw new Error(p.errors.join(' '));
  const L = [];
  let id = 0;
  const add = (s) => { id++; L.push(`#${id}=${s};`); return `#${id}`; };
  const pt = (x, y, z) => add(`CARTESIAN_POINT('',(${f(x)},${f(y)},${f(z)}))`);
  const dir = (x, y, z) => { const n = Math.hypot(x, y, z); return add(`DIRECTION('',(${f(x / n)},${f(y / n)},${f(z / n)}))`); };
  const ax2 = (o, a, r) => add(`AXIS2_PLACEMENT_3D('',${pt(...o)},${dir(...a)},${dir(...r)})`);
  const vtx = (x, y, z) => add(`VERTEX_POINT('',${pt(x, y, z)})`);
  const lineEdge = (va, vb, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const ln = add(`LINE('',${pt(...a)},${add(`VECTOR('',${dir(dx, dy, dz)},${f(len)})`)})`);
    return add(`EDGE_CURVE('',${va},${vb},${ln},.T.)`);
  };
  const arcEdge = (va, vb, c, z, rad) => {
    const circ = add(`CIRCLE('',${ax2([c[0], c[1], z], [0, 0, 1], [1, 0, 0])},${f(rad)})`);
    return add(`EDGE_CURVE('',${va},${vb},${circ},.T.)`);
  };
  const oe = (e, s) => add(`ORIENTED_EDGE('',*,*,${e},${s ? '.T.' : '.F.'})`);
  const loop = (list) => add(`EDGE_LOOP('',(${list.join(',')}))`);
  const face = (bounds, surf, sense) => add(`ADVANCED_FACE('',(${bounds.join(',')}),${surf},${sense ? '.T.' : '.F.'})`);
  const outerB = (lp) => add(`FACE_OUTER_BOUND('',${lp},.T.)`);
  const innerB = (lp) => add(`FACE_BOUND('',${lp},.T.)`);

  // header entities
  const appCtx = add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appCtx})`);
  const prodCtx = add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const prod = add(`PRODUCT('${name}','${name}','',(${prodCtx}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const pdCtx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${pdCtx})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const mm = add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
  const rad = add(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
  const sr = add(`( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`);
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = add(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`);

  // build edges for a loop at height z (with an inset loop object)
  const buildLoopEdges = (lp, z) => {
    const vs = lp.verts.map(([x, y]) => vtx(x, y, z));
    const es = lp.segs.map((s, i) => {
      const j = (i + 1) % lp.verts.length;
      const a = [...lp.verts[i], z], b = [...lp.verts[j], z];
      return s.kind === 'line' ? lineEdge(vs[i], vs[j], a, b) : arcEdge(vs[i], vs[j], s.c, z, s.rad);
    });
    return { lp, z, vs, es };
  };
  const ribs = (lo, hi) => lo.vs.map((v, i) => lineEdge(v, hi.vs[i], [...lo.lp.verts[i], lo.z], [...hi.lp.verts[i], hi.z]));

  const faces = [];
  const levels = perimeterLevels(p);
  const per = levels.map(([z, off]) => buildLoopEdges(perimeterLoop(p, off), z));
  const sl = slots(p).map((levelsOfHole) => levelsOfHole.map(({ z, off, lp }) => Object.assign(buildLoopEdges(lp, z), { off })));

  // front face (+Z)
  const top = per[per.length - 1];
  {
    const bounds = [outerB(loop(top.es.map((e) => oe(e, true))))];
    for (const s of sl) bounds.push(innerB(loop(s[s.length - 1].es.slice().reverse().map((e) => oe(e, false)))));
    faces.push(face(bounds, add(`PLANE('',${ax2([0, 0, p.T], [0, 0, 1], [1, 0, 0])})`), true));
  }
  // back face (-Z)
  {
    const bot = per[0];
    const bounds = [outerB(loop(bot.es.slice().reverse().map((e) => oe(e, false))))];
    for (const s of sl) bounds.push(innerB(loop(s[0].es.map((e) => oe(e, true)))));
    faces.push(face(bounds, add(`PLANE('',${ax2([0, 0, 0], [0, 0, -1], [1, 0, 0])})`), true));
  }
  // perimeter bands
  const Q = Math.PI / 4;
  for (let k = 0; k < per.length - 1; k++) {
    const lo = per[k], hi = per[k + 1];
    const offLo = levels[k][1], offHi = levels[k + 1][1];
    const kind = offLo === offHi ? 'wall' : (offLo > offHi ? 'chamferBottom' : 'chamferTop');
    const rb = ribs(lo, hi);
    const n = lo.es.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const lp = loop([oe(lo.es[i], true), oe(rb[j], true), oe(hi.es[i], false), oe(rb[i], false)]);
      const seg = lo.lp.segs[i];
      let surf;
      if (seg.kind === 'line') {
        const a = lo.lp.verts[i], b = lo.lp.verts[j];
        const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy);
        const d = [dx / dl, dy / dl, 0], nrm = [d[1], -d[0], 0];
        const nz = kind === 'wall' ? 0 : (kind === 'chamferBottom' ? -1 : 1);
        surf = add(`PLANE('',${ax2([a[0], a[1], lo.z], [nrm[0], nrm[1], nz], d)})`);
      } else if (kind === 'wall') {
        surf = add(`CYLINDRICAL_SURFACE('',${ax2([seg.c[0], seg.c[1], 0], [0, 0, 1], [1, 0, 0])},${f(seg.base)})`);
      } else if (kind === 'chamferBottom') {
        surf = add(`CONICAL_SURFACE('',${ax2([seg.c[0], seg.c[1], hi.z], [0, 0, 1], [1, 0, 0])},${f(seg.base)},${f(Q)})`);
      } else {
        surf = add(`CONICAL_SURFACE('',${ax2([seg.c[0], seg.c[1], lo.z], [0, 0, -1], [1, 0, 0])},${f(seg.base)},${f(Q)})`);
      }
      faces.push(face([outerB(lp)], surf, true));
    }
  }
  // hole walls and hole chamfers
  for (const s of sl) {
    for (let k = 0; k < s.length - 1; k++) {
      const lo = s[k], hi = s[k + 1];
      const kind = lo.off === hi.off ? 'wall' : (lo.off > hi.off ? 'chamferBottom' : 'chamferTop');
      const rb = ribs(lo, hi);
      const n = lo.es.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const lp = loop([oe(lo.es[i], false), oe(rb[i], true), oe(hi.es[i], true), oe(rb[j], false)]);
        const seg = lo.lp.segs[i];
        if (seg.kind === 'line') {
          const a = lo.lp.verts[i], b = lo.lp.verts[j];
          const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy);
          const d = [dx / dl, dy / dl, 0];
          const nz = kind === 'wall' ? 0 : (kind === 'chamferBottom' ? -1 : 1);
          faces.push(face([outerB(lp)], add(`PLANE('',${ax2([a[0], a[1], lo.z], [-d[1], d[0], nz], d)})`), true));
        } else if (kind === 'wall') {
          faces.push(face([outerB(lp)], add(`CYLINDRICAL_SURFACE('',${ax2([seg.c[0], seg.c[1], 0], [0, 0, 1], [1, 0, 0])},${f(p.rho)})`), false));
        } else if (kind === 'chamferBottom') {
          faces.push(face([outerB(lp)], add(`CONICAL_SURFACE('',${ax2([seg.c[0], seg.c[1], hi.z], [0, 0, -1], [1, 0, 0])},${f(p.rho)},${f(Q)})`), false));
        } else {
          faces.push(face([outerB(lp)], add(`CONICAL_SURFACE('',${ax2([seg.c[0], seg.c[1], lo.z], [0, 0, 1], [1, 0, 0])},${f(p.rho)},${f(Q)})`), false));
        }
      }
    }
  }

  const shell = add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  const solid = add(`MANIFOLD_SOLID_BREP('${name}',${shell})`);
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${ax2([0, 0, 0], [0, 0, 1], [1, 0, 0])},${solid}),${ctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);

  const stamp = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;', 'HEADER;',
    `FILE_DESCRIPTION(('Rack blank panel'),'2;1');`,
    `FILE_NAME('${name}.step','${stamp}',(''),(''),'Rack Panel Generator','Rack Panel Generator','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
    'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}

// analytic volume, for checks
function volume(p) {
  const { W, H, T, r, c, rho, L } = p;
  let v = (W * H - (4 - Math.PI) * r * r) * T;
  const nCh = c > 0 ? (p.faces === 'both' ? 2 : 1) : 0;
  if (nCh) {
    const path = r > 0 ? 2 * (W - 2 * r) + 2 * (H - 2 * r) + 2 * Math.PI * (r - c / 3) : 2 * W + 2 * H - 8 * c / 3;
    v -= nCh * (c * c / 2) * path;
  }
  v -= p.holeY.length * 2 * (Math.PI * rho * rho + 2 * L * 2 * rho) * T;
  const nHc = p.hc > 0 ? (p.hfaces === 'both' ? 2 : 1) : 0;
  if (nHc) v -= p.holeY.length * 2 * nHc * (p.hc * p.hc / 2) * (4 * L + 2 * Math.PI * (rho + p.hc / 3));
  return v;
}

// ---------- preview mesh (same loops, arcs discretised) ----------
function sampleLoop(lp, segN) {
  // returns points with outward-ish data per segment: [{x,y, seg, t}]
  const pts = [];
  lp.segs.forEach((s, i) => {
    const a = lp.verts[i], b = lp.verts[(i + 1) % lp.verts.length];
    if (s.kind === 'line') { pts.push({ x: a[0], y: a[1], i, kind: 'line', a, b }); return; }
    const a0 = Math.atan2(a[1] - s.c[1], a[0] - s.c[0]);
    let a1 = Math.atan2(b[1] - s.c[1], b[0] - s.c[0]);
    while (a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
    const n = Math.max(2, Math.ceil(segN * (a1 - a0) / (Math.PI / 2)));
    for (let k = 0; k < n; k++) {
      const t = a0 + (a1 - a0) * k / n;
      pts.push({ x: s.c[0] + s.rad * Math.cos(t), y: s.c[1] + s.rad * Math.sin(t), i, kind: 'arc', ang: t });
    }
  });
  return pts;
}

function buildMesh(p, triangulate) {
  const pos = [], nor = [], idx = [];
  const tri = (a, b, c) => idx.push(a, b, c);
  const vert = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); const l = Math.hypot(nx, ny, nz) || 1; nor.push(nx / l, ny / l, nz / l); return pos.length / 3 - 1; };
  const levels = perimeterLevels(p);
  const SEG = 12;
  const per = levels.map(([z, off]) => ({ z, off, lp: perimeterLoop(p, off) }));
  const sl = slots(p);

  // caps
  const cap = (lp, holes, z, up, triangulate) => {
    const outer = sampleLoop(lp, SEG).map((q) => [q.x, q.y]);
    const hs = holes.map((h) => sampleLoop(h, SEG).map((q) => [q.x, q.y]));
    const tris = triangulate(outer, hs);
    const all = outer.concat(...hs);
    const base = pos.length / 3;
    for (const [x, y] of all) vert(x, y, z, 0, 0, up ? 1 : -1);
    for (const [a, b, c] of tris) {
      // earcut does not promise a winding: orient each triangle to face +Z (front) or -Z (back)
      const A = all[a], B = all[b], Cc = all[c];
      const z = (B[0] - A[0]) * (Cc[1] - A[1]) - (B[1] - A[1]) * (Cc[0] - A[0]);
      if ((z > 0) === up) tri(base + a, base + b, base + c); else tri(base + a, base + c, base + b);
    }
  };
  cap(per[per.length - 1].lp, sl.map((h) => h[h.length - 1].lp), p.T, true, triangulate);
  cap(per[0].lp, sl.map((h) => h[0].lp), 0, false, triangulate);

  // bands: discretise each segment identically on both levels
  const bandSeg = (loA, loB, zA, zB, outward, seg, i, nz) => {
    // loA/loB: [a,b] verts at each level; seg: segment description (shared centre)
    const n = seg.kind === 'line' ? 1 : Math.max(2, Math.ceil(SEG * angleSpan(loA, seg) / (Math.PI / 2)));
    const ring = (lv, z, k) => {
      if (seg.kind === 'line') { const pnt = k === 0 ? lv[0] : lv[1]; return [pnt[0], pnt[1], z]; }
      const a0 = Math.atan2(lv[0][1] - seg.c[1], lv[0][0] - seg.c[0]);
      let a1 = Math.atan2(lv[1][1] - seg.c[1], lv[1][0] - seg.c[0]);
      while (a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
      const t = a0 + (a1 - a0) * k / n;
      const rr = Math.hypot(lv[0][0] - seg.c[0], lv[0][1] - seg.c[1]);
      return [seg.c[0] + rr * Math.cos(t), seg.c[1] + rr * Math.sin(t), z, t];
    };
    for (let k = 0; k < n; k++) {
      const q = [ring(loA, zA, k), ring(loA, zA, k + 1), ring(loB, zB, k + 1), ring(loB, zB, k)];
      const ns = q.map((pt) => {
        let nx, ny;
        if (seg.kind === 'line') { const dx = loA[1][0] - loA[0][0], dy = loA[1][1] - loA[0][1]; nx = dy; ny = -dx; const l = Math.hypot(nx, ny); nx /= l; ny /= l; }
        else { nx = Math.cos(pt[3]); ny = Math.sin(pt[3]); }
        if (!outward) { nx = -nx; ny = -ny; }
        return [nx, ny, nz];
      });
      const v = q.map((pt, m) => vert(pt[0], pt[1], pt[2], ...ns[m]));
      if (outward) { tri(v[0], v[1], v[2]); tri(v[0], v[2], v[3]); }
      else { tri(v[0], v[2], v[1]); tri(v[0], v[3], v[2]); }
    }
  };
  const angleSpan = (lv, seg) => {
    const a0 = Math.atan2(lv[0][1] - seg.c[1], lv[0][0] - seg.c[0]);
    let a1 = Math.atan2(lv[1][1] - seg.c[1], lv[1][0] - seg.c[0]);
    while (a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
    return a1 - a0;
  };
  for (let k = 0; k < per.length - 1; k++) {
    const A = per[k], B = per[k + 1];
    const nz = A.off === B.off ? 0 : (A.off > B.off ? -1 : 1);
    A.lp.segs.forEach((seg, i) => {
      const j = (i + 1) % A.lp.verts.length;
      bandSeg([A.lp.verts[i], A.lp.verts[j]], [B.lp.verts[i], B.lp.verts[j]], A.z, B.z, true, seg, i, nz);
    });
  }
  for (const hole of sl) {
    for (let k = 0; k < hole.length - 1; k++) {
      const A = hole[k], B = hole[k + 1];
      const nz = A.off === B.off ? 0 : (A.off > B.off ? -1 : 1);
      A.lp.segs.forEach((seg, i) => {
        const j = (i + 1) % A.lp.verts.length;
        bandSeg([A.lp.verts[i], A.lp.verts[j]], [B.lp.verts[i], B.lp.verts[j]], A.z, B.z, false, seg, i, nz);
      });
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
}

export { U_MM, DEFAULTS, resolve, buildStep, buildMesh, volume };
