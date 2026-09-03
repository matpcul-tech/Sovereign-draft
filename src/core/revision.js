/* Revisions: the delta, the cloud it tags, and the block that records it.
 *
 * A set that has been issued does not get quietly redrawn. A change gets
 * clouded, the cloud gets a numbered triangle beside it, and the sheet's
 * revision block gains a row saying what changed and when. That row is
 * how a builder standing at the tailgate knows the sheet in their hand is
 * newer than the one taped to the wall, and which part of it moved.
 *
 * The delta is an entity like any other, so it plots, exports and round
 * trips through the same paths as a datum. The revision list lives on the
 * document, so it is saved, undone and carried into the project file.
 */

/* A revision record. Numbers are 1-based and never reused: deleting rev 2
 * leaves 1 and 3, because a sheet already went out stamped 2. */
export function makeRevision(opts){
  const o = opts || {};
  return {
    num: Math.max(1, Math.round(Number(o.num) || 1)),
    date: String(o.date || '').slice(0, 24),
    note: String(o.note || '').slice(0, 120),
    by: String(o.by || '').slice(0, 24),
  };
}

export function nextRevNumber(revisions){
  let n = 0;
  for (const r of revisions || []) if (r && Number(r.num) > n) n = Number(r.num);
  return n + 1;
}

/* Add a revision, returning a new list. The caller keeps document
 * mutation and undo in one place. */
export function addRevision(revisions, opts){
  const list = (revisions || []).slice();
  const o = opts || {};
  list.push(makeRevision({
    num: o.num != null ? o.num : nextRevNumber(list),
    date: o.date || todayStamp(),
    note: o.note,
    by: o.by,
  }));
  list.sort((a, b) => a.num - b.num);
  return list;
}

export function todayStamp(d){
  const t = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}

/* The numbered triangle that sits beside a revision cloud. */
export function makeDelta(opts){
  const o = opts || {};
  return {
    type: 'delta',
    layer: o.layer || 'NOTES',
    x: o.x != null ? o.x : (o.at && o.at[0]) || 0,
    y: o.y != null ? o.y : (o.at && o.at[1]) || 0,
    num: Math.max(1, Math.round(Number(o.num) || 1)),
    h: o.h || 0.6,
  };
}

/* An equilateral triangle sitting on its base with the number inside.
 * The same shape a drafter draws by hand, so it reads at any scale. */
export function expandDelta(e){
  const h = (e && e.h) || 0.6;
  const x = (e && e.x) || 0, y = (e && e.y) || 0;
  const half = h * 0.577;
  const tri = {
    type: 'poly',
    closed: true,
    layer: e.layer,
    pts: [[x, y + h], [x - half, y], [x + half, y]],
  };
  const label = String((e && e.num) != null ? e.num : 1);
  const size = h * 0.46;
  const txt = {
    type: 'text',
    layer: e.layer,
    /* Centered on the triangle's centroid, which sits a third up. */
    x: x - label.length * size * 0.28,
    y: y + h * 0.22,
    size,
    content: label,
  };
  return [tri, txt];
}

export function deltaBBox(e, bb){
  const h = (e && e.h) || 0.6;
  const half = h * 0.577;
  const x = (e && e.x) || 0, y = (e && e.y) || 0;
  if (x - half < bb[0]) bb[0] = x - half;
  if (y < bb[1]) bb[1] = y;
  if (x + half > bb[2]) bb[2] = x + half;
  if (y + h > bb[3]) bb[3] = y + h;
  return bb;
}

/* Which revisions a sheet actually carries: the deltas drawn on it, not
 * every revision the project has ever had. A sheet that did not change
 * in rev 3 does not claim rev 3. */
export function revisionsOnSheet(entities, revisions){
  const nums = new Set();
  for (const e of entities || []) if (e && e.type === 'delta') nums.add(Number(e.num));
  return (revisions || []).filter(r => nums.has(Number(r.num)));
}

/* Rows for the sheet's revision block, newest first, the way the block is
 * read: a builder looks at the top row to see what is current. */
export function revisionRows(revisions){
  return (revisions || [])
    .slice()
    .sort((a, b) => b.num - a.num)
    .map(r => [String(r.num), r.date || '', r.note || '']);
}

/* The scalloped outline a cloud gets around a bounding box, so REVCLOUD
 * can wrap a selection instead of being traced by hand. */
export function cloudAround(bb, pad){
  const p = pad == null ? 0.5 : pad;
  const x0 = bb[0] - p, y0 = bb[1] - p, x1 = bb[2] + p, y1 = bb[3] + p;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
