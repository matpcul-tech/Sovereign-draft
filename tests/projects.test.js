import { describe, it, expect, beforeEach } from 'vitest';
import {
  listProjects, saveProject, openProject, lastProjectId, renameProject,
  deleteProject, duplicateProject, migrateLegacyAutosave, shouldOfferSample, slugify, newId,
  INDEX_KEY, LAST_KEY, RECORD_PREFIX,
} from '../src/io/projects.js';
import { AUTOSAVE_KEY } from '../src/io/project.js';
import { defaultLayers } from '../src/core/state.js';

/* A localStorage stand-in, so the store is testable without a browser
 * and a full disk can be simulated exactly. */
function fakeStore(){
  const m = new Map();
  return {
    map: m,
    full: false,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem(k, v){ if (this.full) throw new Error('QuotaExceeded'); m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}

function doc(name, n){
  return {
    projectName: name,
    layers: defaultLayers(),
    entities: Array.from({ length: n || 1 }, (_, i) =>
      ({ type: 'line', layer: 'WALLS', x1: 0, y1: i, x2: 10, y2: i })),
    solids: [], idSeq: (n || 1) + 1, gSeq: 1, userBlocks: [],
  };
}

describe('a drawing is a named job on this device', () => {
  let s;
  beforeEach(() => { s = fakeStore(); });

  it('saves under a readable id and reopens by name', () => {
    const d = doc('Cabin', 3);
    const id = saveProject(d, s, 1000);
    expect(id).toBe('cabin');
    expect(d.projectId).toBe('cabin');
    const list = listProjects(s);
    expect(list).toEqual([{ id: 'cabin', name: 'Cabin', updated: 1000, entities: 3 }]);
    const back = openProject('cabin', s);
    expect(back.name).toBe('Cabin');
    expect(back.entities.length).toBe(3);
    expect(back.projectId).toBe('cabin');
  });

  it('keeps several jobs side by side, newest first', () => {
    saveProject(doc('Cabin'), s, 1000);
    saveProject(doc('Addition'), s, 2000);
    saveProject(doc('Lot 12'), s, 3000);
    expect(listProjects(s).map(e => e.name)).toEqual(['Lot 12', 'Addition', 'Cabin']);
    expect(listProjects(s).map(e => e.id)).toEqual(['lot-12', 'addition', 'cabin']);
    /* Each one still opens as itself. */
    expect(openProject('cabin', s).name).toBe('Cabin');
    expect(openProject('lot-12', s).name).toBe('Lot 12');
  });

  it('two jobs may share a name without overwriting each other', () => {
    const a = doc('Cabin', 2), b = doc('Cabin', 7);
    expect(saveProject(a, s, 1)).toBe('cabin');
    expect(saveProject(b, s, 2)).toBe('cabin-2');
    expect(openProject('cabin', s).entities.length).toBe(2);
    expect(openProject('cabin-2', s).entities.length).toBe(7);
  });

  it('re-saving the same job updates it in place, never duplicates', () => {
    const d = doc('Cabin', 2);
    saveProject(d, s, 1000);
    d.entities.push({ type: 'line', layer: 'WALLS', x1: 0, y1: 9, x2: 1, y2: 9 });
    saveProject(d, s, 2000);
    const list = listProjects(s);
    expect(list.length).toBe(1);
    expect(list[0].updated).toBe(2000);
    expect(list[0].entities).toBe(3);
    expect(openProject('cabin', s).entities.length).toBe(3);
  });

  it('remembers the last job opened, and forgets it when deleted', () => {
    saveProject(doc('Cabin'), s, 1000);
    saveProject(doc('Addition'), s, 2000);
    expect(lastProjectId(s)).toBe('addition');
    deleteProject('addition', s);
    expect(lastProjectId(s)).toBe(null);
    expect(listProjects(s).map(e => e.id)).toEqual(['cabin']);
    expect(openProject('addition', s)).toBe(null);
  });

  it('renames in the list and inside the stored document', () => {
    saveProject(doc('Cabin'), s, 1000);
    expect(renameProject('cabin', 'Miller Cabin', s)).toBe(true);
    expect(listProjects(s)[0].name).toBe('Miller Cabin');
    expect(openProject('cabin', s).name).toBe('Miller Cabin');
    /* An empty name is not a rename. */
    expect(renameProject('cabin', '   ', s)).toBe(false);
    expect(listProjects(s)[0].name).toBe('Miller Cabin');
  });

  it('duplicates a job without touching the original', () => {
    saveProject(doc('Cabin', 4), s, 1000);
    const nid = duplicateProject('cabin', s, 2000);
    expect(nid).toBe('cabin-copy');
    expect(openProject('cabin', s).entities.length).toBe(4);
    expect(openProject('cabin-copy', s).name).toBe('Cabin copy');
    expect(listProjects(s).map(e => e.id)).toEqual(['cabin-copy', 'cabin']);
  });

  it('carries the old single autosave slot into a named job, once', () => {
    s.setItem(AUTOSAVE_KEY, JSON.stringify({
      app: 'sovereign-draft', v: 7, name: '24x36 Cabin',
      layers: defaultLayers(), entities: doc('x', 5).entities,
    }));
    const id = migrateLegacyAutosave(s, 1000);
    expect(id).toBe('24x36-cabin');
    expect(listProjects(s)[0].name).toBe('24x36 Cabin');
    expect(openProject(id, s).entities.length).toBe(5);
    expect(lastProjectId(s)).toBe(id);
    /* Only once: it must not clone itself on every launch. */
    expect(migrateLegacyAutosave(s, 2000)).toBe(null);
    expect(listProjects(s).length).toBe(1);
  });

  it('a full disk fails honestly instead of corrupting the list', () => {
    saveProject(doc('Cabin'), s, 1000);
    s.full = true;
    const d = doc('Addition');
    expect(saveProject(d, s, 2000)).toBe(null);
    /* The job that was already there is untouched and still opens. */
    expect(listProjects(s).map(e => e.id)).toEqual(['cabin']);
    expect(openProject('cabin', s).entities.length).toBe(1);
  });

  it('survives a store that is missing or holding junk', () => {
    expect(listProjects(null)).toEqual([]);
    expect(openProject('x', null)).toBe(null);
    expect(lastProjectId(null)).toBe(null);
    s.setItem(INDEX_KEY, 'not json');
    expect(listProjects(s)).toEqual([]);
    s.setItem(INDEX_KEY, JSON.stringify([{ nope: 1 }, null, { id: 'ok' }]));
    expect(listProjects(s).map(e => e.id)).toEqual(['ok']);
    s.setItem(RECORD_PREFIX + 'ok', '{{{');
    expect(openProject('ok', s)).toBe(null);
  });

  it('names become file names a person can find later', () => {
    expect(slugify('Miller Cabin')).toBe('miller-cabin');
    expect(slugify('Lot 12 / Addition')).toBe('lot-12-addition');
    expect(slugify('   ')).toBe('untitled');
    expect(newId('Cabin', ['cabin'])).toBe('cabin-2');
    expect(newId('Cabin', ['cabin', 'cabin-2'])).toBe('cabin-3');
  });
});

describe('what a launch opens', () => {
  const cabin = { projectId: 'cabin', entities: [{ type: 'line' }] };
  const empty = { projectId: 'addition', entities: [] };
  const legacy = { projectId: null, entities: [{ type: 'line' }] };

  it('an empty named job still beats the sample cabin', () => {
    /* The bug this pins: someone starts "Addition", closes the tab before
     * drawing, and comes back to a sample cabin that has taken over as
     * the current job. A name is enough to make a launch a return. */
    expect(shouldOfferSample({ restored: empty })).toBe(false);
    expect(shouldOfferSample({ restored: cabin })).toBe(false);
  });

  it('a genuine first run gets the sample', () => {
    expect(shouldOfferSample({ restored: null })).toBe(true);
    expect(shouldOfferSample({})).toBe(true);
  });

  it('the old unnamed slot has to hold something to count', () => {
    expect(shouldOfferSample({ restored: legacy })).toBe(false);
    expect(shouldOfferSample({ restored: { projectId: null, entities: [] } })).toBe(true);
  });

  it('an embed or a share link never gets the sample', () => {
    expect(shouldOfferSample({ embedded: true, restored: null })).toBe(false);
    expect(shouldOfferSample({ share: 'abc', restored: null })).toBe(false);
  });
});
