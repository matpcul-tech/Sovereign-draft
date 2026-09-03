import { describe, it, expect } from 'vitest';
import { cabin24x36 } from '../src/core/demo.js';
import { OFFSETS } from '../src/core/state.js';
import { defaultPrompt } from '../src/core/command.js';
import { buildDXF } from '../src/io/dxf.js';
import { defaultLayers } from '../src/core/state.js';

describe('24×36 cabin sample', () => {
  const ents = cabin24x36();

  it('has walls, doors, hatches, dims and a dashed centerline', () => {
    expect(ents.filter(e => e.kind === 'wall').length).toBeGreaterThan(8);
    expect(ents.some(e => e.layer === 'DOORS')).toBe(true);
    expect(ents.filter(e => e.type === 'hatch').length).toBeGreaterThanOrEqual(3);
    expect(ents.filter(e => e.type === 'dim').length).toBeGreaterThanOrEqual(4);
    const cl = ents.find(e => e.layer === 'CENTER');
    expect(cl).toBeTruthy();
    expect(cl.lt).toBe('CENTER');
  });

  it('exports a standard R12 DXF with LTYPE, layers and $INSUNITS feet', () => {
    const dxf = buildDXF(ents, defaultLayers(), { ver: 'R12' });
    expect(dxf).toContain('AC1009');
    expect(dxf).toContain('LTYPE');
    expect(dxf).toContain('CENTER');
    expect(dxf).toContain('A-WALL');
    expect(dxf).toContain('A-DOOR');
    expect(dxf).toContain('$INSUNITS');
  });
});

describe('offset presets', () => {
  it('does not get rewritten by command-line input', () => {
    expect(OFFSETS).toEqual([0.5, 1, 2, 4]);
  });
});

describe('live prompts', () => {
  it('FILLET shows the current radius', () => {
    expect(defaultPrompt('fillet', { filletR: 0.5 })).toMatch(/FILLET Specify radius/);
    expect(defaultPrompt('fillet', { filletR: 0.5 })).toMatch(/6"/);
  });
});
