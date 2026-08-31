/* A uniform grid index over entity bounding boxes.
 *
 * Picking and box selection scan every entity in the drawing, and the
 * renderer draws every entity whether or not it is on screen. That is fine
 * for a few hundred objects and it is the wall for a real drawing: a
 * building plan runs to tens of thousands, and a pick that walks all of them
 * costs milliseconds on every mouse move.
 *
 * A uniform grid suits CAD better than a tree: drawings spread fairly evenly
 * over their extents, buckets are cheap to build, and a query touches only
 * the cells a box actually covers. The index is rebuilt from scratch when the
 * drawing changes rather than maintained incrementally, because a rebuild is
 * a single pass and incremental maintenance is where stale-index bugs live.
 */
import { entBBox } from './entities.js';

/* Below this an index costs more than the scan it replaces. */
export const INDEX_MIN = 400;
/* Aim for a few entities per cell. */
export const TARGET_PER_CELL = 4;
export const MAX_CELLS = 262144;

export function entityBox(e){
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  entBBox(e, bb);
  if (!Number.isFinite(bb[0]) || !Number.isFinite(bb[1]) || !Number.isFinite(bb[2]) || !Number.isFinite(bb[3])) return null;
  return bb;
}

export function buildIndex(entities){
  const ents = entities || [];
  const boxes = new Array(ents.length);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let counted = 0;
  for (let i = 0; i < ents.length; i++){
    const b = entityBox(ents[i]);
    boxes[i] = b;
    if (!b) continue;
    counted++;
    if (b[0] < x0) x0 = b[0];
    if (b[1] < y0) y0 = b[1];
    if (b[2] > x1) x1 = b[2];
    if (b[3] > y1) y1 = b[3];
  }
  if (!counted) return { empty: true, ents, boxes, cells: null };

  const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
  const want = Math.max(1, Math.ceil(counted / TARGET_PER_CELL));
  /* Square-ish cells: pick a side length from the area per cell. */
  let side = Math.sqrt((w * h) / want) || 1;
  let nx = Math.max(1, Math.min(2048, Math.ceil(w / side)));
  let ny = Math.max(1, Math.min(2048, Math.ceil(h / side)));
  while (nx * ny > MAX_CELLS){ nx = Math.max(1, nx >> 1); ny = Math.max(1, ny >> 1); }
  const cw = w / nx, ch = h / ny;

  const cells = new Array(nx * ny);
  for (let i = 0; i < ents.length; i++){
    const b = boxes[i];
    if (!b) continue;
    const cx0 = clampCell((b[0] - x0) / cw, nx), cx1 = clampCell((b[2] - x0) / cw, nx);
    const cy0 = clampCell((b[1] - y0) / ch, ny), cy1 = clampCell((b[3] - y0) / ch, ny);
    for (let cy = cy0; cy <= cy1; cy++){
      for (let cx = cx0; cx <= cx1; cx++){
        const k = cy * nx + cx;
        if (cells[k]) cells[k].push(i); else cells[k] = [i];
      }
    }
  }
  return { empty: false, ents, boxes, cells, nx, ny, cw, ch, x0, y0, x1, y1, count: counted };
}

function clampCell(v, n){
  const i = Math.floor(v);
  return i < 0 ? 0 : (i >= n ? n - 1 : i);
}

/* Indices of entities whose bounding box overlaps the query box, ascending.
 * Each is reported once even when it spans many cells.
 *
 * Ascending order is part of the contract, not a convenience: entity index is
 * draw order, so a caller that wants the topmost hit walks the result
 * backwards, and one that repaints has to paint in the same sequence the full
 * list would have. Cell traversal order is neither. */
export function queryIndices(idx, box){
  if (!idx || idx.empty || !idx.cells) return [];
  if (box[2] < idx.x0 || box[0] > idx.x1 || box[3] < idx.y0 || box[1] > idx.y1) return [];
  const cx0 = clampCell((box[0] - idx.x0) / idx.cw, idx.nx), cx1 = clampCell((box[2] - idx.x0) / idx.cw, idx.nx);
  const cy0 = clampCell((box[1] - idx.y0) / idx.ch, idx.ny), cy1 = clampCell((box[3] - idx.y0) / idx.ch, idx.ny);
  const seen = new Set();
  const out = [];
  for (let cy = cy0; cy <= cy1; cy++){
    for (let cx = cx0; cx <= cx1; cx++){
      const bucket = idx.cells[cy * idx.nx + cx];
      if (!bucket) continue;
      for (let j = 0; j < bucket.length; j++){
        const i = bucket[j];
        if (seen.has(i)) continue;
        seen.add(i);
        const b = idx.boxes[i];
        /* The cell only says the boxes might overlap. Check that they do. */
        if (b[0] <= box[2] && b[2] >= box[0] && b[1] <= box[3] && b[3] >= box[1]) out.push(i);
      }
    }
  }
  return cx1 > cx0 || cy1 > cy0 ? out.sort((a, b) => a - b) : out;
}

export function queryBox(idx, box){
  return queryIndices(idx, box).map(i => idx.ents[i]);
}

/* Entities near a point, in draw order like every other query. */
export function queryPoint(idx, x, y, tol){
  const t = tol || 0;
  return queryIndices(idx, [x - t, y - t, x + t, y + t]);
}

/* A cache that rebuilds only when the drawing has actually changed. The
 * stamp is supplied by the caller, so the index never has to guess whether a
 * mutation happened. */
export function makeIndexCache(){
  let idx = null, stamp = null, len = -1;
  return {
    get(entities, s){
      if (idx && s === stamp && entities.length === len && idx.ents === entities) return idx;
      idx = buildIndex(entities);
      stamp = s;
      len = entities.length;
      return idx;
    },
    clear(){ idx = null; stamp = null; len = -1; }
  };
}

/* Whether an index is worth building at all. */
export function worthIndexing(entities){
  return !!entities && entities.length >= INDEX_MIN;
}
