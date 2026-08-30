import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createDocument, open, toPDF, toDXF, toJSON, sampleCabin } from '../src/api.js';
import { cabin24x36 } from '../src/core/demo.js';
import { defaultLayers } from '../src/core/state.js';
import { buildDXF } from '../src/io/dxf.js';

describe('createDocument / toJSON', () => {
  it('round-trips a cabin through JSON', () => {
    const doc = createDocument({ name: 'Cabin', entities: cabin24x36(), layers: defaultLayers() });
    const json = toJSON(doc);
    expect(json).toContain('sovereign-draft');
    const again = open(json, 'cabin.json');
    expect(again.name).toBe('Cabin');
    expect(again.entities.length).toBe(doc.entities.length);
  });
});

describe('open DXF', () => {
  it('reads a DXF we just wrote', () => {
    const ents = [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 }];
    const dxf = buildDXF(ents, defaultLayers());
    const doc = open(dxf, 'line.dxf');
    expect(doc.entities.some(e => e.type === 'line')).toBe(true);
  });
});

describe('sheetset + PDF', () => {
  it('plots a multi-page PDF from the sample cabin', () => {
    const doc = sampleCabin();
    expect(doc.layouts.length).toBeGreaterThan(3);
    const pdf = toPDF(doc);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('G-001');
    expect(pdf).toContain('ROOM SCHEDULE');
    const dxf = toDXF(doc);
    expect(dxf).toContain('EOF');
  });
});

describe('CLI binary exists', () => {
  it('the bin file has a shebang', () => {
    const src = readFileSync(new URL('../bin/sovereign-draft.js', import.meta.url), 'utf8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
