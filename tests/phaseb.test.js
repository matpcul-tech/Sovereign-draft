import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildPDF } from '../src/io/pdf.js';
import { cabin24x36 } from '../src/core/demo.js';
import { serializeProject, validateProject, applyProject } from '../src/io/project.js';
import { state, defaultLayers, PROJECT_VERSION } from '../src/core/state.js';
import { defaultLayouts } from '../src/core/layout.js';
import { defaultDimStyles } from '../src/core/dimStyle.js';
import {
  DOC_VERSION, normalizeSheets, normalizeView, normalizeSheet, sheetLabel,
  migrateDocument, migrationTouchedGeometry, setMark, setAttributes, marksOf,
  isPaperSpaceProperty, isModelSpaceProperty
} from '../src/core/document.js';

/* Hashes captured from the build BEFORE the document model landed. These are
 * the acceptance criterion for the whole phase: a one sheet one view project
 * must export the same bytes it did before the refactor.
 *
 * Regenerated once, deliberately, when the cabin itself was corrected: the
 * corner fillet used to drop the wall identity from the trimmed faces, so
 * the cabin's west wall was an open outline missing its inner face line and
 * never extruded to 3D. Fixing filletLines to carry the wall fields put the
 * line back into the 2D drawing, which changes these bytes for the right
 * reason. The guard's job, catching unintended pipeline changes against a
 * stable input, continues from the corrected cabin. */
const PRE_REFACTOR_PDF = {
  /* Regenerated 2026-09-02 (second pass): schedule tables now read
   * header-on-top everywhere, part-mark bubbles lift clear of their
   * labels, and a room named by a text inside its loop prints one name
   * (its live SF stays in the room schedule). Verified by rendering:
   * every room named once, tables top-down, nothing colliding. */
  'cabin:fit': 'd6f999eada939f59',
  'cabin:18': 'e24a33bdf33ff4f8',
  'cabin:9': 'd6f999eada939f59',
  'cabin:4.5': '011f4e00abf877a4'
};

function pdfHash(ents, ppf, name){
  const r = buildPDF(ents, {
    ppf, layerVisible: () => true,
    projectName: name || 'CABIN', dateStr: '2026-01-01'
  });
  return createHash('sha256').update(r.pdf).digest('hex').slice(0, 16);
}

/* A project file as written by the pre document model build. */
function legacyProjectJSON(){
  return JSON.stringify({
    app: 'sovereign-draft',
    v: 6,
    name: 'Legacy Cabin',
    idSeq: 500,
    gSeq: 3,
    layers: defaultLayers(),
    entities: cabin24x36(),
    userBlocks: [],
    dimStyles: defaultDimStyles(),
    currentDimStyle: 'ARCH',
    layouts: defaultLayouts(),
    currentLayout: 'A1',
    space: 'model',
    dxfVer: 'R12'
  });
}

describe('2. one sheet one view exports a PDF identical to the pre refactor build', () => {
  const ents = cabin24x36();
  Object.keys(PRE_REFACTOR_PDF).forEach(key => {
    const ppf = key.split(':')[1];
    it('is byte identical at ' + ppf, () => {
      const got = pdfHash(ents, ppf === 'fit' ? 'fit' : Number(ppf), 'CABIN');
      expect(got).toBe(PRE_REFACTOR_PDF[key]);
    });
  });
});

describe('1. existing project files open and render identically after migration', () => {
  it('a v6 file loads', () => {
    const p = validateProject(JSON.parse(legacyProjectJSON()));
    expect(p.entities.length).toBeGreaterThan(0);
    expect(p.schemaVersion).toBe(6);
  });

  it('migration never touches a coordinate', () => {
    const before = JSON.parse(legacyProjectJSON()).entities;
    const p = validateProject(JSON.parse(legacyProjectJSON()));
    expect(migrationTouchedGeometry(before, p.entities)).toBe(false);
  });

  it('renders identically after migration', () => {
    const raw = JSON.parse(legacyProjectJSON());
    const direct = pdfHash(raw.entities, 18, 'CABIN');
    const migrated = validateProject(raw);
    expect(pdfHash(migrated.entities, 18, 'CABIN')).toBe(direct);
    expect(direct).toBe(PRE_REFACTOR_PDF['cabin:18']);
  });

  it('gains sheet identity without losing layout fields', () => {
    const p = validateProject(JSON.parse(legacyProjectJSON()));
    const sheet = p.layouts[0];
    expect(sheet.sheetNumber).toBe('A-1');
    expect(Array.isArray(sheet.annotations)).toBe(true);
    /* Original layout fields survive untouched. */
    expect(sheet.ppf).toBe(defaultLayouts()[0].ppf);
    expect(sheet.sheet).toBe(defaultLayouts()[0].sheet);
    expect(sheet.viewports.length).toBe(defaultLayouts()[0].viewports.length);
  });

  it('each view gains an id, a name and a drawing type', () => {
    const p = validateProject(JSON.parse(legacyProjectJSON()));
    const view = p.layouts[0].viewports[0];
    expect(view.id).toBe(1);
    expect(view.drawingType).toBe('plan');
    expect(view.name).toBeTruthy();
    /* Geometric viewport fields are preserved by name and value. */
    ['px', 'py', 'pw', 'ph', 'ppf'].forEach(k => {
      expect(view[k]).toBe(defaultLayouts()[0].viewports[0][k]);
    });
  });

  it('migrateDocument reports where it came from and passes entities through', () => {
    const raw = JSON.parse(legacyProjectJSON());
    const m = migrateDocument(raw);
    expect(m.migratedFrom).toBe(6);
    expect(m.v).toBe(DOC_VERSION);
    expect(m.entities).toBe(raw.entities);
  });
});

describe('3. the 24x36 cabin is unchanged end to end', () => {
  it('same PDF at every scale on the ladder', () => {
    const ents = cabin24x36();
    expect(pdfHash(ents, 'fit', 'CABIN')).toBe(PRE_REFACTOR_PDF['cabin:fit']);
    expect(pdfHash(ents, 18, 'CABIN')).toBe(PRE_REFACTOR_PDF['cabin:18']);
    expect(pdfHash(ents, 4.5, 'CABIN')).toBe(PRE_REFACTOR_PDF['cabin:4.5']);
  });
});

describe('4. text height in the exported PDF is constant across view scales', () => {
  function textSizeIn(pdf){
    /* Tf carries the point size the PDF actually sets. */
    const m = [...pdf.matchAll(/\/F1 ([\d.]+) Tf/g)].map(x => Number(x[1]));
    return m;
  }
  it('a paper space height prints the same at 1/4 and at 1/16', () => {
    const ents = [{ type: 'text', layer: 'TEXT', x: 0, y: 0, size: 1.2, paperTextH: 9, content: 'SOUTH ELEVATION' }];
    const a = buildPDF(ents, { ppf: 18, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    const b = buildPDF(ents, { ppf: 4.5, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(textSizeIn(a)).toContain(9);
    expect(textSizeIn(b)).toContain(9);
  });
  it('a model height still scales, which is why old files export unchanged', () => {
    const ents = [{ type: 'text', layer: 'TEXT', x: 0, y: 0, size: 1, content: 'ROOM' }];
    const a = buildPDF(ents, { ppf: 18, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    const b = buildPDF(ents, { ppf: 4.5, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(textSizeIn(a)).toContain(18);
    expect(textSizeIn(b)).not.toContain(18);
  });
});

describe('5. a dimension shows the true model measurement at any view scale', () => {
  it('the same 24 ft reads 24 ft at every scale', () => {
    const ents = [{ type: 'dim', layer: 'DIMS', x1: 0, y1: 0, x2: 24, y2: 0, off: 2 }];
    const shown = [72, 18, 4.5].map(ppf => {
      const pdf = buildPDF(ents, { ppf, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
      const m = pdf.match(/\((\d+'-[^)]*)\)/);
      return m ? m[1] : null;
    });
    expect(shown[0]).toBe("24'-0\"");
    expect(new Set(shown).size).toBe(1);
  });
});

describe('6. save, load, save produces an identical file', () => {
  it('round trips', () => {
    const src = { ...state };
    src.projectName = 'Round Trip';
    src.layers = defaultLayers();
    src.entities = cabin24x36();
    src.userBlocks = [];
    src.dimStyles = defaultDimStyles();
    src.currentDimStyle = 'ARCH';
    src.layouts = normalizeSheets(defaultLayouts());
    src.currentLayout = 'A1';
    src.space = 'model';
    src.dxfVer = 'R12';
    src.idSeq = 900; src.gSeq = 2;

    const first = serializeProject(src, true);
    const loaded = validateProject(JSON.parse(first));
    const target = { ...src };
    applyProject(target, loaded);
    const second = serializeProject(target, true);
    expect(second).toBe(first);
  });

  it('writes the new schema version', () => {
    expect(PROJECT_VERSION).toBe(DOC_VERSION);
    const src = { ...state, projectName: 'V', layers: defaultLayers(), entities: [], userBlocks: [], layouts: normalizeSheets(defaultLayouts()) };
    expect(JSON.parse(serializeProject(src, true)).v).toBe(7);
  });
});

describe('document model shapes', () => {
  it('sheet label is bare with one sheet and counted with several', () => {
    expect(sheetLabel('A-1', 0, 1)).toBe('SHEET A-1');
    expect(sheetLabel(null, 0, 1)).toBe('SHEET A-1');
    expect(sheetLabel('A-2', 1, 3)).toBe('SHEET A-2 OF 3');
  });
  it('views number from one within a sheet', () => {
    const sheet = normalizeSheet({ viewports: [{ ppf: 18 }, { ppf: 36 }] }, 0);
    expect(sheet.viewports.map(v => v.id)).toEqual([1, 2]);
    expect(sheet.sheetNumber).toBe('A-1');
  });
  it('a view carries its own drawing type', () => {
    const v = normalizeView({ ppf: 18, drawingType: 'elevation' }, 0, {});
    expect(v.drawingType).toBe('elevation');
    expect(normalizeView({ ppf: 18 }, 0, {}).drawingType).toBe('plan');
  });
  it('marks and attributes are optional and absent unless set', () => {
    const e = { type: 'line', layer: 'WALLS' };
    expect('mark' in e).toBe(false);
    setMark(e, 'E-1'); setAttributes(e, { type: 'MERLIN 1D', qty: 9 });
    expect(e.mark).toBe('E-1');
    expect(e.attributes.qty).toBe(9);
    setMark(e, null); setAttributes(e, null);
    expect('mark' in e).toBe(false);
    expect('attributes' in e).toBe(false);
  });
  it('marksOf collects only marked entities', () => {
    const ents = [{ mark: 'E-1' }, {}, { mark: 'E-2' }];
    expect(marksOf(ents).length).toBe(2);
  });
  it('space rules name what belongs where', () => {
    ['textHeight', 'hatchSpacing', 'lineWeight', 'arrowSize', 'labelBox', 'titleBlock']
      .forEach(k => expect(isPaperSpaceProperty(k)).toBe(true));
    ['geometry', 'dimensionMeasurement'].forEach(k => expect(isModelSpaceProperty(k)).toBe(true));
    expect(isPaperSpaceProperty('geometry')).toBe(false);
  });
});
