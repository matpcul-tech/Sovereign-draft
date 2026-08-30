# Sovereign Draft

A touch-first 2D CAD program for architectural drafting that runs entirely in the browser. Draw in feet, dimension in feet-and-inches, and exchange work with desktop CAD via DXF. Installable as an offline PWA; every drawing autosaves to the device and nothing leaves it until you export.

![CI](https://github.com/matpcul-tech/Sovereign-draft/actions/workflows/ci.yml/badge.svg)

## Features

**Drawing and editing**
- Line, polyline (open/closed), rectangle, circle, text, linear dimensions, measure
- Trim, extend and parallel offset against lines, polylines, circles and arcs
- Object snaps (endpoint, midpoint, center) plus a 6" grid snap, ortho mode
- Select by tap or box, move, rotate 90°, duplicate, grip editing, per-entity layer assignment
- Layers with visibility toggles and per-layer colors; blocks — save any selection as a reusable symbol
- Built-in architectural symbol library (doors, windows, fixtures, furniture, stairs)
- 50-level undo/redo covering entities *and* layers

**Input**
- Touch: one finger draws, two fingers pan and zoom
- Desktop: scroll-wheel zoom, middle-drag pan, hover snap preview and full keyboard shortcuts

**File formats**
- **DXF out** (R12/AC1009 — opens in AutoCAD, LibreCAD, QCAD…) and **DXF in** (LINE, CIRCLE, ARC, TEXT, LWPOLYLINE, POLYLINE)
- **PDF out** at a true architectural print scale (1/16" … 1" = 1'-0", or FIT) with title block and scale bar
- **PNG out** with title block
- **Project files** (.json) carrying layers, entities and user blocks; autosave/restore via localStorage

**AI drafting**
- Describe a floor plan ("two bed one bath cabin, 24 by 36 feet…") and Claude drafts walls, doors, fixtures, labels and dimensions
- Sheet-context mode: the model reads what is already drawn and extends it; AI only ever adds — undo removes a pass
- Bring your own Anthropic API key (Menu → AI settings). The key is stored only in your browser's localStorage and sent only to `api.anthropic.com`.

## Keyboard shortcuts

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| `V` | Select | `O` | Offset |
| `H` | Pan | `X` | Trim |
| `L` | Line | `E` | Extend |
| `P` | Polyline | `D` | Dimension |
| `R` | Rectangle | `M` | Measure |
| `C` | Circle | `T` | Text |
| `S` | Symbols | `Q` | Erase |
| `F` | Zoom to fit | `Enter` | Finish polyline |
| `Esc` | Cancel / deselect / close sheet | `Del` | Delete selection |
| `Ctrl/⌘+Z` | Undo | `Ctrl/⌘+Y` or `Ctrl/⌘+Shift+Z` | Redo |

## Development

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (vitest)
npm run build      # production build in dist/
npm run preview    # serve the production build
```

Regenerate the PWA icons after changing the mark:

```bash
node scripts/gen-icons.mjs
```

## Deployment

`npm run build` emits a fully static site in `dist/` — deploy it to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3…). The service worker precaches the app shell so it installs and runs offline; Google Fonts are runtime-cached with system-font fallbacks.

Requirements: HTTPS (for the service worker and installability), no server-side code needed. The Anthropic API is called directly from the browser with the user's own key, so no proxy is required — though you can front it with one if you'd rather issue scoped keys.

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to the repository's **default branch**, and can also be run on demand from the Actions tab.

It targets the default branch because GitHub restricts the `github-pages` environment to that branch: a deploy triggered from any other branch is rejected before its first step runs, with the `deploy` job failing in about a second having executed nothing. Pointing the trigger at a fixed branch name that is *not* the default produces a deadlock — the branch that runs the workflow is not allowed to deploy, and the branch that is allowed never runs it. Deploying from the default branch keeps those the same branch and survives a rename.

**One-time setup:** turn Pages on under **Settings → Pages → Build and deployment → Source: GitHub Actions**. Until that is done the deploy job fails at `configure-pages` with *"Please verify that the repository has Pages enabled"*; the workflow cannot do it for you, because creating a Pages site needs admin rights that the workflow's `GITHUB_TOKEN` does not carry. Once the setting is on, the next push to the default branch deploys with no further changes, and the published URL appears on the run's `deploy` job.

To publish from a branch that is not the default (say, keep `main` as trunk while some other branch is default), widen the `github-pages` environment instead: **Settings → Environments → github-pages → Deployment branches**.

### Serving from a subdirectory

A GitHub Pages *project* site is served from `https://<user>.github.io/<repo>/`, so the bundle needs a matching base path. Set `VITE_BASE` at build time:

```bash
VITE_BASE=/Sovereign-draft/ npm run build
```

The deploy workflow does this automatically from the repository name. Leave `VITE_BASE` unset (defaults to `/`) for a user/org site, a custom domain, or any host serving from the domain root.

## Architecture

```
src/
  core/       pure, unit-tested CAD math and document state
    geometry.js    distances, intersections, arcs, dimension geometry
    entities.js    snap points, hit tests, bboxes, transforms, grips
    offset.js      parallel offset for lines/polys/circles/arcs
    trimExtend.js  trim + extend against the whole drawing
    symbols.js     built-in symbol library
    state.js       document, layers, selection, undo/redo
    viewport.js    world<->screen mapping, zoom
  io/         file formats: dxf.js, pdf.js, png.js, project.js
  ai/         Anthropic API integration (draft.js) + local settings
  render/     canvas rendering (shared between screen and PNG export)
  ui/         sheets, chips, panels, toast
  input.js    pointer/wheel/keyboard handling
  main.js     wiring
tests/        vitest suite for core, io and ai modules
```

Units are decimal feet with the Y axis pointing up (world space); dimensions display as feet-and-inches rounded to the nearest half inch.

## Privacy

All drawing data stays in the browser (localStorage autosave + explicit file exports). The only network calls are Google Fonts and — when you use AI drafting with your own key — `api.anthropic.com`.
