# Sovereign Draft

The CAD program you open when you don’t have a license — and shouldn’t need one.

Browser 2D CAD. No account, no install, no seat. Decimal feet, Y-up, dimensions to the nearest ½″. The drawing stays on the device until you export. A sentence can become a sheet set; a JSON file can live in git next to the code.

This is how we democratize CAD: the 80% of drawings that are plans, elevations, and diagrams, at zero cost, with an AutoCAD-shaped command line so it still feels like CAD.

## What it is

| You get | You don’t |
|---|---|
| 2D drafting in the browser (PWA) | 3D solids, CAM, or CATIA |
| Command line (`L`, `TR`, `@8<45`, F8) | Native DWG (open DXF instead) |
| Issued sheets: title block, copyright, multi-page PDF | Shop-floor GD&T / welding maps |
| `SHEETSET` — cover, overall, one page per room or part | A substitute for a professional of record |
| AI first pass (your Anthropic key) | Invented materials or pretended tolerances |
| JSON you can diff in git + DXF in/out | A server that holds your drawings |

A cabin floor plan with walls, doors, rooms, dims, and a G-001/A-101 set is the job. A rocket silhouette with a parts table is a general arrangement, not a build spec — we will not pretend otherwise.

## Cost

The editor is free. Geometry is local. The only optional network call is `api.anthropic.com` with **your** key. No seat, no trial, no watermark.

Later we may charge for hosted AI (so you don’t paste a key) and share links. Never for drawing.

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
| `GRID` | Column grid | `OPEN` | Open DXF / JSON |
| `DXFIN` | Insert DXF (merge) | `SHEETSET` | Generate sheet set |

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

Named styles (`ARCH` tick / `ARROW` / `DECIMAL`) with text height, offset, tick vs arrow, precision (½″ / ¼″ / decimal) and layer. Tools: aligned, continue, baseline, **angular** (`DAN`), **radius** (`DRA`), **diameter** (`DDI`). Linear dims **bind to wall ends** and follow when the wall moves. DXF export still explodes dimensions to R12 LINE+TEXT.

## Construction documents

Door / window / room **schedules** (`SCH` or Sheet → Place schedules) auto-tag inserts `D01`, `W01` and drop a live `table` entity. Explode a table into lines + text. Export a door takeoff as CSV from the Sheet menu.

**Image underlay** (`IMG` / Trace image): pick a photo, tap two corners. `CAL` then two taps + a typed length scales the raster to a known dimension. Underlays live on the `UNDERLAY` layer (`plot` off so they don't print).

**Stretch** (`ST`): crossing-window the vertices to move, then pick a displacement. Walls, polylines, hatches, ellipses and inserts all stretch.

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

One model space + N layouts. Each layout has a sheet (Letter / Tabloid / Arch D / Arch D portrait), plot scale, and viewports that clip + scale model geometry. PDF export plots an **issued sheet**: double border, a title block (ISSUED BY / PROJECT / DRAWING TITLE / SCALE / SHEET), and your company copyright. Set the firm name, copyright line and “drawn by” in the Sheet menu — they stamp every page and stay on this device.

**Sheet set** (`SHEETSET` / `SS`, or Sheet → Generate sheets) splits the model into pages:

- **G-001** cover — drawing index plus a parts schedule (mark, qty, description, size) or a room schedule on floor plans
- **A-101** overall
- **A-102…** one sheet per room or labeled section, with that sheet’s specifications

Envelope dimensions (overall height and width) are stamped when the model has none. Each page carries a legend of the layers, symbols and callouts in that view. Quantities come from marks and `x9`-style labels; sizes come from the station or from attributes you (or the AI) actually set. Materials stay blank unless named. Export all sheets as one PDF from the Sheet menu. PageUp / PageDown walks the set.

A sheet set is a general arrangement plus a schedule. It is not a manufacturing package.

## Files

The project JSON is the source of truth — plain objects, diffable in git, next to the repo. DXF and PDF are exports.

**Open** (`OPEN`, Sheet → Open drawing, or drop a file) replaces the sheet. **Insert DXF** (`DXFIN`) merges into the current drawing. `.json` project files open the same way. `.dwg` is binary and cannot be read yet; Save As DXF in the other program, then Open here.

**Units.** World units are decimal feet, Y-up. The writer stamps `$INSUNITS=2`. The reader honors `$INSUNITS` (inches, mm, cm, meters → feet). If the header is missing and coordinates look like millimetres (max > 2000), they are scaled to feet; otherwise feet are assumed. A 36 ft cabin is never auto-scaled.

**In:** LINE, ARC, CIRCLE, ELLIPSE, TEXT, MTEXT (flattened), LWPOLYLINE, POLYLINE, SPLINE (as polyline), SOLID / 3DFACE, INSERT (block geometry), HATCH, XLINE, RAY, DIMENSION (aligned), LEADER.  
**Out:** R12 (POLYLINE + LTYPE table + 370 weights + `$INSUNITS`) or R2000 (LWPOLYLINE). Toggle in the Sheet menu. Inserts, rooms and dims explode to ordinary geometry on export. Stays pure JS.

## AI drafting (BYO Anthropic key)

Key lives in `localStorage`, calls only `api.anthropic.com`, **adds only** — undo drops a pass. Sheet-context mode reads existing walls and appends. Invalid JSON is retried once, then toasted. Never deletes user entities.

Claude is asked for a constrained schema (not leftover raw lines): walls, openings, fixtures, rooms, dims, profiles, centerlines, callouts. `drawingType` (`plan` / `elevation` / `section` / `part` / `diagram`) gates what is legal — a rocket does not get door swings; a floor plan does not get a nose cone.

Mark repeated parts (`"mark":"M1D"`, `"attrs":{"qty":9,"size":"…","material":"…"}`) so they schedule. Include material only when the user named one. A drawing with no dimensions cannot be built from — the model is told to emit overall height, width, and stations.

The app snaps to a 6″ grid, fillets wall corners, hatches rooms, and places overall + room dimensions.

## Status & properties

Status bar: X, Y, last length, last angle, SNAP / ORTHO / POLAR / WALL. Context chips **LT**, **LW**, and **DIM** cycle current linetype, millimetre lineweight, and dim style (`ARCH` ticks / `ARROW` / `DECIMAL`) — they also apply to the selection. Properties (the sheet button): edit layer, linetype, lineweight, dim style; length and area are read-only. Command history in the Sheet menu. Draw vs Modify are two independently swipeable rows so the toolstrip stays usable on a phone.

**Hatch (`K`):** tap a closed polyline or tap *inside* a closed shape / circle. Tap an existing hatch to cycle ANSI31 → ANSI32 → NET → SOLID. Or draw a boundary and Close.

## Dynamic blocks

Doors, windows and symbols are live `insert` entities (no frozen `g` group). Grips:

| Grip | Shape | Action |
|------|-------|--------|
| Move | square | Slide along the host wall, or free-move a fixture |
| Stretch | circle | Door leaf / window width (snaps to 1″) |
| Flip | diamond | Door swing L↔R, or mirror a fixture |
| Rotate | circle (red) | Fixture / user-block angle |

Type a length (`3`, `2'6"`) with a door or window selected to set width. Properties sheet also edits width and swing. Copy of a hosted insert detaches it (does not punch a second opening). DXF and PDF expand inserts to ordinary geometry.

## Privacy

Autosave to `localStorage`. No account, no backend. The only optional network call is `api.anthropic.com` with your key.

## Where this is going

The editor stays free. Next is CAD as infrastructure, not more title-block theater.

1. **Library + CLI** — `import { draw, pdf, dxf } from 'sovereign-draft'` and `npx sovereign-draft plan.json --pdf`, so a developer plots sheets from CI.
2. **Honest AI** — blank materials unless you named them; refuse a spec row with no size.
3. **Floor plans done** — isolated rooms, untruncated tables, marks on the view that match the schedule. One vertical a builder could use.
4. **DWG read** (one-way, wasm) — open what people already have. We still write JSON + DXF.
5. **Embed** — a drawing in *your* docs or app, not only in ours.

No 3D kernel. No seat license. Collaboration only after the kernel is something you can import.

## Development

```
npm test          # vitest (geometry, modify, dxf, pdf, AI schema, sheet sets)
npm run dev       # Vite, browser CAD
npm run build     # static PWA
```

The kernel in `src/core` is plain JS with no DOM. That’s the split the library will use.
