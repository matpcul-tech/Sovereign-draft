# Sovereign Draft

**Issued 2D, touchable 3D, free. One plan becomes a documented building.**

[![CI](https://github.com/matpcul-tech/Sovereign-draft/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/matpcul-tech/Sovereign-draft/actions/workflows/ci.yml) · v1.8.0 · MIT · no account · no seat

The CAD you open without a license — and shouldn’t need one.

Browser CAD: 2D drafting for the 80% of drawings that are plans, elevations, and diagrams, plus a mesh 3D kernel where every volume is exact. Decimal feet, Y-up, dimensions to the nearest ½″. JSON lives in git next to the code. A sentence can become a sheet set; four commands turn a floor plan into a dormered multi-story building with a numbered drawing set. The drawing stays on the device until you export.

This is how we democratize CAD: the cheapest go-to for a developer who needs a real issued sheet, not a $2,000 seat.

## Open it

```
npx --yes github:matpcul-tech/Sovereign-draft --sample --pdf cabin.pdf
```

```js
import { open, sheetset, toPDF, toDXF, toDWG, toJSON } from 'sovereign-draft'

const doc = open(dxfText, 'plan.dxf')
const set = sheetset(doc)
writeFileSync('plan.pdf', toPDF(set), 'latin1')
writeFileSync('plan.dxf', toDXF(set))           // R2000 — AutoCAD Open path
writeFileSync('plan.dwg', Buffer.from(toDWG(set)))
```

The editor is a PWA. The kernel is the product (`src/api.js`). No DOM.

Starters in `examples/`:

| File | What it is | What it is not |
|------|------------|----------------|
| `cabin.json` | 24×36 plan, walls, rooms, G-001 / A-101 set | |
| `part.json` | 12″×8″ plate with GD&T | |
| `ga.json` | General arrangement + parts table | A build spec |

## What it is

| You get | You don’t |
|---|---|
| 2D drafting in the browser (PWA) | CATIA, Fusion, or CAM |
| Command line (`L`, `TR`, `@8<45`, F8) | Invented materials or tolerances |
| Issued sheets: title block, copyright, ISO lineweights, 24×36 PDF | A substitute for a professional of record |
| Associative dims that follow stretch / move | |
| R2000 DXF AutoCAD Open path + DWG this app reopens | ODA-grade DWG every AutoCAD opens without Recover |
| Cutting planes (`SE`) that hatch a true section + a sheet | Pretending 8'-0" is a known story height |
| 3D modelling: `BOX` `CYL` `EXTRUDE` `REVOLVE` `LOFT` `SWEEP`, CSG, push-pull, STL in/out, OBJ/glTF | B-rep, NURBS, Parasolid, STEP, or a PE stamp |
| One model, whole set: `MODEL` `STACK` `ROOF` `DORMER` `DRAWINGS SHEETS` | Parametric BIM objects or a worksharing server |
| Generated plans per storey, roof plan, 4 hidden-line elevations, sections that see beyond the cut | Hidden line removal of every edge of every mass |
| Wing roofs with real valleys over L / T / U plans; gabled dormers by point and width | A framing package |
| Model takeoff (`QTO`): footprint, surface, volume per solid, straight from the meshes | A cost estimate |
| Feature control frames, datums, ± tolerances (`FCF` / `DATUM`) | A frame without a number |
| Isolated detail sheets (`DET`) — a tighter viewport, not a copy | |
| Grok drafts for free (optional Anthropic fallback) | |
| `XREF` / `BIND`, JSON in git, share link in the URL hash | A server that holds your drawings |
| Millimetres or metres on the glass | A CAD license |

A cabin floor plan with walls, doors, rooms, dims, and a G-001/A-101 set is the job. A rocket silhouette with a parts table is a general arrangement, not a build spec — we will not pretend otherwise.

You can sell prints you drew. You cannot stamp them as a PE unless you are one. The software does not become the stamp.

## Cost

The editor is free. MIT licensed. Geometry is local. Grok drafts in this app with no key. The only optional network call is `api.anthropic.com` with **your** key as a fallback. No seat, no trial, no watermark.

Tap **FT** in the status bar to cycle feet → millimetres → metres. World coordinates stay decimal feet; the glass and the command line follow you. Type `2400mm` or `3.6m` in any mode.

Copy share link (Sheet menu) puts a gzipped drawing in the URL hash. No server. If it is too big, export HTML instead.

## Draw

| Key | Command | Key | Command |
|-----|---------|-----|---------|
| `L` | Line | `P` | Polyline |
| `R` | Rectangle | `C` | Circle |
| `A` | 3-point arc | `D` | Linear dimension |
| `T` | Text | `K` | Hatch (ANSI31) |
| `S` | Symbols / blocks | `M` | Measure |
| `Q` | Erase | `V` | Select |
| `H` | Pan | `F` | Zoom fit |
| `/` | Focus command line | `EL` | Ellipse |
| `RC` | Revision cloud | `LE` | Leader |
| `IMG` | Image underlay | `XL` | Construction line |
| `GRID` | Column grid | `OPEN` | Open DXF / JSON / DWG |
| `DXFIN` | Insert DXF (merge) | `XREF` | Attach xref |
| `BIND` | Bind xref | `SHEETSET` | Generate sheet set |
| `SE` | Section cut | `DET` | Isolated detail |
| `3D` | Model in 3D | `HT` | Story height |
| `BOX` | Box solid | `CYL` | Cylinder |
| `SPHERE` / `CONE` / `WEDGE` | More primitives | `SWEEP` | Sweep a section along a path |
| `EXTRUDE` | Extrude sketch | `REVOLVE` | Revolve profile |
| `U3D` / `SUB3D` | Union / subtract | `DWGOUT` | Export DWG |
| `MODEL` | Plan becomes named solids | `STACK n` | Replicate the storey upward |
| `ROOF HIP 6` | Roof the massing, valleys included | `DORMER x y w` | Gabled dormer on the slope |
| `DRAWINGS HIP 6 SHEETS` | The whole set on numbered sheets | `PLANS` | A cut plan per storey |
| `ELEV S` | Hidden-line elevation | `SLICE NAME y 12` | Section, poche and beyond |
| `ROOFPLAN` | Ridges, hips, valleys from above | `QTO` | Model takeoff table |
| `SUN JUN 21 14 40.7` | Real solar position, shadow study | `MAT ROOF #7a3b2a` | Material per solid / layer / kind |
| `RENDER 1920 [PLACE]` | High-res PNG, or placed on the drawing | | |
| `2D` | Back to plan | `FCF` | Feature control frame |
| `DATUM` | Datum feature | `SF` | Surface finish |
| `JS` | Script sheet (`sd.*` API) | `RUN` | Run a saved script |

**Wall mode** draws two parallel faces + caps. Thickness chip: 4″ / 6″ / 8″. Walls **heal as you draw** — L-corners miter and T-junctions recut automatically. Doors and windows are **dynamic INSERT blocks**: stretch the width grip, tap the diamond to flip swing, type `2'6"` with the door selected. They recut the host wall. **Explode** (`XP`) yields ordinary lines and arcs. Fixtures (stove, bed, …) are the same INSERT type with rotate + flip grips.

**Live rooms** (`ROOMS`): closed wall loops become named rooms with live SF. Turn auto-rooms on and the labels follow as walls move. Text inside a loop names the room.

**Column grid** (`GRID`): tap two corners. Letter bubbles along X, numbers along Y, CENTER linetype. Explode to lines + circles + text.

## Modify

| Key | Command | Key | Command |
|-----|---------|-----|---------|
| `O` | Offset | `X` | Trim |
| `E` | Extend | `B` | Fillet (incl. r=0) |
| `N` | Chamfer | `I` | Mirror |
| `G` | Scale | `W` | Move |
| `U` | Copy | `Y` | Rectangular array |
| `ARP` | Polar array | `J` | Join |
| `XP` | Explode block | `ST` | Stretch |
| `MA` | Match properties | `AA` | Area |
| `LI` | List object | `CLN` | Heal wall joints |
| `OV` | Overkill | `TO` | Quantity takeoff |
| `LAYISO` | Isolate layers | `UNISO` | Unisolate |

Fillet / chamfer / offset / scale accept a typed radius or factor at the command line before the second pick. Live prompt example: `FILLET Specify radius <0'-6">:`.

## Command-line numeric input

While a command is live:

| Typed | Meaning |
|-------|---------|
| `10` | Distance along the rubber-band (feet) |
| `12'6"` | 12 feet 6 inches |
| `@8<45` | Relative polar: 8 ft at 45° |
| `#24,36` | Absolute coordinates |
| `10,20` | Absolute coordinates |

`F3` SNAP · `F8` ORTHO · `F10` POLAR (15°) · `Esc` cancel · `Enter` / `Space` finish polyline, or **repeat last command** when idle.

## Dim styles

Named styles (`ARCH` tick / `ARROW` / `DECIMAL`) with text height, offset, tick vs arrow, precision (½″ / ¼″ / decimal) and layer. Tools: aligned, continue, baseline, **angular** (`DAN`), **radius** (`DRA`), **diameter** (`DDI`).

Linear dims **bind to wall ends** (and to circle radius / diameter) and **follow stretch and move**. Stretch skips associative dim endpoints so the witness stays on the geometry.

Default DXF is **R2000**: native `DIMENSION` objects, not exploded. R12 still explodes to LINE+TEXT (byte-stable for old pipelines).

## Construction documents

Door / window / room **schedules** (`SCH` or Sheet → Place schedules) auto-tag inserts `D01`, `W01` and drop a live `table` entity. Explode a table into lines + text. Export a door takeoff as CSV from the Sheet menu.

**Image underlay** (`IMG` / Trace image): pick a photo, tap two corners. `CAL` then two taps + a typed length scales the raster to a known dimension. Underlays live on the `UNDERLAY` layer (`plot` off so they don't print).

**Stretch** (`ST`): crossing-window the vertices to move, then pick a displacement. Walls, polylines, hatches, ellipses and inserts all stretch. Associative dims stay tied.

**Match properties** (`MA`): tap a source, then tap destinations to copy layer / linetype / lineweight.

**Inquiry:** `AA` area (including hatches and ellipses), `LI` list, `ID` coordinates.

**Revision cloud** (`RC`) and **leader** (`LE`) for review sets. **Ellipse** (`EL`) for round rooms / tubs.

**Clean / heal walls** (`CLN`) miters L-corners onto the centerline intersection and recuts T-junctions.

**Overkill** (`OV`) drops zero-length and duplicate lines without touching walls, inserts, dims, hatches or rooms.

**Quantity takeoff** (`TO`) places a live table: wall LF, door/window counts, room SF.

**Layer isolate** (`LAYISO` / `UNISO`) hides every layer except the selection.

The sample cabin includes live rooms, a 12′ column grid, tagged doors, a door / window / room schedule, associative overall dims, and a dashed centerline.

**SVG** export (`SVG` or Sheet menu) for Illustrator / web. Object snaps include **TAN** from the last point onto a circle.

Layers lock (click the padlock — locked objects can't be selected) and a **P** plot flag (off = skip in PDF / SVG).

## Paper space

One model space + N layouts. Each layout has a sheet (Letter / Tabloid / Arch D / Arch D portrait), plot scale, and viewports that clip + scale model geometry. PDF export plots an **issued sheet**: double border, ISO 128 lineweights (WALLS 0.50 mm, DIMS 0.18 mm), a scale bar, a title block (ISSUED BY / PROJECT / DRAWING TITLE / SCALE / SHEET), and your company copyright. Set the firm name, copyright line and “drawn by” in the Sheet menu — they stamp every page and stay on this device.

**Sheet set** (`SHEETSET` / `SS`, or Sheet → Generate sheets) is the generator that turns one model into a print set:

- **G-001** cover — drawing index plus a **parts schedule** (`MARK` / `QTY` / `DESCRIPTION` / `SIZE` / `MATL` when a material was named) or a room schedule on floor plans. Marks (`P-01`, or the mark on the callout) are assigned here.
- **A-101** overall — the full model, with envelope height and width stamped only if the drawing had no dims of its own
- **A-102…** one sheet per room or labeled station. That sheet’s spec table lists only the parts in that window. Mark bubbles sit on the view.

**Marks.** An entity can carry `mark` plus `attributes` (`type`, `material`, `size`, `qty`, `label`). AI drafting writes them; `SHEETSET` writes them from callouts; JSON can carry them. Sheet → **Keynote legend** lists what this sheet actually shows. Sheet → **Mark schedule** tabulates `MARK` / `QTY` / `TYPE` / `MATERIAL` / `SIZE`.

`SIZE` is measured from that mark’s geometry — the same bbox path as stretch / `AA` / `LI`. Nine copies of one mark measure **one instance**, not the envelope of all nine. Authored `attributes.size` wins. A constant stamped onto every different part (`X x 14'-0` on the nose, the tank, and the engines) loses to the measurement.

Envelope dims stay on the overall sheet. A dim belongs to a view only when **both origins** sit in that window, so a 230 ft overall does not leak onto A-105 — not in the plot, and not in that sheet’s legend or schedule.

Quantities come from marks and `x9`-style labels. Materials stay blank unless named. Export all sheets as one PDF from the Sheet menu. PageUp / PageDown walks the set.

A sheet set is a general arrangement plus a schedule. It is not a manufacturing package.


**Section** (`SE`): two picks draw a cutting plane. Walls and profiles the plane crosses become hatched bars at true thickness. Height is 8'-0" ASSUMED unless a wall carries `attrs.height` — we will not pretend a floor plan knew a story. A new S-A sheet opens on that view.

**Detail** (`DET`): two corners open D-1 as a tighter viewport onto the same model (geometry is not copied) and stamp a bubble on the current sheet.

**GD&T** (`FCF`, `DATUM`, `SF`): feature control frames, datum triangles, surface-finish checks. A frame without a tolerance is refused. Linear dims accept `tolPlus` / `tolMinus` and print ±.

## Kernel, CLI, embed

The editor is the app. The kernel is the product.

```
npx --yes github:matpcul-tech/Sovereign-draft --sample --pdf cabin.pdf
npx sovereign-draft plan.json --pdf plan.pdf
npx sovereign-draft plan.json --dxf plan.dxf --dwg plan.dwg
npx sovereign-draft plan.dxf --sheets --pdf set.pdf --svg set.svg --html set.html
npx sovereign-draft plan.json --html plan.html
npx sovereign-draft plan.json --share
npx sovereign-draft site.json --xref cabin.json --pdf site.pdf
npx sovereign-draft plan.json --units mm --pdf plan.pdf
npx sovereign-draft drawing.dwg --json drawing.json
npx sovereign-draft examples/part.json --dxf part.dxf
```

`examples/cabin.json` is the sample, committed so it diffs in git. CI plots it to PDF on every push.

From any repo:

```yaml
- uses: matpcul-tech/Sovereign-draft/.github/actions/plot@main
  with:
    file: drawings/cabin.json
    pdf: cabin.pdf
```

Embed a drawing in your page (chrome off), or email `--html` — a single file with the SVG, the schedule, and the JSON so it can be opened again. No server.

```html
<iframe src="embed.html?src=plan.json"></iframe>
<!-- or -->
<script type="module" src="/src/embed.js"></script>
<sovereign-draft src="plan.json"></sovereign-draft>
```

`postMessage({ type: 'sovereign-draft', action: 'load', project })` into the iframe. `pdf` / `dxf` / `dwg` / `json` / `sheetset` come back the same way.

## Files

The project JSON is the source of truth — plain objects, diffable in git, next to the repo. DXF, DWG and PDF are exports.

**Open** (`OPEN`, Sheet → Open drawing, or drop a file) replaces the sheet. **Insert DXF** (`DXFIN`) merges into the current drawing. `.json` project files open the same way. **DWG** opens in the browser: misnamed DXF files are read directly; real DWG is parsed via LibreDWG wasm, loaded only when you open a `.dwg` (GPL parser, not bundled). If the wasm is blocked, Save As DXF in the other program and Open here. Paperspace (VIEWPORT, LAYOUT, group 67=1) is kept — it is not dropped on open.

**Units.** World units are decimal feet, Y-up. The writer stamps `$INSUNITS=2`. The reader honors `$INSUNITS` (inches, mm, cm, meters → feet). If the header is missing and coordinates look like millimetres (max > 2000), they are scaled to feet; otherwise feet are assumed. A 36 ft cabin is never auto-scaled.

**In:** LINE, ARC, CIRCLE, ELLIPSE, TEXT, MTEXT (flattened), LWPOLYLINE, POLYLINE, SPLINE (as polyline), SOLID / 3DFACE, INSERT (block geometry), HATCH, XLINE, RAY, DIMENSION (aligned), LEADER, VIEWPORT, LAYOUT.

**Out:** Default **R2000 DXF** (`$ACADVER AC1015`): TABLES (VPORT, LTYPE, LAYER, STYLE, DIMSTYLE, BLOCK_RECORD), `*MODEL_SPACE` / `*PAPER_SPACE`, DIMENSION objects (codes 10/11/13/14/70), LAYOUT + VIEWPORT so paperspace survives. R12 is still available and still explodes inserts, rooms and dims to ordinary geometry.

**DWG** (`DWGOUT`) writes AC1015 this app reopens, with the same R2000 DXF inside and 3DFACE from the extrusion. Autodesk’s native DWG is still proprietary — if their Open refuses the binary, the DXF R2000 is the interchange they document. We do not rename a DXF and call it a DWG.

## One model, whole set

Draw a floor plan. Then:

```
MODEL                  the plan becomes named solids: WALL, DOOR, WINDOW, FLOOR
STACK 3                three storeys, upper windows and doors named per level
ROOF HIP 6             a hip at 6:12 over the massing; L, T and U plans get
                       wing roofs whose CSG union makes the real valleys
DORMER 12 19 6         a gabled dormer seats itself on the slope at that point
DRAWINGS HIP 6 SHEETS  the whole set, one undo step
```

The set: a cut plan per storey (4 ft above each floor, poche hatched, voids respected), a roof plan with ridge, hip and valley lines, four elevations with hidden lines removed and only the openings you would actually see, at their true sills, and a section that shows the cut material **and** everything visible beyond it, tied back to the plan by a tagged section marker. Every view arrives titled and dimensioned, framed on numbered sheets: plans on A-101 up, elevations on A-201 up, sections on A-301, at honest standard architectural scales. `buildAllSheetsPDF` prints the package one page per sheet.

Walls carry their headers over doors and sill walls under windows, so a section through a doorway shows the header, not a void. `QTO` lands a takeoff table: footprint, surface area and volume per solid, totals included, every figure straight from the meshes.

Every generated number is held by a closed-form test. The hidden line pass runs on a gridded depth probe, so a 100-building campus (29k faces) produces its full set in about five seconds (`scripts/drawbench.mjs` reproduces the measurement).

## 3D

`3D` is a modelling view. Drag `BOX` / `CYL` / `SPHERE` / `CONE` on the workplane, or `EXTRUDE` / `REVOLVE` / `LOFT` / `SWEEP` a closed 2D sketch. Pick two solids and `U3D` / `SUB3D`. `STL` opens as welded meshes; `STL` / `OBJ` / GLB out. Sample 3D bracket is in the Sheet menu.

The model is touchable, and touch is precise:

- **Click** a solid to select it by name. **Drag** moves it in plan, shift lifts it. The drag snaps to a half-foot grid and to the faces and centres of other solids, so a box lands flush against its neighbour exactly (alt frees it). The live delta reads out in feet and inches; **type a number, Enter** sets the distance exactly. **Ctrl-drag** commits a copy.
- **R** rotates about the solid's own centre in 15° steps (shift 1°, typed degrees exact).
- **P** is push-pull: grab any planar face and drag it along its own normal. The face's coplanar patch is found through CSG T-junctions, holes ride along, and the edit is exact by construction: volume changes by patch area × distance. A ghost prism previews; typed distance commits.
- **M** measures: two clicks give the true 3D distance with the per-axis breakdown. The same point twice reads zero.
- Every touch is one undo step. Escape cancels a drag without touching the document.

The plan is still the issued print. A floor plan with no solids extrudes to story height and is stamped **ASSUMED** until you set `HEIGHT`. Solids you placed do not carry that stamp.

This is a mesh modeler, not Fusion. Not B-rep, not STEP, not a PE stamp. Faces are triangles; CSG booleans are held to vol(A)+vol(B) = vol(A∪B)+vol(A∩B) in the test suite rather than eyeballed. `scripts/csgbench.mjs` publishes the measured performance ceiling.

**Sun, materials, renders.** `SUN JUN 21 14 40.7` puts the real sun in the sky: azimuth and elevation from the standard declination and hour-angle formulas, held to almanac values in the tests (solstice noon at 40N, due south at solar noon, exactly on the horizon at equinox six o'clock). The model throws true shadows on itself and the ground, which makes the 3D view a shadow study, the thing planning boards ask for. `MAT ROOF #7a3b2a 0.85` paints a solid, its stacked levels, a layer or a kind with PBR colour, roughness and metalness; materials and the sun are document data, saved with the project and one undo away. `RENDER 1920` draws the scene offscreen at print resolution and downloads a PNG; `RENDER 1920 PLACE` sets the rendering beside the drawing as an image entity, the perspective a real set opens with. This is a raster study renderer, not Cycles: no path tracing, no textures, stated plainly.

Esc once returns to orbit. Esc again returns to plan.

## AI drafting

Grok drafts in this app — tap AI, describe the building or part, no key. Optional Anthropic key in settings is a fallback only. **Adds only** — undo drops a pass. Sheet-context mode reads existing walls and appends. Invalid JSON is retried once, then toasted. Never deletes user entities.

The model is asked for a constrained schema (not leftover raw lines): walls, openings, fixtures, rooms, dims, profiles, centerlines, callouts, GD&T frames, cutting planes. `drawingType` (`plan` / `elevation` / `section` / `part` / `diagram`) gates what is legal — a rocket does not get door swings; a floor plan does not get a nose cone.

Mark repeated parts (`"mark":"M1D"`, `"attrs":{"qty":9,"size":"…","material":"…"}`) so they schedule. Include material only when the user named one. A drawing with no dimensions cannot be built from — the model is told to emit overall height, width, and stations. A feature control frame without a tolerance is dropped.

The app snaps to a 6″ grid, fillets wall corners, hatches rooms, and places overall + room dimensions.

## Status & properties

Status bar: X, Y, last length, last angle, SNAP / ORTHO / POLAR / WALL. Context chips **LT**, **LW**, **DIM**, and **DXF** (R2000 / R12) cycle current linetype, millimetre lineweight, dim style, and DXF version — they also apply to the selection. Properties (the sheet button): edit layer, linetype, lineweight, dim style; length and area are read-only. Command history in the Sheet menu. Draw vs Modify are two independently swipeable rows so the toolstrip stays usable on a phone.

**Hatch (`K`):** tap a closed polyline or tap *inside* a closed shape / circle. Tap an existing hatch to cycle ANSI31 → ANSI32 → NET → SOLID. Or draw a boundary and Close.

## Dynamic blocks

Doors, windows and symbols are live `insert` entities (no frozen `g` group). Grips:

| Grip | Shape | Action |
|------|-------|--------|
| Move | square | Slide along the host wall, or free-move a fixture |
| Stretch | circle | Door leaf / window width (snaps to 1″) |
| Flip | diamond | Door swing L↔R, or mirror a fixture |
| Rotate | circle (red) | Fixture / user-block angle |

Type a length (`3`, `2'6"`) with a door or window selected to set width. Properties sheet also edits width and swing. Copy of a hosted insert detaches it (does not punch a second opening). PDF and R12 DXF expand inserts to ordinary geometry. R2000 writes DIMENSION and paperspace; inserts still explode.

## Privacy

Autosave to `localStorage`. No account, no backend. Grok drafting uses the app owner's xAI key on the server. The only optional browser network call is `api.anthropic.com` with your key.

## Status

**v1.8.0** — Issued 2D, touchable 3D, one plan becomes a documented building.

Shipped: kernel + CLI + embed, honest AI, Grok drafting with no key, R2000 DXF AutoCAD Open path (island hatches round-trip both ways), DWG this app reopens, paperspace kept on open, associative dims that follow a stretch, issued 24×36 PDF with ISO lineweights and embedded fonts, cutting-plane sections, isolated details, feature control frames, ± tolerances. Mesh 3D on an exact CSG kernel: primitives, extrude / revolve / loft / sweep, push-pull face editing, precision touch (snap, typed distances, rotate, copy), measure, STL both ways, OBJ/glTF out. The building pipeline: MODEL, STACK, wing roofs with valleys, dormers, per-storey plans, roof plan, hidden-line elevations, sections that see beyond the cut, DRAWINGS SHEETS, QTO. The archviz layer: almanac-tested SUN with true shadows, MAT materials, RENDER to print-resolution PNG or placed on the drawing. Starters: cabin, plate, GA, 3D bracket.

Three layers of proof, all in the repo: unit tests against closed forms (`npm test`), a headless smoke check that the built app paints (`npm run smoke` equivalent via `scripts/smoke.mjs`), and a full acceptance run that drives every feature in one continuous session with real pointer events (`npm run accept`). Performance claims are reproducible: `scripts/csgbench.mjs` and `scripts/drawbench.mjs`.

Still ahead: ODA-grade DWG that every AutoCAD build opens without Recover, B-rep solids, a hosted share link (maybe), inference-grade 3D snapping. Collaboration only after the kernel is something you can import — it already is.

```
npm test
node bin/sovereign-draft.js --sample --pdf cabin.pdf
node bin/sovereign-draft.js examples/part.json --dxf part.dxf
node bin/sovereign-draft.js examples/ga.json --pdf ga.pdf
```

## Development

```
npm test          # vitest (geometry, modify, dxf, pdf, AI schema, sheet sets, 3D kernel)
npm run dev       # Vite, browser CAD
npm run build     # static PWA + embed.html
npm run accept    # the whole program in one pass, against the built app
npm run examples  # rewrite examples/*.json from the kernel
node scripts/smoke.mjs      # the built app loads, paints, no page errors
node scripts/csgbench.mjs   # CSG boolean performance, verified against closed forms
node scripts/drawbench.mjs  # DRAWINGS at campus scale
node bin/sovereign-draft.js --sample --pdf cabin.pdf
```

`src/api.js` is the kernel. No DOM. `src/core` is plain JS. That is the split.

## License

MIT. Use it, sell prints you drew, ship it in your repo. Do not pretend it is a PE stamp.
