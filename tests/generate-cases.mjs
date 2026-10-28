// Writes one STEP file per test case to tests/out/, plus the expected volume of each (from a closed-form formula).
// tests/check_step.py then opens every file in OpenCascade and compares.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve, buildStep, volume } from '../site/js/panel-core.js';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });

const cases = {
  default_1u: {},
  half_u: { u: 0.5, holes: 1 },
  u2_4holes: { u: 2, holes: 4 },
  u3_3holes: { u: 3, holes: 3 },
  sharp_chamfer: { radius: 0, chamfer: 0.5 },
  round_no_chamfer: { radius: 5, chamfer: 0 },
  sharp_plain: { radius: 0, chamfer: 0 },
  round_holes: { travel: 0, holes: 3 },
  front_chamfer_only: { chamferFaces: 'front', chamfer: 1 },
  no_holes: { holes: 0, u: 1.5 },
  big_chamfer: { chamfer: 1.5, radius: 5 },
  hole_chamfer_both: { holeChamfer: 0.5 },
  hole_chamfer_front: { holeChamfer: 1.2, holeChamferFaces: 'front' },
  hole_chamfer_back_round: { holeChamfer: 0.8, holeChamferFaces: 'back', travel: 0 },
  hole_chamfer_round_3: { holeChamfer: 0.5, travel: 0, holes: 3 },
  one_hole_top: { holes: 1, holeAlign: 'top', holeChamfer: 0.5 },
  one_hole_bottom_2u: { u: 2, holes: 1, holeAlign: 'bottom' },
  one_hole_middle_3u: { u: 3, holes: 1, holeAlign: 'middle', holeChamfer: 0.5, chamferFaces: 'front' },
  sharp_hole_chamfer: { radius: 0, chamfer: 0, holeChamfer: 1 },
  half_u_hole_chamfer: { u: 0.5, holes: 1, holeChamfer: 0.5 },
  ten_inch_standard: { width: 254, pitch: 236.525, u: 2, holes: 2 },
};

const meta = {};
let failed = false;
for (const [name, opts] of Object.entries(cases)) {
  const p = resolve(opts);
  if (p.errors.length) { console.error(`${name}: ${p.errors.join(' ')}`); failed = true; continue; }
  writeFileSync(join(out, `${name}.step`), buildStep(p, name));
  meta[name] = { volume: volume(p), W: p.W, H: p.H, T: p.T, holeY: p.holeY };
}
writeFileSync(join(out, 'expected.json'), JSON.stringify(meta, null, 1));
console.log(`wrote ${Object.keys(meta).length} STEP files to ${out}`);
if (failed) process.exit(1);
