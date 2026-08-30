# Sovereign Draft

Touch-first 2D CAD for schematic-to-CD architectural drafting. Runs entirely in the browser: decimal feet, Y-up, dimensions in feet-and-inches to the nearest ½″. The drawing never leaves the device until you export.

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

The sample cabin now includes live rooms, a 12′ column grid, tagged doors, a door / window / room schedule, associative overall dims, and the original dashed centerline.

**SVG** export (`SVG` or Sheet menu) for Illustrator / web. Object snaps include **TAN** from the last point onto a circle.

Layers lock (click the padlock — locked objects can't be selected) and a **P** plot flag (off = skip in PDF / SVG).

## Paper space

One model space + N layouts. Each layout has a sheet (Letter / Tabloid / Arch D), plot scale, title block, and viewports that clip + scale model geometry. PDF export plots the active layout at the chosen architectural scale.

**Sheet set** (`SHEETSET` / `SS`, or Sheet → Generate sheets) splits the model into a real CAD sheet set: **G-001** cover with a drawing index, **A-101** overall, and one sheet per room or labeled section. Each page carries a legend of the layers, symbols and callouts actually visible in that view. Export all sheets as one PDF from the Sheet menu. PageUp / PageDown walks the set.

## DXF

Sovereign Draft **is the editor**. Open a `.dxf` (or drop it on the sheet) and it becomes the drawing — no second CAD required.

**Open** (`OPEN`, Sheet → Open drawing, or drop a file) replaces the sheet. **Insert DXF** (`DXFIN`) merges into the current drawing. `.json` project files open the same way. `.dwg` is binary and cannot be read; Save As DXF in the other program, then Open here.

**Units.** World units are decimal feet, Y-up. The writer stamps `$INSUNITS=2`. The reader honors `$INSUNITS` (inches, mm, cm, meters → feet). If the header is missing and coordinates look like millimetres (max > 2000), they are scaled to feet; otherwise feet are assumed. A 36 ft cabin is never auto-scaled.

**In:** LINE, ARC, CIRCLE, ELLIPSE, TEXT, MTEXT (flattened), LWPOLYLINE, POLYLINE, SPLINE (as polyline), SOLID / 3DFACE, INSERT (block geometry), HATCH, XLINE, RAY, DIMENSION (aligned), LEADER.  
**Out:** R12 (POLYLINE + LTYPE table + 370 weights + `$INSUNITS`) or R2000 (LWPOLYLINE). Toggle in the Sheet menu. Inserts, rooms and dims explode to ordinary geometry on export. Stays pure JS.

## AI drafting (BYO Anthropic key)

Key lives in `localStorage`, calls only `api.anthropic.com`, **adds only** — undo drops a pass. Sheet-context mode reads existing walls and appends. Invalid JSON is retried once, then toasted. Never deletes user entities.

Claude is asked for this schema (not leftover raw lines):

```json
{
  "walls": [{ "a": [x1, y1, x2, y2], "th": 0.5 }],
  "openings": [{ "kind": "door|window", "wall": 0, "t": 0.5, "w": 3, "swing": "L|R" }],
  "fixtures": [{ "kind": "Toilet|Sink|Tub|Shower|Stove|Fridge|Bed|Sofa|Stairs|Table", "x": 0, "y": 0, "rot": 0 }],
  "rooms": [{ "name": "KITCHEN", "pts": [[x, y], ...] }],
  "dims": [{ "a": [x1, y1, x2, y2] }]
}
```

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

## Development

```
npm test          # vitest (geometry, modify, dxf, pdf, AI schema) + workspace gates
npm run build     # static PWA
```
