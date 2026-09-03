/* Layer names a drafter recognizes.
 *
 * Inside the app a layer is called WALLS because that is what it is. A
 * consultant who opens the DXF in AutoCAD expects the CAD Layer
 * Guidelines: A-WALL for walls, A-ANNO-DIMS for dimensions, S-GRID for
 * the structural grid. Getting a file whose layers read WALLS, DOORS,
 * TEXT is the moment they decide this came out of a toy and start
 * redrawing.
 *
 * So the names translate on the way out and back on the way in. Nothing
 * in the document changes: state.layers keeps the plain names, every
 * saved project and every test keeps working, and the mapping lives
 * here where it can be read and argued with.
 *
 * The map is one to one, so a file this app wrote and reads back lands
 * on exactly the layers it left. A name the map does not know passes
 * through untouched, which is what a user's own PLUMBING layer needs.
 */

/* Plain name -> the name on the sheet a consultant opens. Discipline
 * codes are the standard ones: A architectural, S structural. */
export const AIA = {
  WALLS:     'A-WALL',
  DOORS:     'A-DOOR',
  WINDOWS:   'A-GLAZ',
  FIXTURES:  'A-FLOR-FIXT',
  ROOMS:     'A-AREA-IDEN',
  SECTION:   'A-SECT',
  DIMS:      'A-ANNO-DIMS',
  TEXT:      'A-ANNO-TEXT',
  NOTES:     'A-ANNO-NOTE',
  HATCH:     'A-ANNO-PATT',
  SCHEDULES: 'A-ANNO-SCHD',
  GDT:       'A-ANNO-SYMB',
  CENTER:    'A-ANNO-CNTR',
  UNDERLAY:  'A-ANNO-REFR',
  GRID:      'S-GRID',
  /* DEFPOINTS is AutoCAD's own non-plotting layer. Renaming it would
   * break the one convention every drafter already relies on. */
  DEFPOINTS: 'DEFPOINTS',
};

const BACK = (() => {
  const b = {};
  for (const k of Object.keys(AIA)) if (AIA[k] !== k) b[AIA[k]] = k;
  return b;
})();

/* The AIA name for a plain layer, or the name itself if unmapped. */
export function toAIA(name){
  const n = String(name == null ? '' : name);
  return Object.prototype.hasOwnProperty.call(AIA, n) ? AIA[n] : n;
}

/* The plain name for an AIA layer, or the name itself if unmapped. */
export function fromAIA(name){
  const n = String(name == null ? '' : name);
  return Object.prototype.hasOwnProperty.call(BACK, n) ? BACK[n] : n;
}

/* Rename every layer reference in a batch of entities. Entities are
 * copied, never mutated: the document keeps its own names while the
 * export carries the translated ones. Nested block content travels too,
 * since a door block's geometry lands on layers of its own. */
export function mapEntityLayers(entities, fn){
  return (entities || []).map(e => renameOne(e, fn));
}

function renameOne(e, fn){
  if (!e || typeof e !== 'object') return e;
  const out = { ...e };
  if (out.layer != null) out.layer = fn(out.layer);
  if (Array.isArray(out.entities)) out.entities = out.entities.map(c => renameOne(c, fn));
  return out;
}

/* The same rename over a layer table. Duplicate names cannot appear
 * because the map is one to one over the names it knows and identity
 * everywhere else, but a table that already carried both WALLS and
 * A-WALL would collide, so the second one is dropped rather than
 * written twice into the DXF layer table. */
export function mapLayerTable(layers, fn){
  const seen = new Set();
  const out = [];
  for (const l of layers || []){
    const name = fn(l && l.name);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ ...l, name });
  }
  return out;
}
