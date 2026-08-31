import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeMText, mtextLines, mtextLayout, mtextCorners, mtextToTexts,
  mtextBlockWidth, mtextBlockHeight, lineSpacingOf,
  decodeMText, encodeMText, attachCode, justFromCode,
  JUSTIFY, DEFAULT_LINE_SPACING
} from '../src/core/mtext.js';
import {
  makeTextStyle, defaultTextStyles, styleByName, validateTextStyles,
  metricsOpts, fontStack, DEFAULT_STYLE
} from '../src/core/textstyle.js';
import { textWidth } from '../src/core/textmetrics.js';
import { entBBox, entHit, entPoints, explodeForIO, translateEnt } from '../src/core/entities.js';
import { buildDXF, parseDXF } from '../src/io/dxf.js';
import { buildSVG } from '../src/io/svg.js';
import { buildPDF } from '../src/io/pdf.js';
import { lookupCommand } from '../src/core/command.js';
import { state, defaultLayers } from '../src/core/state.js';
import { serializeProject, validateProject, applyProject } from '../src/io/project.js';

const NOTE = 'ALL WORK SHALL COMPLY WITH THE 2021 INTERNATIONAL BUILDING CODE AND ALL APPLICABLE LOCAL AMENDMENTS.';
const LAYERS = [{ name: 'NOTES', aci: 7, visible: true }];
const W = (s, size, opts) => textWidth(s, size, opts);

describe('wrapping', () => {
  const e = () => makeMText(NOTE, { size: 0.5, width: 12, x: 0, y: 0 });

  it('breaks a note into lines that fit the column', () => {
    const lines = mtextLines(e());
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach(l => expect(W(l, 0.5)).toBeLessThanOrEqual(12));
  });

  it('is greedy: no line could have taken the next word', () => {
    const lines = mtextLines(e());
    for (let i = 0; i < lines.length - 1; i++){
      const next = lines[i + 1].split(' ')[0];
      expect(W(lines[i] + ' ' + next, 0.5)).toBeGreaterThan(12);
    }
  });

  it('loses no words', () => {
    expect(mtextLines(e()).join(' ')).toBe(NOTE);
  });

  it('a narrower column makes more lines, a wider one fewer', () => {
    const n6 = mtextLines(makeMText(NOTE, { size: 0.5, width: 6 })).length;
    const n12 = mtextLines(makeMText(NOTE, { size: 0.5, width: 12 })).length;
    const n40 = mtextLines(makeMText(NOTE, { size: 0.5, width: 40 })).length;
    expect(n6).toBeGreaterThan(n12);
    expect(n12).toBeGreaterThan(n40);
  });

  it('no width means no wrapping', () => {
    expect(mtextLines(makeMText(NOTE, { size: 0.5 }))).toEqual([NOTE]);
  });

  it('explicit breaks always break, blank lines included', () => {
    expect(mtextLines(makeMText('ONE\nTWO\n\nFOUR', { size: 1, width: 100 })))
      .toEqual(['ONE', 'TWO', '', 'FOUR']);
  });

  it('a word wider than the column is cut rather than left to overhang', () => {
    const lines = mtextLines(makeMText('SUPERCALIFRAGILISTIC', { size: 1, width: 4 }));
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach(l => expect(W(l, 1)).toBeLessThanOrEqual(4));
    expect(lines.join('')).toBe('SUPERCALIFRAGILISTIC');
  });

  it('empty content is one empty line, not zero', () => {
    expect(mtextLines(makeMText('', { size: 1, width: 10 }))).toEqual(['']);
    expect(mtextBlockHeight(makeMText('', { size: 1 }))).toBe(1);
  });

  it('runs of spaces do not create empty lines', () => {
    expect(mtextLines(makeMText('A     B', { size: 1, width: 100 }))).toEqual(['A B']);
  });
});

describe('block geometry', () => {
  it('height is one cap height plus the leading between lines', () => {
    const e = makeMText('A\nB\nC', { size: 2 });
    expect(lineSpacingOf(e)).toBe(2 * DEFAULT_LINE_SPACING);
    expect(mtextBlockHeight(e)).toBeCloseTo(2 + 2 * (2 * DEFAULT_LINE_SPACING), 9);
  });

  it('a custom line spacing is honoured', () => {
    expect(mtextBlockHeight(makeMText('A\nB', { size: 1, lineSpacing: 1 }))).toBeCloseTo(2, 9);
  });

  it('an explicit column is the block width even when no line fills it', () => {
    expect(mtextBlockWidth(makeMText('HI', { size: 1, width: 30 }))).toBe(30);
  });

  it('without a column the width is the widest line', () => {
    const e = makeMText('SHORT\nMUCH LONGER LINE', { size: 1 });
    expect(mtextBlockWidth(e)).toBeCloseTo(W('MUCH LONGER LINE', 1), 9);
  });
});

describe('every attachment point puts the anchor where it says', () => {
  for (const j of JUSTIFY){
    it(j + ' anchors on that corner', () => {
      const c = mtextCorners(makeMText('AAAA\nBB', { size: 1, x: 0, y: 0, just: j }));
      const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const wantX = j[1] === 'L' ? x0 : j[1] === 'C' ? (x0 + x1) / 2 : x1;
      const wantY = j[0] === 'T' ? y1 : j[0] === 'M' ? (y0 + y1) / 2 : y0;
      expect(wantX).toBeCloseTo(0, 9);
      expect(wantY).toBeCloseTo(0, 9);
    });
  }

  it('every line sits inside the block box', () => {
    const e = makeMText('ALPHA BETA GAMMA DELTA EPSILON ZETA', { size: 0.5, width: 6, x: 3, y: 7, just: 'MC' });
    const c = mtextCorners(e);
    const x0 = Math.min(...c.map(p => p[0])) - 1e-9, x1 = Math.max(...c.map(p => p[0])) + 1e-9;
    const y0 = Math.min(...c.map(p => p[1])) - 1e-9, y1 = Math.max(...c.map(p => p[1])) + 1e-9;
    for (const l of mtextLayout(e)){
      expect(l.x).toBeGreaterThanOrEqual(x0);
      expect(l.x + l.width).toBeLessThanOrEqual(x1);
      expect(l.y).toBeGreaterThanOrEqual(y0);
      expect(l.y + e.size).toBeLessThanOrEqual(y1);
    }
  });

  it('centred lines really are centred and right lines really are flush right', () => {
    const mid = makeMText('AAAA\nBB', { size: 1, width: 10, just: 'TC' });
    const c = mtextCorners(mid);
    const cx = (Math.min(...c.map(p => p[0])) + Math.max(...c.map(p => p[0]))) / 2;
    mtextLayout(mid).forEach(l => expect(l.x + l.width / 2).toBeCloseTo(cx, 9));

    const right = makeMText('AAAA\nBB', { size: 1, width: 10, just: 'TR' });
    const rc = mtextCorners(right);
    const rx = Math.max(...rc.map(p => p[0]));
    mtextLayout(right).forEach(l => expect(l.x + l.width).toBeCloseTo(rx, 9));
  });

  it('lines run down the page, never up', () => {
    const L = mtextLayout(makeMText('A\nB\nC', { size: 1 }));
    expect(L[1].y).toBeLessThan(L[0].y);
    expect(L[2].y).toBeLessThan(L[1].y);
  });
});

describe('rotation', () => {
  it('turns the block without resizing it or moving the anchor', () => {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const flat = mtextCorners(makeMText('HELLO WORLD', { size: 1, x: 5, y: 5 }));
    const turned = mtextCorners(makeMText('HELLO WORLD', { size: 1, x: 5, y: 5, rot: 90 }));
    expect(d(turned[0], turned[1])).toBeCloseTo(d(flat[0], flat[1]), 9);
    expect(turned[3][0]).toBeCloseTo(5, 9);
    expect(turned[3][1]).toBeCloseTo(5, 9);
  });

  it('a full turn comes back to where it started', () => {
    const a = mtextCorners(makeMText('X Y', { size: 1, x: 2, y: 3 }));
    const b = mtextCorners(makeMText('X Y', { size: 1, x: 2, y: 3, rot: 360 }));
    a.forEach((p, i) => { expect(b[i][0]).toBeCloseTo(p[0], 9); expect(b[i][1]).toBeCloseTo(p[1], 9); });
  });
});

describe('a paragraph behaves like any other entity', () => {
  const e = () => makeMText('ALPHA BETA GAMMA DELTA', { layer: 'NOTES', size: 0.5, width: 5, x: 2, y: 9 });

  it('its box is the block, not the anchor point', () => {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    entBBox(e(), bb);
    expect(bb[2] - bb[0]).toBeCloseTo(5, 6);
    expect(bb[3]).toBeCloseTo(9, 6);
    expect(bb[1]).toBeLessThan(9);
  });

  it('hit testing covers the block', () => {
    expect(entHit(e(), [3, 8.6], 0.1)).toBe(true);
    expect(entHit(e(), [50, 50], 0.1)).toBe(false);
  });

  it('explodes to one text entity per laid out line', () => {
    const f = explodeForIO(e());
    expect(f.length).toBe(mtextLines(e()).length);
    f.forEach(t => expect(t.type).toBe('text'));
    expect(f.map(t => t.content).join(' ')).toBe('ALPHA BETA GAMMA DELTA');
  });

  it('moves as one piece', () => {
    const m = e();
    translateEnt(m, 100, -5);
    expect(m.x).toBe(102);
    expect(m.y).toBe(4);
  });

  it('offers its corners and anchor as snap points', () => {
    expect(entPoints(e()).length).toBe(5);
  });
});

describe('DXF keeps a paragraph a paragraph', () => {
  const NOTES = 'GENERAL NOTES\n\n1. COMPLY WITH THE 2021 IBC.\n2. VERIFY DIMENSIONS IN FIELD.';
  const e = () => makeMText(NOTES, { layer: 'NOTES', size: 0.5, width: 12, x: 2, y: 20, just: 'TL' });

  it('R2000 writes a real MTEXT', () => {
    expect(buildDXF([e()], LAYERS, { ver: 'R2000' })).toContain('MTEXT');
  });

  it('round trips content, column and attachment without loss', () => {
    const back = parseDXF(buildDXF([e()], LAYERS, { ver: 'R2000' }), n => n || 'NOTES').find(x => x.type === 'mtext');
    expect(back).toBeTruthy();
    expect(back.content).toBe(NOTES);
    expect(back.width).toBe(12);
    expect(back.just).toBe('TL');
    expect(back.size).toBe(0.5);
    expect(mtextLines(back)).toEqual(mtextLines(e()));
  });

  it('a second trip is stable', () => {
    const one = buildDXF([e()], LAYERS, { ver: 'R2000' });
    expect(buildDXF(parseDXF(one, n => n || 'NOTES'), LAYERS, { ver: 'R2000' })).toBe(one);
  });

  it('every attachment point survives', () => {
    for (const j of JUSTIFY){
      const m = makeMText('X', { layer: 'NOTES', size: 1, x: 0, y: 0, just: j });
      const back = parseDXF(buildDXF([m], LAYERS, { ver: 'R2000' }), n => n || 'NOTES').find(x => x.type === 'mtext');
      expect(back.just).toBe(j);
    }
  });

  it('R12 has no MTEXT, so it gets the laid out lines instead of losing them', () => {
    const r12 = buildDXF([e()], LAYERS, { ver: 'R12' });
    expect(r12).not.toContain('MTEXT');
    const back = parseDXF(r12, n => n || 'NOTES').filter(x => x.type === 'text');
    expect(back.length).toBe(mtextLines(e()).length);
  });

  it('single line TEXT is still imported as single line text', () => {
    const dxf = buildDXF([{ type: 'text', layer: 'NOTES', x: 1, y: 2, size: 1, content: 'PLAIN' }], LAYERS, { ver: 'R2000' });
    const back = parseDXF(dxf, n => n || 'NOTES')[0];
    expect(back.type).toBe('text');
    expect(back.content).toBe('PLAIN');
  });

  it('text rotation survives', () => {
    const dxf = buildDXF([{ type: 'text', layer: 'NOTES', x: 0, y: 0, size: 1, content: 'A', rot: 30 }], LAYERS, { ver: 'R2000' });
    expect(parseDXF(dxf, n => n || 'NOTES')[0].rot).toBeCloseTo(30, 9);
  });
});

describe('DXF inline formatting codes', () => {
  it('a line break becomes a line break, not a space', () => {
    expect(decodeMText('LINE ONE\\PLINE TWO')).toBe('LINE ONE\nLINE TWO');
  });
  it('font and colour switches are dropped, their text is kept', () => {
    expect(decodeMText('{\\fArial|b1;BOLD} PLAIN')).toBe('BOLD PLAIN');
    expect(decodeMText('\\C1;RED TEXT')).toBe('RED TEXT');
    expect(decodeMText('{\\H1.5x;BIG}\\Psecond')).toBe('BIG\nsecond');
  });
  it('a hard space is a space', () => {
    expect(decodeMText('A\\~B')).toBe('A B');
  });
  it('a stacked fraction keeps both parts', () => {
    expect(decodeMText('5\\S1/2;" PIPE')).toBe('51/2" PIPE');
  });
  it('escaped braces and backslashes are content, not codes', () => {
    expect(decodeMText('a \\{b\\} c')).toBe('a {b} c');
    expect(decodeMText('back\\\\slash')).toBe('back\\slash');
  });
  it('encode and decode are inverses', () => {
    for (const s of ['one line', 'two\nlines', 'braces {x}', 'a \\ backslash', '', 'mixed {a}\nand \\ more']){
      expect(decodeMText(encodeMText(s))).toBe(s);
    }
  });
  it('attachment codes round trip', () => {
    JUSTIFY.forEach(j => expect(justFromCode(attachCode(j))).toBe(j));
    expect(justFromCode(99)).toBe('TL');
  });
});

describe('SVG draws every line', () => {
  it('emits one text element per wrapped line', () => {
    const e = makeMText(NOTE, { layer: 'NOTES', size: 0.5, width: 12, x: 0, y: 0 });
    const svg = buildSVG([e], LAYERS);
    expect((svg.match(/<text /g) || []).length).toBe(mtextLines(e).length);
  });
});

describe('text styles', () => {
  it('the default set is present and STANDARD always exists', () => {
    const ds = defaultTextStyles();
    expect(ds.map(s => s.name)).toContain(DEFAULT_STYLE);
    expect(ds.length).toBeGreaterThan(1);
  });

  it('lookup ignores case and falls back to STANDARD', () => {
    const ds = defaultTextStyles();
    expect(styleByName(ds, 'romans').name).toBe('ROMANS');
    expect(styleByName(ds, 'NO SUCH STYLE').name).toBe(DEFAULT_STYLE);
  });

  it('a width factor scales the measured width, so it moves where text wraps', () => {
    const opts = metricsOpts(makeTextStyle('X', { widthFactor: 0.8 }));
    expect(W('CONFERENCE ROOM', 1, opts) / W('CONFERENCE ROOM', 1)).toBeCloseTo(0.8, 9);
    const wide = mtextLines(makeMText(NOTE, { size: 0.5, width: 12 })).length;
    const narrowGlyphs = mtextLines(makeMText(NOTE, { size: 0.5, width: 12 }), opts).length;
    expect(narrowGlyphs).toBeLessThanOrEqual(wide);
  });

  it('bold reaches the bold metrics', () => {
    /* Helvetica and Helvetica-Bold share advance widths for most capitals,
     * so an all caps string cannot tell the two tables apart. */
    expect(W('bobbing', 1, { bold: true })).toBeGreaterThan(W('bobbing', 1));
  });

  it('a height on a style is a default, never applied to existing text', () => {
    const st = makeTextStyle('NOTES', { height: 0.5 });
    const e = makeMText('X', { size: 3, style: 'NOTES' });
    expect(st.height).toBe(0.5);
    expect(mtextBlockHeight(e)).toBe(3);
  });

  it('fonts map to distinct stacks', () => {
    expect(fontStack({ font: 'mono' })).not.toBe(fontStack({ font: 'serif' }));
    expect(fontStack({ font: 'sans' })).not.toBe(fontStack({ font: 'mono' }));
    expect(fontStack(null)).toBe(fontStack({ font: 'sans' }));
  });

  it('a broken style list is repaired rather than trusted', () => {
    const v = validateTextStyles([{ name: 'A' }, { name: 'a' }, null, {}]);
    expect(v.filter(s => s.name === 'A').length).toBe(1);
    expect(v.some(s => s.name === DEFAULT_STYLE)).toBe(true);
    expect(validateTextStyles('nonsense').length).toBeGreaterThan(1);
  });

  it('an unknown font falls back rather than being stored', () => {
    expect(makeTextStyle('X', { font: 'comic' }).font).toBe('sans');
    expect(makeTextStyle('X', { widthFactor: -3 }).widthFactor).toBe(1);
  });
});

describe('paragraphs and styles live in the document', () => {
  beforeEach(() => {
    state.layers = defaultLayers();
    state.entities = [];
    state.constraints = [];
    state.selIds = [];
    state.undoStack = [];
    state.redoStack = [];
    state.idSeq = 1;
    state.textStyles = defaultTextStyles();
    state.currentTextStyle = 'STANDARD';
  });

  it('survive save, load, save', () => {
    state.entities = [{ ...makeMText('A NOTE THAT WRAPS', { size: 0.5, width: 4 }), id: 1 }];
    state.textStyles = defaultTextStyles().concat([makeTextStyle('CUSTOM', { widthFactor: 0.75, font: 'mono' })]);
    const first = serializeProject(state, true);
    const p = validateProject(JSON.parse(first));
    expect(p.textStyles.some(s => s.name === 'CUSTOM')).toBe(true);
    const target = { ...state };
    applyProject(target, p);
    expect(target.entities[0].type).toBe('mtext');
    expect(serializeProject(target, true)).toBe(first);
  });

  it('a file written before styles existed loads with the defaults', () => {
    const raw = JSON.parse(serializeProject(state, true));
    delete raw.textStyles;
    delete raw.currentTextStyle;
    const p = validateProject(raw);
    expect(p.textStyles.length).toBeGreaterThan(1);
    expect(p.currentTextStyle).toBe('STANDARD');
  });
});

describe('a style reaches the output, not just the record', () => {
  const NOTE_L = 'ALL WORK SHALL COMPLY WITH THE 2021 INTERNATIONAL BUILDING CODE AND ALL APPLICABLE LOCAL AMENDMENTS.';
  const styles = () => defaultTextStyles().concat([makeTextStyle('TIGHT', { widthFactor: 0.6 })]);
  const block = st => {
    const e = makeMText(NOTE_L, { layer: 'NOTES', size: 0.5, width: 12, x: 0, y: 12 });
    if (st) e.style = st;
    return e;
  };

  it('SVG wraps a narrow style into fewer lines', () => {
    const plain = (buildSVG([block(null)], LAYERS, { textStyles: styles() }).match(/<text /g) || []).length;
    const tight = (buildSVG([block('TIGHT')], LAYERS, { textStyles: styles() }).match(/<text /g) || []).length;
    expect(tight).toBeLessThan(plain);
  });

  it('an unknown style falls back to STANDARD rather than breaking the export', () => {
    const known = (buildSVG([block(null)], LAYERS, { textStyles: styles() }).match(/<text /g) || []).length;
    const bogus = (buildSVG([block('NO SUCH STYLE')], LAYERS, { textStyles: styles() }).match(/<text /g) || []).length;
    const noTable = (buildSVG([block('TIGHT')], LAYERS, {}).match(/<text /g) || []).length;
    expect(bogus).toBe(known);
    expect(noTable).toBe(known);
  });

  it('the plotted PDF carries the note and the style changes how it breaks', () => {
    const mk = st => buildPDF([block(st), { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 }],
      { ppf: 'fit', projectName: 'T', textStyles: styles() }).pdf;
    const plain = mk(null), tight = mk('TIGHT');
    const runs = s => (s.match(/\) Tj/g) || []).length;
    expect(plain).toContain('ALL WORK SHALL COMPLY');
    expect(runs(tight)).toBeLessThan(runs(plain));
  });
});

describe('the command line reaches paragraph text', () => {
  it('registers MTEXT and its aliases', () => {
    expect(lookupCommand('MTEXT').tool).toBe('mtext');
    expect(lookupCommand('MT').tool).toBe('mtext');
    expect(lookupCommand('NOTE').tool).toBe('mtext');
  });
});

void mtextToTexts;
