import { describe, it, expect } from 'vitest';
import { AIA, toAIA, fromAIA, mapEntityLayers, mapLayerTable } from '../src/io/layermap.js';
import { buildDXF, openDXF, parseDXF } from '../src/io/dxf.js';
import { buildDWG } from '../src/io/dwgwrite.js';
import { defaultLayers } from '../src/core/state.js';
import { cabin24x36 } from '../src/core/demo.js';
import { makeInsert, expandInsert } from '../src/core/dynblock.js';

describe('the file a consultant opens', () => {
  const dxf = () => buildDXF(cabin24x36(), defaultLayers(), { ver: 'R2000' });

  it('carries layer names a drafter recognizes, and none of ours', () => {
    const names = [...new Set(parseDXF(dxf(), n => String(n || '0')).map(e => e.layer))];
    /* Every layer in use is either an AIA name or DEFPOINTS. Seeing
     * WALLS, DOORS or TEXT in a delivered DXF is the moment a
     * consultant decides this came out of a toy. */
    for (const n of names)
      expect(n === 'DEFPOINTS' || /^[AS]-[A-Z]+(-[A-Z]+)*$/.test(n),
        n + ' is not a name a drafter expects').toBe(true);
    expect(names).toContain('A-WALL');
    expect(names).toContain('A-DOOR');
    expect(names).toContain('A-ANNO-DIMS');
    expect(names).toContain('A-ANNO-TEXT');
  });

  it('is decimal feet, stated in the header', () => {
    /* $INSUNITS 2 is feet. An import that lands at 1/12 scale is the
     * other way a handoff dies. */
    expect(dxf()).toContain('$INSUNITS');
    expect(/\$INSUNITS\r?\n *70\r?\n *2\r?\n/.test(dxf())).toBe(true);
  });

  it('keeps dimensions and hatches as themselves, not as loose lines', () => {
    const back = openDXF(dxf(), n => n).entities;
    expect(back.filter(e => e.type === 'dim').length).toBeGreaterThan(0);
    expect(back.filter(e => e.type === 'hatch').length).toBeGreaterThan(0);
  });

  it('reopens here on the layers it left', () => {
    const back = openDXF(dxf(), n => String(n || 'WALLS')).entities;
    const names = [...new Set(back.map(e => e.layer))];
    expect(names).toContain('WALLS');
    expect(names).toContain('DOORS');
    expect(names).not.toContain('A-WALL');
  });

  it('the DWG payload carries the same names', () => {
    const buf = buildDWG(cabin24x36(), defaultLayers(), { ver: 'R2000', solid: false });
    const txt = new TextDecoder('latin1').decode(buf);
    expect(txt).toContain('A-WALL');
  });
});

describe('the layer map is reversible', () => {
  it('every mapped name comes back to itself', () => {
    for (const plain of Object.keys(AIA)) expect(fromAIA(toAIA(plain))).toBe(plain);
  });

  it('a layer of your own is left alone in both directions', () => {
    expect(toAIA('PLUMBING')).toBe('PLUMBING');
    expect(fromAIA('PLUMBING')).toBe('PLUMBING');
  });

  it('DEFPOINTS keeps the one name every drafter already relies on', () => {
    expect(toAIA('DEFPOINTS')).toBe('DEFPOINTS');
  });

  it('no two plain layers collide on one AIA name', () => {
    const out = Object.values(AIA);
    expect(new Set(out).size).toBe(out.length);
  });

  it('renaming copies, never the document', () => {
    const src = [{ type: 'line', layer: 'WALLS' }];
    const out = mapEntityLayers(src, toAIA);
    expect(out[0].layer).toBe('A-WALL');
    expect(src[0].layer).toBe('WALLS');
  });

  it('a table holding both names writes each layer once', () => {
    const t = mapLayerTable([{ name: 'WALLS' }, { name: 'A-WALL' }, { name: 'DOORS' }], toAIA);
    expect(t.map(l => l.name)).toEqual(['A-WALL', 'A-DOOR']);
  });
});

describe('block geometry follows its insert', () => {
  it('a door moved to your own layer takes its swing arc with it', () => {
    /* The bug: the leaf and arc stayed on DOORS no matter where the
     * door itself was, so an exported file leaked our layer names out
     * of every block and moving a door layer moved nothing. */
    const fr = expandInsert(makeInsert({ def: 'door', width: 3, x: 0, y: 0, layer: 'PLUMBING' }));
    expect(fr.length).toBeGreaterThan(1);
    expect(fr.every(f => f.layer === 'PLUMBING')).toBe(true);
  });

  it('a door with no layer named lands on the door layer, not on fixtures', () => {
    expect(makeInsert({ def: 'door' }).layer).toBe('DOORS');
    expect(makeInsert({ def: 'window' }).layer).toBe('DOORS');
    expect(makeInsert({ def: 'sym:Sink' }).layer).toBe('FIXTURES');
  });
});
