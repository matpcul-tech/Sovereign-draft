/* Sample 24×36 cabin used for tests and the "Load sample" command.
 * Walls with thickness, filleted corners (r=0), doors as dynamic INSERTs,
 * room hatches, overall + opening dims, dashed centerline.
 */
import { wallFrags, wallWithOpenings } from './walls.js';
import { makeHatch } from './hatch.js';
import { alignedDim } from './dimStyle.js';
import { filletLines } from './modify.js';
import { makeInsert, locateInsert } from './dynblock.js';
import { tagInserts, buildSchedule, makeTable } from './schedule.js';
import { detectRooms, nameRoomsFromText } from './rooms.js';
import { makeGrid } from './grid.js';
import { bindAlignedDim } from './assoc.js';
import { makeFcf, makeDatum } from './gdt.js';

function gid(n){ return 'cab' + n; }

export function cabin24x36(){
  const ents = [];
  let g = 1;
  function wall(x1, y1, x2, y2, th){
    const id = gid(g++);
    const fr = wallFrags(x1, y1, x2, y2, th || 0.5, 'WALLS');
    fr.forEach(f => { f.g = id; ents.push(f); });
    return { id, members: fr, a: [x1, y1, x2, y2] };
  }
  const th = 0.5;
  const S = wall(0, 0, 36, 0, th);     // south
  const E = wall(36, 0, 36, 24, th);   // east
  const N = wall(36, 24, 0, 24, th);   // north
  const W = wall(0, 24, 0, 0, th);     // west
  /* Interior: bedroom wall at x=14, kitchen wall at y=10 from x=0 to 14 */
  const I1 = wall(14, 0, 14, 24, th);
  const I2 = wall(0, 10, 14, 10, th);

  function corner(a, b){
    const la = a.members.find(m => m.role === 'a');
    const lb = b.members.find(m => m.role === 'a');
    if (!la || !lb) return;
    const res = filletLines(la, lb, 0);
    if (!res.ok) return;
    res.replace.forEach(p => {
      const i = ents.indexOf(p.orig);
      if (i >= 0) ents[i] = p.ents[0];
    });
  }
  corner(S, E); corner(E, N); corner(N, W); corner(W, S);

  function openWall(wref, t, kind, width, swing){
    const cl = { x1: wref.a[0], y1: wref.a[1], x2: wref.a[2], y2: wref.a[3], th, layer: 'WALLS' };
    const ins = makeInsert({
      def: kind,
      name: kind === 'window' ? 'Window' : 'Door',
      layer: 'DOORS',
      width, swing: swing || 'L', host: wref.id, t, cl, th
    });
    locateInsert(ins, cl);
    ents.push(ins);
    const onWall = ents.filter(e => e.type === 'insert' && e.host === wref.id);
    for (let i = ents.length - 1; i >= 0; i--) if (ents[i].g === wref.id) ents.splice(i, 1);
    const add = wallWithOpenings(cl, onWall.map(e => ({ t: e.t, width: e.width || 3 })));
    add.forEach(f => { f.g = wref.id; ents.push(f); });
    wref.members = add;
  }
  openWall(S, 0.35, 'door', 3, 'L');          // front door
  openWall(I1, 0.25, 'door', 2.5, 'R');       // bedroom
  openWall(I2, 0.5, 'door', 2.5, 'L');        // kitchen
  openWall(N, 0.2, 'window', 3);              // north window
  openWall(E, 0.5, 'window', 4);

  const kitchen = [[0.5, 10.5], [13.5, 10.5], [13.5, 23.5], [0.5, 23.5]];
  const bedroom = [[14.5, 0.5], [35.5, 0.5], [35.5, 23.5], [14.5, 23.5]];
  const living = [[0.5, 0.5], [13.5, 0.5], [13.5, 9.5], [0.5, 9.5]];
  ents.push(makeHatch(kitchen, { layer: 'HATCH', pattern: 'ANSI31' }));
  ents.push(makeHatch(bedroom, { layer: 'HATCH', pattern: 'ANSI31' }));
  ents.push(makeHatch(living, { layer: 'HATCH', pattern: 'NET' }));
  ents.push({ type: 'text', layer: 'TEXT', x: 4.5, y: 16, size: 1.4, content: 'KITCHEN' });
  ents.push({ type: 'text', layer: 'TEXT', x: 22, y: 12, size: 1.4, content: 'BEDROOM' });
  ents.push({ type: 'text', layer: 'TEXT', x: 4.5, y: 4.5, size: 1.4, content: 'LIVING' });

  ents.push(alignedDim([0, 0], [36, 0], -2.5));
  ents.push(alignedDim([0, 0], [0, 24], -2.5));
  ents.push(alignedDim([0, 24], [14, 24], 2));
  ents.push(alignedDim([14, 0], [36, 0], 2));
  ents.forEach(e => { if (e.type === 'dim') bindAlignedDim(e, ents); });

  ents.push({ type: 'line', layer: 'CENTER', lt: 'CENTER', x1: 18, y1: -1, x2: 18, y2: 25 });

  const rooms = nameRoomsFromText(detectRooms(ents), ents);
  rooms.forEach(r => ents.push(r));
  ents.push(makeGrid({ x: 0, y: 0, cols: 3, rows: 2, cx: 12, ry: 12 }));

  ents.push(makeInsert({ def: 'sym:Stove', name: 'Stove', layer: 'FIXTURES', x: 2.5, y: 22 }));
  ents.push(makeInsert({ def: 'sym:Fridge', name: 'Fridge', layer: 'FIXTURES', x: 5.5, y: 22, rot: 90 }));

  tagInserts(ents);
  ents.push(Object.assign(buildSchedule(ents, 'door', [38, 16]), { layer: 'SCHEDULES' }));
  ents.push(Object.assign(buildSchedule(ents, 'window', [38, 8]), { layer: 'SCHEDULES' }));
  ents.push(Object.assign(buildSchedule(ents, 'room', [38, 0]), { layer: 'SCHEDULES' }));

  return ents.filter(Boolean);
}

/* 12" × 8" plate — a part, not a building. GD&T only with a real tolerance. */
export function partPlate(){
  const ents = [];
  const w = 1, h = 8 / 12, r = 0.5 / 12;
  ents.push({ type: 'profile', layer: 'WALLS', pts: [[0, 0], [w, 0], [w, h], [0, h]], fill: false });
  ents.push({ type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [w, 0], [w, h], [0, h]], lw: 0.5 });
  [[0.2, 0.2], [0.8, 0.2], [0.8, h - 0.2], [0.2, h - 0.2]].forEach((p, i) => {
    ents.push({ type: 'circle', layer: 'DOORS', cx: p[0], cy: p[1], r, id: 'h' + i });
  });
  ents.push(alignedDim([0, 0], [w, 0], -0.22));
  ents.push(alignedDim([0, 0], [0, h], -0.22));
  ents.push(alignedDim([0.2, 0.2], [0.8, 0.2], 0.18));
  const fcf = makeFcf({ char: 'position', tol: 0.01 / 12, datum: 'A', x: 1.15, y: 0.45, h: 0.12 });
  if (fcf) ents.push(fcf);
  ents.push(makeDatum({ letter: 'A', x: 0.5, y: -0.08, h: 0.12 }));
  ents.push({ type: 'text', layer: 'NOTES', x: 0, y: h + 0.28, size: 0.12, content: 'PLATE  12" x 8"  4x 0.50" HOLES' });
  ents.push({ type: 'text', layer: 'NOTES', x: 0, y: h + 0.12, size: 0.09, content: 'MATERIAL AS SPECIFIED BY THE BUYER  ·  DO NOT SCALE' });
  ents.forEach(e => { if (e.type === 'dim') bindAlignedDim(e, ents); });
  return ents.filter(Boolean);
}

/* General arrangement. Stations and a parts list — not a build spec. */
export function gaDiagram(){
  const ents = [];
  const body = [[0, 0], [4, 0], [4, 18], [2, 22], [0, 18]];
  ents.push({ type: 'profile', layer: 'WALLS', pts: body, fill: 'ANSI31' });
  ents.push({ type: 'poly', layer: 'WALLS', closed: true, pts: body, lw: 0.5 });
  ents.push({ type: 'centerline', layer: 'CENTER', pts: [[2, -1], [2, 23]] });
  ;[0, 6, 12, 18, 22].forEach((y, i) => {
    ents.push({ type: 'line', layer: 'DIMS', x1: 4.3, y1: y, x2: 4.7, y2: y });
    ents.push({ type: 'text', layer: 'TEXT', x: 4.85, y: y - 0.15, size: 0.35, content: 'STA ' + (i * 50) });
  });
  ents.push(alignedDim([0, 0], [4, 0], -1.2));
  ents.push(alignedDim([2, 0], [2, 22], 3.4));
  ents.push({ type: 'text', layer: 'NOTES', x: -0.2, y: 23.4, size: 0.45, content: 'GENERAL ARRANGEMENT' });
  ents.push({ type: 'text', layer: 'NOTES', x: -0.2, y: 22.8, size: 0.28, content: 'NOT A BUILD SPEC  ·  NO MATERIALS INVENTED' });
  const tbl = makeTable({
    title: 'PARTS',
    x: 8, y: 16,
    colW: [1.4, 3.2, 1.2],
    headers: ['MK', 'ITEM', 'QTY'],
    rows: [
      ['M1', 'AFT BODY', '1'],
      ['M2', 'STACK', '1'],
      ['M3', 'NOSE', '1']
    ]
  });
  if (tbl) ents.push(Object.assign(tbl, { layer: 'SCHEDULES' }));
  ents.forEach(e => { if (e.type === 'dim') bindAlignedDim(e, ents); });
  return ents.filter(Boolean);
}
