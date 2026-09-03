/* The frozen handoff fixture.
 *
 * One cabin, exported the way a consultant receives it, committed to the
 * repo. The point is not that the file exists: it is that a human with an
 * AutoCAD seat opened this exact file once, confirmed it needed no
 * redraw, and wrote down what they saw. Everything they checked is in
 * MANIFEST.json, and this script asserts a freshly generated export
 * still satisfies it. When somebody changes the writer and the
 * consultant's file quietly loses its dimensions or flips to inches,
 * this fails by name instead of failing in their office.
 *
 * Run with --write to regenerate the fixture and its manifest after a
 * change that is meant to change the file. Run with no arguments to
 * verify. Regenerating is a claim that the file was opened again.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cabin24x36 } from '../src/core/demo.js';
import { defaultLayers } from '../src/core/state.js';
import { buildDXF, parseDXF } from '../src/io/dxf.js';

/* The names inside TABLE / LAYER, in file order. */
function layerTableOf(dxf){
  const L = dxf.split(/\r?\n/);
  const out = [];
  let inTable = false, isLayer = false, atLayer = false;
  for (let i = 0; i + 1 < L.length; i += 2){
    const code = L[i].trim(), val = L[i + 1];
    if (code === '0' && val === 'TABLE'){ inTable = true; isLayer = false; atLayer = false; continue; }
    if (code === '0' && val === 'ENDTAB'){ inTable = false; isLayer = false; atLayer = false; continue; }
    if (!inTable) continue;
    if (code === '2' && !isLayer){ isLayer = (val === 'LAYER'); continue; }
    if (code === '0'){ atLayer = isLayer && val === 'LAYER'; continue; }
    if (code === '2' && atLayer){ out.push(val); atLayer = false; }
  }
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'fixtures', 'handoff');
const DXF = join(dir, 'cabin.dxf');
const MAN = join(dir, 'MANIFEST.json');

/* The file a consultant gets: the cabin plan, R2000, AIA layer names,
 * decimal feet. Nothing is stripped for the fixture's convenience. */
export function handoffDXF(){
  return buildDXF(cabin24x36(), defaultLayers(), { ver: 'R2000' });
}

/* What a drafter can see and check without our source in front of them.
 * Each field is something that, if wrong, costs them a redraw. */
export function describe(dxf){
  const ents = parseDXF(dxf, n => String(n || '0'));
  const layers = [...new Set(ents.map(e => e.layer))].sort();
  const types = {};
  for (const e of ents) types[e.type] = (types[e.type] || 0) + 1;
  /* The layer table as written, not just the layers in use: an empty
   * layer still has to arrive with its colour and linetype. Walk the
   * LAYER table proper, or a regex over the whole file also collects
   * linetype and style names and the count means nothing. */
  const table = layerTableOf(dxf);
  const insunits = (dxf.match(/\$INSUNITS\r?\n *70\r?\n *(-?\d+)/) || [])[1];
  const xs = [], ys = [];
  for (const e of ents){
    if (typeof e.x1 === 'number'){ xs.push(e.x1, e.x2); ys.push(e.y1, e.y2); }
    if (Array.isArray(e.pts)) for (const p of e.pts){ xs.push(p[0]); ys.push(p[1]); }
  }
  return {
    acadver: (dxf.match(/\$ACADVER\r?\n *1\r?\n *(\S+)/) || [])[1],
    insunits: Number(insunits),
    unitsMean: Number(insunits) === 2 ? 'decimal feet' : 'NOT FEET',
    entityCount: ents.length,
    types,
    layersInUse: layers,
    layerTable: [...new Set(table)].sort(),
    extents: xs.length
      ? [+Math.min(...xs).toFixed(4), +Math.min(...ys).toFixed(4),
         +Math.max(...xs).toFixed(4), +Math.max(...ys).toFixed(4)]
      : null,
  };
}

const write = process.argv.includes('--write');
const dxf = handoffDXF();
const now = describe(dxf);

if (write){
  writeFileSync(DXF, dxf);
  writeFileSync(MAN, JSON.stringify(now, null, 2) + '\n');
  console.log('wrote fixtures/handoff/cabin.dxf and MANIFEST.json');
  console.log(now.entityCount + ' entities on ' + now.layersInUse.length + ' layers, ' + now.unitsMean);
  process.exit(0);
}

if (!existsSync(MAN)){
  console.error('No manifest. Run: node scripts/handoff.mjs --write');
  process.exit(1);
}
const want = JSON.parse(readFileSync(MAN, 'utf8'));
const bad = [];
const cmp = (k, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    bad.push('  ' + k + '\n    frozen: ' + JSON.stringify(a) + '\n    now:    ' + JSON.stringify(b));
};
for (const k of Object.keys(want)) cmp(k, want[k], now[k]);

/* The committed file is what a human actually opened, so it has to be
 * the file we would hand over today. */
if (existsSync(DXF) && readFileSync(DXF, 'utf8') !== dxf)
  bad.push('  cabin.dxf on disk is not what the writer produces now');

if (bad.length){
  console.error('HANDOFF DRIFT: the file a consultant receives changed.\n');
  console.error(bad.join('\n'));
  console.error('\nIf the change is intended, open the new cabin.dxf in AutoCAD,');
  console.error('confirm it still needs no redraw, then run:');
  console.error('  node scripts/handoff.mjs --write');
  process.exit(1);
}
console.log('HANDOFF OK  ' + now.entityCount + ' entities, ' +
  now.layerTable.length + ' layers, ' + now.unitsMean + ', ' + now.acadver);
