/* Built-in symbol library. Each make() returns fresh entity fragments centered
 * on the origin; the caller translates them to the tap point and groups them.
 */
function R(x, y, w, h, ly){ return { type: 'poly', layer: ly, closed: true, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }; }
function Ln(x1, y1, x2, y2, ly){ return { type: 'line', layer: ly, x1, y1, x2, y2 }; }
function Ci(cx, cy, r, ly){ return { type: 'circle', layer: ly, cx, cy, r }; }

export const SYMBOLS = [
  { name: 'Door', sub: "3' swing", make: () => [
    Ln(0, 0, 0, 3, 'DOORS'), { type: 'arc', layer: 'DOORS', cx: 0, cy: 0, r: 3, a1: 0, a2: 90 }
  ] },
  { name: 'Window', sub: "3' in wall", make: () => [
    Ln(-1.5, -0.25, 1.5, -0.25, 'DOORS'), Ln(-1.5, 0, 1.5, 0, 'DOORS'), Ln(-1.5, 0.25, 1.5, 0.25, 'DOORS'),
    Ln(-1.5, -0.25, -1.5, 0.25, 'DOORS'), Ln(1.5, -0.25, 1.5, 0.25, 'DOORS')
  ] },
  { name: 'Toilet', sub: 'plan', make: () => [
    R(-0.8, 0.5, 1.6, 0.7, 'FIXTURES'), Ci(0, -0.15, 0.62, 'FIXTURES')
  ] },
  { name: 'Sink', sub: 'vanity', make: () => [
    R(-0.9, -0.6, 1.8, 1.2, 'FIXTURES'), Ci(0, 0, 0.38, 'FIXTURES'), Ln(0, 0.38, 0, 0.6, 'FIXTURES')
  ] },
  { name: 'Tub', sub: "5' x 2'-6\"", make: () => [
    R(-2.5, -1.25, 5, 2.5, 'FIXTURES'), R(-2.1, -0.9, 4.2, 1.8, 'FIXTURES'), Ci(-1.6, 0, 0.15, 'FIXTURES')
  ] },
  { name: 'Shower', sub: "3' x 3'", make: () => [
    R(-1.5, -1.5, 3, 3, 'FIXTURES'), Ln(-1.5, -1.5, 1.5, 1.5, 'FIXTURES'), Ln(-1.5, 1.5, 1.5, -1.5, 'FIXTURES'), Ci(0, 0, 0.12, 'FIXTURES')
  ] },
  { name: 'Stove', sub: '4 burner', make: () => [
    R(-1.25, -1, 2.5, 2, 'FIXTURES'), Ci(-0.6, 0.42, 0.3, 'FIXTURES'), Ci(0.6, 0.42, 0.3, 'FIXTURES'), Ci(-0.6, -0.42, 0.3, 'FIXTURES'), Ci(0.6, -0.42, 0.3, 'FIXTURES')
  ] },
  { name: 'Fridge', sub: "3' x 2'-6\"", make: () => [
    R(-1.5, -1.25, 3, 2.5, 'FIXTURES'), Ln(-1.5, 0.3, 1.5, 0.3, 'FIXTURES')
  ] },
  { name: 'Bed', sub: 'queen', make: () => [
    R(-2.5, -3.35, 5, 6.7, 'FIXTURES'), Ln(-2.5, 2.3, 2.5, 2.3, 'FIXTURES'), Ln(-2.5, 1.5, -1.7, 2.3, 'FIXTURES')
  ] },
  { name: 'Sofa', sub: "7'", make: () => [
    R(-3.5, -1.5, 7, 3, 'FIXTURES'), Ln(-3.5, 0.9, 3.5, 0.9, 'FIXTURES'), Ln(-1.17, -1.5, -1.17, 0.9, 'FIXTURES'), Ln(1.17, -1.5, 1.17, 0.9, 'FIXTURES')
  ] },
  { name: 'Stairs', sub: "3' run", make: () => {
    const a = [R(-1.5, -5, 3, 10, 'FIXTURES')];
    for (let y = -4; y <= 4; y += 1) a.push(Ln(-1.5, y, 1.5, y, 'FIXTURES'));
    a.push(Ln(0, -4.4, 0, 4.2, 'FIXTURES')); a.push(Ln(-0.4, 3.5, 0, 4.2, 'FIXTURES')); a.push(Ln(0.4, 3.5, 0, 4.2, 'FIXTURES'));
    return a;
  } },
  { name: 'Table', sub: '4 seats', make: () => [
    R(-2, -1.5, 4, 3, 'FIXTURES'), R(-1, -2.3, 0.9, 0.7, 'FIXTURES'), R(0.1, -2.3, 0.9, 0.7, 'FIXTURES'), R(-1, 1.6, 0.9, 0.7, 'FIXTURES'), R(0.1, 1.6, 0.9, 0.7, 'FIXTURES')
  ] }
];
