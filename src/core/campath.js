/* Camera paths through saved 3D views.
 *
 * A walkthrough is a uniform Catmull-Rom spline through the saved camera
 * positions and targets, with the field of view blended linearly inside
 * each segment. Catmull-Rom interpolates its control points, so the
 * camera passes through every saved view exactly, and it reproduces
 * straight lines exactly when the views are collinear and equally
 * spaced. The ends use reflected phantom points (2a - b), which keep
 * that linear reproduction on the first and last segments too; doubled
 * endpoints would halve the end tangents and bend a straight dolly.
 * Everything here is pure math on plain arrays: no three.js, no DOM. */

function cr1(p0, p1, p2, p3, t){
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1
    + (p2 - p0) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

function cr3(a, b, c, d, t){
  return [cr1(a[0], b[0], c[0], d[0], t),
          cr1(a[1], b[1], c[1], d[1], t),
          cr1(a[2], b[2], c[2], d[2], t)];
}

/* One camera state along the path. u runs 0..1 over the whole path;
 * u = k/(n-1) lands exactly on views[k]. Needs at least two views. */
export function samplePath(views, u){
  const n = views.length;
  if (!n) return null;
  if (n === 1) return { pos: views[0].pos.slice(), target: views[0].target.slice(), fov: views[0].fov };
  const t = Math.max(0, Math.min(1, u));
  const segs = n - 1;
  /* Clamp so u=1 falls inside the last segment at local t=1. */
  const k = Math.min(segs - 1, Math.floor(t * segs));
  const lt = t * segs - k;
  const reflect = (a, b) => ({
    pos: [2 * a.pos[0] - b.pos[0], 2 * a.pos[1] - b.pos[1], 2 * a.pos[2] - b.pos[2]],
    target: [2 * a.target[0] - b.target[0], 2 * a.target[1] - b.target[1], 2 * a.target[2] - b.target[2]],
    fov: 2 * a.fov - b.fov,
  });
  const at = i => {
    if (i < 0) return reflect(views[0], views[1]);
    if (i > n - 1) return reflect(views[n - 1], views[n - 2]);
    return views[i];
  };
  const v0 = at(k - 1), v1 = at(k), v2 = at(k + 1), v3 = at(k + 2);
  return {
    pos: cr3(v0.pos, v1.pos, v2.pos, v3.pos, lt),
    target: cr3(v0.target, v1.target, v2.target, v3.target, lt),
    fov: v1.fov + (v2.fov - v1.fov) * lt,
  };
}

/* Smooth start and stop for playback time. Exact at both ends. */
export function easeInOut(t){
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
