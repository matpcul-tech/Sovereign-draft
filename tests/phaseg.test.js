import { describe, it, expect } from 'vitest';
import {
  makeDetailCallout, resolveDetailTarget, detailBubbleText, danglingDetails,
  addAnnotation, annotationRect, DETAIL_BUBBLE_R
} from '../src/core/sheetspace.js';
import { normalizeSheets } from '../src/core/document.js';
import { makeLayout } from '../src/core/layout.js';
import { buildAllSheetsPDF, buildLayoutPDF } from '../src/io/pdf.js';
import { realizeDocument } from '../src/ai/draft.js';
import { cabin24x36 } from '../src/core/demo.js';

const idLayer = n => (n ? String(n).toUpperCase() : 'WALLS');

function threeSheets(){
  return normalizeSheets([
    makeLayout({ id: 'A1', name: 'A-1 PLAN', sheet: 'archd', ppf: 18 }),
    makeLayout({ id: 'A2', name: 'A-2 DETAIL', sheet: 'letter', ppf: 36 }),
    makeLayout({ id: 'A3', name: 'A-3 SECTIONS', sheet: 'tabloid', ppf: 9 })
  ]);
}

describe('a callout holds a target, not a rendered string', () => {
  it('resolves to the sheet and view it points at', () => {
    const sheets = threeSheets();
    const hit = resolveDetailTarget(sheets, { sheetId: 'A2', viewId: 1 });
    expect(hit).toBeTruthy();
    expect(hit.sheetNumber).toBe('A-2');
    expect(hit.viewId).toBe(1);
  });

  it('prints view number over sheet number', () => {
    const sheets = threeSheets();
    const b = makeDetailCallout(2, 2, { sheetId: 'A3', viewId: 1 });
    const t = detailBubbleText(sheets, b);
    expect(t.top).toBe('1');
    expect(t.bottom).toBe('A-3');
    expect(t.resolved).toBe(true);
  });

  it('renaming a sheet number updates every reference to it', () => {
    const sheets = threeSheets();
    const b = makeDetailCallout(2, 2, { sheetId: 'A2', viewId: 1 });
    expect(detailBubbleText(sheets, b).bottom).toBe('A-2');
    /* The reference is by id, so renumbering the sheet re-renders the bubble
     * rather than leaving stale text behind. */
    sheets[1].sheetNumber = 'A-7';
    expect(detailBubbleText(sheets, b).bottom).toBe('A-7');
  });

  it('a target pointing at nothing is reported, not silently printed', () => {
    const sheets = threeSheets();
    expect(resolveDetailTarget(sheets, { sheetId: 'GONE', viewId: 1 })).toBeNull();
    expect(resolveDetailTarget(sheets, { sheetId: 'A2', viewId: 9 })).toBeNull();
    expect(resolveDetailTarget(sheets, null)).toBeNull();
    const t = detailBubbleText(sheets, makeDetailCallout(1, 1, { sheetId: 'GONE', viewId: 1 }));
    expect(t.resolved).toBe(false);
    expect(t.top).toBe('?');
  });

  it('danglingDetails finds broken references across the document', () => {
    let sheets = threeSheets();
    sheets[0] = addAnnotation(sheets[0], makeDetailCallout(2, 2, { sheetId: 'A2', viewId: 1 }));
    sheets[0] = addAnnotation(sheets[0], makeDetailCallout(3, 2, { sheetId: 'NOPE', viewId: 1 }));
    const bad = danglingDetails(sheets);
    expect(bad.length).toBe(1);
    expect(bad[0].sheetNumber).toBe('A-1');
    expect(bad[0].target.sheetId).toBe('NOPE');
  });

  it('a bubble occupies its own circle for placement', () => {
    const r = annotationRect(makeDetailCallout(5, 5, { sheetId: 'A2', viewId: 1 }));
    expect(r[2] - r[0]).toBeCloseTo(DETAIL_BUBBLE_R * 2, 9);
    expect(r[3] - r[1]).toBeCloseTo(DETAIL_BUBBLE_R * 2, 9);
  });
});

describe('bubbles reach the exported PDF', () => {
  const ents = cabin24x36();

  it('the bubble and its numbers are drawn', () => {
    let sheets = threeSheets();
    sheets[0] = addAnnotation(sheets[0], makeDetailCallout(6, 12, { sheetId: 'A2', viewId: 1 }));
    const r = buildAllSheetsPDF(ents, { sheets, layerVisible: () => true, dateStr: '2026-01-01' });
    expect(r.pages).toBe(3);
    /* The bubble is a bezier circle plus its diameter, then the two numbers. */
    expect(r.pdf).toMatch(/ c S/);
    expect(r.pdf).toContain('(A-2)');
  });

  it('resolves across the document, not just the page it sits on', () => {
    let sheets = threeSheets();
    sheets[0] = addAnnotation(sheets[0], makeDetailCallout(6, 12, { sheetId: 'A3', viewId: 1 }));
    const r = buildAllSheetsPDF(ents, { sheets, layerVisible: () => true, dateStr: '2026-01-01' });
    expect(r.pdf).toContain('(A-3)');
    expect(r.pdf).not.toContain('(?)');
  });

  it('a single sheet export still renders its own bubbles', () => {
    let sheets = threeSheets();
    sheets[0] = addAnnotation(sheets[0], makeDetailCallout(6, 12, { sheetId: 'A1', viewId: 1 }));
    const pdf = buildLayoutPDF(ents, { layout: sheets[0], sheets, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(pdf).toContain('(A-1)');
  });

  it('a sheet with no callouts exports exactly as before', () => {
    const plain = threeSheets();
    const a = buildAllSheetsPDF(ents, { sheets: plain, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    const b = buildAllSheetsPDF(ents, { sheets: threeSheets(), layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(a).toBe(b);
  });
});

describe('the AI can cross reference its own sheet set', () => {
  const doc = realizeDocument(JSON.stringify({
    drawingType: 'elevation',
    profiles: [{ pts: [[0, 0], [8, 0], [8, 44], [4, 60], [0, 44]], mark: 'S-1', attrs: { type: 'STAGE' } }],
    sheets: [
      { number: 'A-1', name: 'OVERALL', size: 'archd',
        views: [{ scale: '1/16', drawingType: 'elevation', extents: [-6, -4, 10, 62] }],
        details: [{ x: 6, y: 12, sheet: 'A-2', view: 1 }] },
      { number: 'A-2', name: 'ENGINE BAY', size: 'letter',
        views: [{ scale: '1/2', drawingType: 'part', extents: [0, -3, 8, 1] }] }
    ]
  }), idLayer);

  it('places a bubble on A-1 pointing at A-2', () => {
    const a1 = doc.sheets[0];
    const bubble = a1.annotations.find(a => a.kind === 'detail');
    expect(bubble).toBeTruthy();
    expect(bubble.target.sheetId).toBe(doc.sheets[1].id);
    expect(detailBubbleText(doc.sheets, bubble).bottom).toBe('A-2');
  });

  it('a forward reference resolves even though A-2 came later', () => {
    expect(danglingDetails(doc.sheets).length).toBe(0);
  });

  it('a reference to a sheet that was never proposed is dropped, not dangling', () => {
    const d = realizeDocument(JSON.stringify({
      drawingType: 'part',
      profiles: [{ pts: [[0, 0], [4, 0], [4, 4], [0, 4]] }],
      sheets: [{ number: 'A-1', details: [{ x: 2, y: 2, sheet: 'A-9', view: 1 }] }]
    }), idLayer);
    expect((d.sheets[0].annotations || []).filter(a => a.kind === 'detail').length).toBe(0);
    expect(danglingDetails(d.sheets).length).toBe(0);
  });
});
