# Rack Panel Generator

Generate blank rack front panels as STEP files in the browser, with a live 3D preview. The STEP is exact geometry (planes, cylinders and cones), so it imports into Fusion, FreeCAD or PrusaSlicer as a real solid you can keep modelling on.

Everything runs client-side: no backend, no build step, no third-party requests. three.js and the fonts are self-hosted.

## Features

- Panel height in 0.5U steps (U = 44.45 mm, panel = U × 44.45 − stack gap)
- Screw holes on the standard 10-inch/19-inch (EIA-310) hole heights, 0 to the maximum that fits
- Top, middle or bottom position when there is a single hole per side
- Horizontal slots with adjustable travel, or round holes
- Corner radius, edge chamfer (front, back or both) and hole chamfer (front, back or both)
- Panel width, slot spacing, thickness, hole diameter and stack gap are all adjustable. The defaults match a custom 2020-extrusion rack: 306 mm wide, slots 286 mm apart. Use 254 mm and 236.525 mm for a standard 10-inch rack.
- Orbit, pan (middle-drag or Shift + drag) and zoom in the preview
- Download the `.step`, or copy the STEP text

## Deploying to GitHub Pages

Read these first:

- **Free GitHub accounts can only publish Pages from public repositories.** Private repositories need a paid plan.
- **The workflow deploys from the `main` branch.** If your default branch has another name, change `branches: [main]` and `refs/heads/main` in `.github/workflows/pages.yml`.
- **Pages must be set to "GitHub Actions" as its source** (step 3). If the first workflow run happens before that, its deploy job fails. Re-run it after step 3.
- Create the GitHub repository **empty**, without a README or licence, so the first push doesn't conflict.

Steps:

1. Create a new, empty repository on GitHub.
2. Push this folder:
   ```sh
   git init
   git add .
   git commit -m "Rack panel generator"
   git branch -M main
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
3. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. When **Test and deploy** has finished, the site is at `https://<you>.github.io/<repo>/`.

Every push to `main` runs the tests first, and a failing test blocks the deploy. Pull requests run the tests only.

## Running locally

ES modules don't load from `file://`, so serve the folder:

```sh
npm run serve        # python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000.

## Tests

The tests generate 21 STEP variants, then open each in OpenCascade (the CAD kernel behind FreeCAD and CadQuery) and check that:

- it reads as exactly one valid solid,
- its bounding box matches the panel size,
- its volume matches a closed-form calculation to within 1e-6.

```sh
python3 -m pip install -r tests/requirements.txt   # cadquery-ocp (CI uses Python 3.13)
npm test
```

## Project layout

```
site/                    published to GitHub Pages
  index.html
  css/style.css
  js/panel-core.js       geometry, STEP writer and preview mesh (no dependencies)
  js/app.js              UI, 3D preview, download
  vendor/three/          three.js 0.186.1 (ES module build)
  fonts/                 Barlow and JetBrains Mono, woff2, latin subset
  favicon.svg
tests/
  generate-cases.mjs     writes the STEP variants and expected volumes
  check_step.py          validates them with OpenCascade
  requirements.txt
.github/
  workflows/pages.yml    test, then deploy
  dependabot.yml         keeps the workflow actions and test dependency current
```

## How the STEP is built

`panel-core.js` describes the panel as closed loops of lines and arcs: the outline, and one loop per slot. Each loop is repeated at several heights through the thickness, with chamfers being the same loop moved inwards (outline) or outwards (holes) at the face. The faces between neighbouring loops are planes, cylinders or cones. The writer emits these as an AP214 `MANIFOLD_SOLID_BREP` directly, entity by entity, so no CAD kernel is needed in the browser. The preview mesh is built from the same loops, with arcs split into short segments.

The flip side is that every new feature (for example keystone or vent cut-outs) has to be added to the topology code. Flat cut-outs are straightforward. Freeform shapes would justify bringing in a WebAssembly CAD kernel instead.

## Updating vendored files

three.js and the fonts are copied into `site/`, so Dependabot doesn't track them. To update three.js:

```sh
npm pack three@<version>
tar -xzf three-<version>.tgz
cp package/build/three.module.js package/build/three.core.js site/vendor/three/
cp package/LICENSE site/vendor/three/LICENSE
```

Then update the version in `THIRD_PARTY_NOTICES.md`, run `npm run serve` and check the preview. Fonts come from the `@fontsource/barlow` and `@fontsource/jetbrains-mono` packages (the `files/*-latin-*-normal.woff2` files).

## Security

`index.html` sets a strict Content Security Policy: scripts, styles, fonts and connections are limited to the site's own origin, with no inline scripts or styles. The page makes no network requests beyond its own files, and stores nothing except your last settings, in `localStorage`.

## Licence

MIT, see `LICENSE`. Third-party components are listed in `THIRD_PARTY_NOTICES.md`.
