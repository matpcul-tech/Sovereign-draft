import { describe, it, expect } from 'vitest';
import { scrubInventedMaterials, namedInPrompt, realizeDocument } from '../src/ai/draft.js';
import { collectParts } from '../src/core/spec.js';

describe('namedInPrompt', () => {
  it('only matches a material the user actually typed', () => {
    expect(namedInPrompt('falcon 9 with aluminum tanks', 'aluminum')).toBe(true);
    expect(namedInPrompt('falcon 9', 'AL-LI 2198')).toBe(false);
    expect(namedInPrompt('use Inconel on the nozzle', 'Inconel')).toBe(true);
  });
});

describe('scrubInventedMaterials', () => {
  it('strips guessed alloys when the prompt did not name them', () => {
    const ents = [{ type: 'callout', content: 'TANK', attributes: { material: 'AL-LI 2198', qty: 1 } }];
    scrubInventedMaterials(ents, 'draw a falcon 9');
    expect(ents[0].attributes.material).toBeUndefined();
    expect(ents[0].attributes.materialInvented).toBe(true);
  });

  it('keeps a material the user named', () => {
    const ents = [{ type: 'callout', content: 'TANK', attributes: { material: 'aluminum 7075' } }];
    scrubInventedMaterials(ents, 'aluminum 7075 tanks please');
    expect(ents[0].attributes.material).toBe('aluminum 7075');
  });

  it('leaves drawings alone when there is no prompt (SHEETSET path)', () => {
    const ents = [{ attributes: { material: 'STEEL' } }];
    scrubInventedMaterials(ents, null);
    expect(ents[0].attributes.material).toBe('STEEL');
  });
});

describe('realizeDocument + collectParts', () => {
  it('does not schedule invented materials from an elevation schema', () => {
    const json = JSON.stringify({
      drawingType: 'elevation',
      profiles: [{ pts: [[0, 0], [12, 0], [12, 20], [0, 20]], mark: 'NC-TIP', attrs: { material: 'CARBON FIBER', qty: 1, size: '10\'-0"' } }],
      callouts: [{ anchor: [12, 18], text: 'NOSE CONE TIP' }]
    });
    const doc = realizeDocument(json, n => n || 'PROFILE', { prompt: 'falcon 9 elevation' });
    const profile = doc.entities.find(e => e.type === 'profile');
    expect(profile.attributes.material).toBeUndefined();
    const parts = collectParts(doc.entities);
    expect(parts.some(p => p.material)).toBe(false);
  });
});
