# The handoff fixture

One cabin, exported the way a consultant receives it: `cabin.dxf`.

The measure of this program is not that it draws. It is that a structural
engineer, a truss supplier or a drafter can open the file it sends and get
straight to work. If they redraw, the file did not arrive.

## What is frozen here

`cabin.dxf` is a real export: the sample cabin, R2000, written by the same
`buildDXF` the app's Export DXF button calls. `MANIFEST.json` records what
a drafter can see in it without our source in front of them.

`node scripts/handoff.mjs` regenerates the export and checks it still
matches. It fails loudly when the file a consultant would receive changes,
which is how a writer change that quietly drops the dimensions or flips
the units to inches gets caught here instead of in their office.

`node scripts/handoff.mjs --write` refreezes it. Doing that is a claim
that the new file was opened and checked again.

## What the file promises

- **Layer names a drafter recognizes.** `A-WALL`, `A-DOOR`, `A-GLAZ`,
  `A-FLOR-FIXT`, `A-AREA-IDEN`, `A-ANNO-DIMS`, `A-ANNO-TEXT`,
  `A-ANNO-NOTE`, `A-ANNO-PATT`, `A-ANNO-SCHD`, `A-ANNO-SYMB`,
  `A-ANNO-CNTR`, `A-ANNO-REFR`, `A-SECT`, `S-GRID`, and `DEFPOINTS` left
  alone because every drafter already relies on it. The app keeps calling
  its own layers WALLS and DOORS; the names translate on the way out and
  back on the way in, so a file this app writes reopens here unchanged.
- **Decimal feet.** `$INSUNITS` is 2. Nothing arrives at 1/12 scale.
- **Dimensions are dimensions.** They arrive as `DIMENSION`, not as five
  loose lines and a piece of text, so they stay associative and editable.
- **Hatches are hatches**, islands included, not a bundle of hatch lines.
- **Blocks carry their own layer.** A door's leaf and swing arc land on
  the door's layer, the way AutoCAD resolves block content.

## What still needs a human with a seat

Nothing in this repository can open AutoCAD. The checks above are
structural: they prove what is in the file, not what Autodesk's importer
makes of it. The handoff is only finished when somebody with a 2024 or LT
seat opens `cabin.dxf` and fills this in:

- [ ] Opens with no errors or recovery dialog
- [ ] Layer manager shows the names above, with plottable colours
- [ ] `UNITS` reads decimal feet, plan measures 36 ft across the long wall
- [ ] Dimensions are `DIMENSION` objects and update when stretched
- [ ] Hatches are associative `HATCH` objects
- [ ] Text is readable at plot scale, no gibberish glyphs
- [ ] Nothing needed redrawing

Attach the screenshot of the layer manager next to this file and record
the AutoCAD version and date. Until that list is ticked by a person, this
fixture proves the file is consistent, not that it is accepted.

Do not chase ODA-grade DWG write until this path is boring.
