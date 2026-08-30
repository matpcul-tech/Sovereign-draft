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
| `/` | Focus command line | | |

**Wall mode** draws two parallel faces + caps. Thickness chip: 4″ / 6″ / 8″. Doors and windows are **dynamic INSERT blocks**: stretch the width grip, tap the diamond to flip swing, type `2'6"` with the door selected. They recut the host wall. **Explode** (`XP`) yields ordinary lines and arcs. Fixtures (stove, bed, …) are the same INSERT type with rotate + flip grips.

## Modify

| Key | Command | Key | Command |
|-----|---------|-----|---------|
| `O` | Offset | `X` | Trim |
| `E` | Extend | `B` | Fillet (incl. r=0) |
| `N` | Chamfer | `I` | Mirror |
| `G` | Scale | `W` | Move |
| `U` | Copy | `Y` | Rectangular array |
| `J` | Join | `XP` | Explode block |

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

`F3` SNAP · `F8` ORTHO · `F10` POLAR (15°) · `Esc` cancel · `Enter` finish polyline / join.

## Dim styles

Named styles (`ARCH` tick / `ARROW` / `DECIMAL`) with text height, offset, tick vs arrow, precision (½″ / ¼″ / decimal) and layer. Tools: aligned, continue, baseline. DXF export still explodes dimensions to R12 LINE+TEXT.

## Paper space

One model space + N layouts. Each layout has a sheet (Letter / Tabloid / Arch D), plot scale, title block, and viewports that clip + scale model geometry. PDF export plots the active layout at the chosen architectural scale.

## DXF

**In:** LINE, ARC, CIRCLE, TEXT, MTEXT (flattened), LWPOLYLINE, POLYLINE, INSERT (as a block group), HATCH.  
**Out:** R12 (POLYLINE + LTYPE table + 370 weights) or R2000 (LWPOLYLINE). Toggle in the Sheet menu. Stays pure JS.

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

Type a length (`3`, `2'6"`) with a door or window selected to set width. Properties sheet also edits width and swing. Copy of a hosted insert detaches it (does not punch a second opening). DXF and PDF expand inserts to ordinary geometry so LibreCAD still opens the file.

## Privacy

Autosave to `localStorage`. No account, no backend. The only optional network call is `api.anthropic.com` with your key.

## Development

```
npm test          # vitest (geometry, modify, dxf, pdf, AI schema) + workspace gates
npm run build     # static PWA
```
