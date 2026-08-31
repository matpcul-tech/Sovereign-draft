import { describe, it, expect, beforeEach } from 'vitest';
import {
  defaultPlotStyles, plotStyleByName, makePlotStyle, validatePlotStyles,
  styledLwMm, styledLwPt, styledGray, stylePlots,
  plotLwMm, PLOT_LW_MM, MM_TO_PT, SOLID_GRAY, DIM_GRAY, FULL_TONE
} from '../src/io/plotstyle.js';
import {
  captureLayerState, applyLayerState, unmanagedLayers, layerStateByName,
  upsertLayerState, removeLayerState, validateLayerStates, STATE_FIELDS
} from '../src/core/layerstate.js';
import { buildPDF } from '../src/io/pdf.js';
import { state, defaultLayers } from '../src/core/state.js';
import { serializeProject, validateProject, applyProject } from '../src/io/project.js';
import { lookupCommand } from '../src/core/command.js';

const LAYERS = () => [
  { name: 'WALLS', color: '#000', aci: 2, visible: true },
  { name: 'UNDERLAY', color: '#888', aci: 8, visible: true, plot: false }
];

describe('plot style tables', () => {
  it('ships a named set including ISO', () => {
    const ts = defaultPlotStyles();
    expect(ts.map(t => t.name)).toContain('ISO');
    expect(ts.length).toBeGreaterThan(1);
  });

  it('the default table reproduces the old hardcoded weights exactly', () => {
    const iso = plotStyleByName(defaultPlotStyles(), 'ISO');
    for (const ly of Object.keys(PLOT_LW_MM).concat(['NOT A LAYER'])){
      expect(styledLwMm({ layer: ly }, iso)).toBe(plotLwMm({ layer: ly }));
    }
  });

  it('and prints at the same tone, so an existing drawing is unchanged', () => {
    const iso = plotStyleByName(defaultPlotStyles(), 'ISO');
    expect(styledGray({ layer: 'WALLS' }, iso, false)).toBe(SOLID_GRAY);
    expect(styledGray({ layer: 'DIMS' }, iso, true)).toBe(DIM_GRAY);
  });

  it('a screened entry prints lighter, and zero prints nothing at all', () => {
    const t = makePlotStyle('S', { entries: { HALF: { screen: 50 }, GONE: { screen: 0 } } });
    const half = styledGray({ layer: 'HALF' }, t, false);
    expect(half).toBeGreaterThan(SOLID_GRAY);
    expect(half).toBeLessThan(1);
    expect(styledGray({ layer: 'GONE' }, t, false)).toBeCloseTo(1, 9);
  });

  it('screening is monotonic', () => {
    const g = pct => styledGray({ layer: 'X' }, makePlotStyle('T', { entries: { X: { screen: pct } } }), false);
    const tones = [100, 75, 50, 25, 0].map(g);
    for (let i = 1; i < tones.length; i++) expect(tones[i]).toBeGreaterThan(tones[i - 1]);
  });

  it('an out of range screen is clamped rather than trusted', () => {
    const t = makePlotStyle('T', { entries: { A: { screen: 500 }, B: { screen: -20 }, C: { screen: 'x' } } });
    expect(t.entries.A.screen).toBe(FULL_TONE);
    expect(t.entries.B.screen).toBe(0);
    expect(t.entries.C.screen).toBe(FULL_TONE);
  });

  it('a hand set entity lineweight still beats the table', () => {
    const t = makePlotStyle('T', { entries: { WALLS: { lw: 0.05 } } });
    expect(styledLwMm({ layer: 'WALLS', lw: 0.7 }, t)).toBe(0.7);
    expect(styledLwMm({ layer: 'WALLS' }, t)).toBe(0.05);
  });

  it('a layer the table does not name gets the fallback', () => {
    const t = makePlotStyle('T', { fallbackLw: 0.31 });
    expect(styledLwMm({ layer: 'ANYTHING' }, t)).toBe(0.31);
  });

  it('wall geometry is weighted as WALLS however it is layered', () => {
    const t = makePlotStyle('T', { entries: { WALLS: { lw: 0.9 } }, fallbackLw: 0.1 });
    expect(styledLwMm({ layer: 'OTHER', kind: 'wall' }, t)).toBe(0.9);
  });

  it('points come from millimetres', () => {
    const t = makePlotStyle('T', { fallbackLw: 1 });
    expect(styledLwPt({ layer: 'X' }, t)).toBeCloseTo(MM_TO_PT, 9);
  });

  it('either the layer or the table can hold a layer off paper', () => {
    const t = makePlotStyle('T', { entries: { SECRET: { plot: false } } });
    expect(stylePlots('WALLS', t, { plot: true })).toBe(true);
    expect(stylePlots('WALLS', t, { plot: false })).toBe(false);
    expect(stylePlots('SECRET', t, null)).toBe(false);
    expect(stylePlots('WALLS', null, null)).toBe(true);
  });

  it('lookup falls back to ISO, and a broken list is repaired', () => {
    expect(plotStyleByName(defaultPlotStyles(), 'nonsense').name).toBe('ISO');
    expect(plotStyleByName(defaultPlotStyles(), 'check').name).toBe('CHECK');
    const v = validatePlotStyles([{ name: 'A', entries: {} }, { name: 'a', entries: {} }, null]);
    expect(v.filter(t => t.name === 'A').length).toBe(1);
    expect(v.some(t => t.name === 'ISO')).toBe(true);
    expect(validatePlotStyles([]).length).toBeGreaterThan(1);
  });
});

describe('the plot writer honours all of it', () => {
  const ents = () => ([
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 },
    { type: 'text', layer: 'UNDERLAY', x: 2, y: 5, size: 1, content: 'NOPLOTMARKER' }
  ]);

  it('a layer marked not to plot stays off the sheet', () => {
    const pdf = buildPDF(ents(), { ppf: 'fit', projectName: 'T', layers: LAYERS() }).pdf;
    expect(pdf).not.toContain('NOPLOTMARKER');
  });

  it('and still does when the caller supplies its own visibility callback', () => {
    const ls = LAYERS();
    const layerVisible = n => { const L = ls.find(l => l.name === n); return !L || (L.visible !== false && L.plot !== false); };
    expect(buildPDF(ents(), { ppf: 'fit', projectName: 'T', layerVisible }).pdf).not.toContain('NOPLOTMARKER');
  });

  it('a plotting layer is unaffected', () => {
    const ls = LAYERS();
    ls[1].plot = true;
    expect(buildPDF(ents(), { ppf: 'fit', projectName: 'T', layers: ls }).pdf).toContain('NOPLOTMARKER');
  });

  it('choosing a different table changes the plotted lineweights', () => {
    const mk = name => buildPDF([{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 }],
      { ppf: 'fit', projectName: 'T', plotStyle: name }).pdf;
    expect(mk('ISO')).not.toBe(mk('CHECK'));
  });

  it('naming no table leaves the quick export exactly as it was', () => {
    /* The quick export plots at screen weights until a table is actually
     * asked for. Naming ISO is therefore a real choice, not a no-op: it says
     * plot this at true lineweights. */
    const ents2 = [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 }];
    const bare = buildPDF(ents2, { ppf: 'fit', projectName: 'T' }).pdf;
    const iso = buildPDF(ents2, { ppf: 'fit', projectName: 'T', plotStyle: 'ISO' }).pdf;
    expect(bare).toContain('1.4 w');
    expect(iso).not.toBe(bare);
    /* Same drawing, same table, same bytes. */
    expect(buildPDF(ents2, { ppf: 'fit', projectName: 'T' }).pdf).toBe(bare);
  });

  it('screening applies whether or not a table was named, because ISO is full tone', () => {
    const ents2 = [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 }];
    const tables = defaultPlotStyles().concat([makePlotStyle('FADE', { entries: { WALLS: { screen: 40 } } })]);
    /* The title block writes its own tone on a combined line, so match a
     * whole line to read only the tones the entities are stroked at. */
    const tones = pdf => [...new Set((pdf.match(/^[\d.]+ G$/gm) || []))].sort();
    const bare = tones(buildPDF(ents2, { ppf: 'fit', projectName: 'T' }).pdf);
    const faded = tones(buildPDF(ents2, { ppf: 'fit', projectName: 'T', plotStyles: tables, plotStyle: 'FADE' }).pdf);
    expect(bare).toEqual(['0.08 G']);
    expect(faded).toEqual(['0.63 G']);
  });
});

describe('layer states', () => {
  it('capture records the fields it manages and nothing else', () => {
    const rec = captureLayerState('ALL', [{ name: 'WALLS', visible: true, locked: false, color: '#fff', junk: 1 }]);
    expect(Object.keys(rec.layers.WALLS).sort()).toEqual(['color', 'locked', 'visible']);
    STATE_FIELDS.forEach(f => expect(typeof f).toBe('string'));
  });

  it('a saved state restores what was showing', () => {
    const L = defaultLayers();
    const all = captureLayerState('ALL ON', L);
    L.forEach(x => { if (x.name !== 'WALLS' && x.name !== 'GRID') x.visible = false; });
    const struct = captureLayerState('STRUCTURE', L);
    applyLayerState(all, L);
    expect(L.every(x => x.visible !== false)).toBe(true);
    applyLayerState(struct, L);
    expect(L.filter(x => x.visible !== false).map(x => x.name).sort()).toEqual(['GRID', 'WALLS']);
  });

  it('reports how many layers it actually changed', () => {
    const L = defaultLayers();
    const rec = captureLayerState('S', L);
    expect(applyLayerState(rec, L)).toBe(0);
    L[0].visible = false;
    expect(applyLayerState(rec, L)).toBe(1);
    expect(applyLayerState(rec, L)).toBe(0);
  });

  it('a layer added after the state was saved is left alone, not reset', () => {
    const L = defaultLayers();
    const rec = captureLayerState('S', L);
    L.push({ name: 'NEW', color: '#fff', aci: 7, visible: true });
    applyLayerState(rec, L);
    expect(L.find(x => x.name === 'NEW').visible).toBe(true);
    expect(unmanagedLayers(rec, L)).toEqual(['NEW']);
  });

  it('an empty state manages nothing', () => {
    expect(applyLayerState(null, defaultLayers())).toBe(0);
    expect(unmanagedLayers(null, [{ name: 'A' }])).toEqual(['A']);
  });

  it('upsert replaces by name and keeps the list sorted', () => {
    let ss = upsertLayerState([], captureLayerState('B', []));
    ss = upsertLayerState(ss, captureLayerState('A', []));
    ss = upsertLayerState(ss, captureLayerState('a', []));
    expect(ss.map(s => s.name)).toEqual(['A', 'B']);
  });

  it('lookup ignores case, remove works, junk is dropped', () => {
    const ss = upsertLayerState([], captureLayerState('MINE', []));
    expect(layerStateByName(ss, 'mine').name).toBe('MINE');
    expect(layerStateByName(ss, 'other')).toBe(null);
    expect(removeLayerState(ss, 'mine')).toEqual([]);
    expect(validateLayerStates([null, { name: 'X' }, { name: 'Y', layers: {} }]).map(s => s.name)).toEqual(['Y']);
    expect(validateLayerStates('nope')).toEqual([]);
  });
});

describe('both persist with the drawing', () => {
  beforeEach(() => {
    state.layers = defaultLayers();
    state.entities = [];
    state.constraints = [];
    state.selIds = [];
    state.undoStack = [];
    state.redoStack = [];
    state.idSeq = 1;
    state.plotStyles = defaultPlotStyles();
    state.currentPlotStyle = 'ISO';
    state.layerStates = [];
  });

  it('survive save, load, save', () => {
    state.layerStates = [captureLayerState('STRUCTURE', state.layers)];
    state.plotStyles = defaultPlotStyles().concat([makePlotStyle('MINE', { fallbackLw: 0.4 })]);
    state.currentPlotStyle = 'MINE';
    const first = serializeProject(state, true);
    const p = validateProject(JSON.parse(first));
    expect(p.plotStyles.some(t => t.name === 'MINE')).toBe(true);
    expect(p.layerStates.length).toBe(1);
    expect(p.currentPlotStyle).toBe('MINE');
    const target = { ...state };
    applyProject(target, p);
    expect(serializeProject(target, true)).toBe(first);
  });

  it('a file written before either existed loads with sane defaults', () => {
    const raw = JSON.parse(serializeProject(state, true));
    delete raw.plotStyles;
    delete raw.currentPlotStyle;
    delete raw.layerStates;
    const p = validateProject(raw);
    expect(p.plotStyles.some(t => t.name === 'ISO')).toBe(true);
    expect(p.currentPlotStyle).toBe('ISO');
    expect(p.layerStates).toEqual([]);
  });
});

describe('the commands are registered', () => {
  it('layer states and plot styles reach the command line', () => {
    expect(lookupCommand('LAYSAVE').action).toBe('laysave');
    expect(lookupCommand('LSAVE').action).toBe('laysave');
    expect(lookupCommand('LAYREST').action).toBe('layrest');
    expect(lookupCommand('LRESTORE').action).toBe('layrest');
    expect(lookupCommand('LAYDEL').action).toBe('laydel');
    expect(lookupCommand('PLOTSTYLE').action).toBe('plotstyle');
    expect(lookupCommand('CTB').action).toBe('plotstyle');
  });
});
