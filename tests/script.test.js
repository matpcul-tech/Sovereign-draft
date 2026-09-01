import { describe, it, expect, beforeEach } from 'vitest';
import {
  runScript, makeSd, saveScript, scriptByName, deleteScript, validateScripts, EXAMPLE_SCRIPTS
} from '../src/core/script.js';
import { state, defaultLayers, doUndo, doRedo } from '../src/core/state.js';
import { serializeProject, validateProject, applyProject } from '../src/io/project.js';
import { lookupCommand } from '../src/core/command.js';

function reset(){
  state.layers = defaultLayers();
  state.entities = [];
  state.constraints = [];
  state.selIds = [];
  state.undoStack = [];
  state.redoStack = [];
  state.idSeq = 1;
  state.solids = [];
  state.autoRooms = false;
  state.scripts = [];
  state.currentLayer = 'WALLS';
}

describe('a script draws through the same door as the tools', () => {
  beforeEach(reset);

  it('creates entities and reports on them', () => {
    const r = runScript(`
      const a = sd.add.line(0, 0, 20, 0);
      sd.add.circle(5, 5, 2);
      sd.add.poly([[0,0],[4,0],[4,4]], { closed: true });
      print('length', sd.measure.length(a));
    `);
    expect(r.ok).toBe(true);
    expect(state.entities.length).toBe(3);
    expect(r.created.length).toBe(3);
    expect(r.output).toEqual(['length 20']);
  });

  it('queries find what was drawn', () => {
    const r = runScript(`
      sd.add.line(0, 0, 5, 0);
      sd.add.circle(50, 50, 1, { layer: 'DOORS' });
      print(sd.query.byType('circle').length, sd.query.byLayer('doors').length,
            sd.query.where(e => e.type === 'line').length);
    `);
    expect(r.output).toEqual(['1 1 1']);
  });

  it('transforms move the real document', () => {
    runScript(`
      const a = sd.add.line(0, 0, 10, 0);
      sd.move(a, 5, 5);
      sd.rotate(a, 5, 5, 90);
    `);
    const l = state.entities[0];
    expect(l.x1).toBeCloseTo(5, 9);
    expect(l.y1).toBeCloseTo(5, 9);
    expect(l.x2).toBeCloseTo(5, 9);
    expect(l.y2).toBeCloseTo(15, 9);
  });

  it('booleans and constraints are reachable', () => {
    const r = runScript(`
      const a = sd.add.poly([[0,0],[10,0],[10,10],[0,10]], { closed: true });
      const b = sd.add.poly([[5,5],[15,5],[15,15],[5,15]], { closed: true });
      const u = sd.boolean('union', [a, b]);
      const line = sd.add.line(0, 20, 10, 21.5);
      sd.constrain('horizontal', { a: line });
      sd.solve();
      print(sd.measure.netArea(u).toFixed(0));
    `);
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(['175']);
    const l = state.entities.find(e => e.type === 'line');
    expect(Math.abs(l.y1 - l.y2)).toBeLessThan(1e-4);
  });
});

describe('the transaction property', () => {
  beforeEach(reset);

  it('a whole run is one undo step', () => {
    runScript('for (let i = 0; i < 10; i++) sd.add.line(i, 0, i, 5);');
    expect(state.entities.length).toBe(10);
    expect(state.undoStack.length).toBe(1);
    doUndo();
    expect(state.entities.length).toBe(0);
    doRedo();
    expect(state.entities.length).toBe(10);
  });

  it('a script that throws leaves no trace at all', () => {
    runScript('sd.add.line(0,0,9,0);');
    const before = JSON.stringify(state.entities);
    const undoDepth = state.undoStack.length;
    const r = runScript(`
      sd.add.line(1, 1, 2, 2);
      sd.add.circle(3, 3, 1);
      sd.delete(sd.query.byType('line'));
      throw new Error('halfway');
    `);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('halfway');
    expect(JSON.stringify(state.entities)).toBe(before);
    expect(state.undoStack.length).toBe(undoDepth);
  });

  it('a failed run even keeps the pending redo', () => {
    runScript('sd.add.line(0,0,1,0)');
    runScript('sd.add.circle(5,5,1)');
    doUndo();
    expect(state.redoStack.length).toBe(1);
    runScript('throw new Error("boom")');
    expect(state.redoStack.length).toBe(1);
    doRedo();
    expect(state.entities.some(e => e.type === 'circle')).toBe(true);
  });

  it('a syntax error is a clean failure, not an exception', () => {
    const r = runScript('this is not javascript');
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});

describe('the mediation property', () => {
  beforeEach(reset);

  it('reads are copies: mutating them changes nothing', () => {
    runScript('sd.add.line(0,0,10,0)');
    const r = runScript(`
      const e = sd.get(sd.query.byType('line')[0]);
      e.x2 = 99999;
      sd.entities()[0].y1 = 99999;
    `);
    expect(r.ok).toBe(true);
    expect(state.entities[0].x2).toBe(10);
    expect(state.entities[0].y1).toBe(0);
  });

  it('geometry fields cannot be poked directly', () => {
    runScript('sd.add.line(0,0,10,0)');
    const r = runScript('sd.update(sd.query.byType("line")[0], { x1: 5 });');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not settable');
  });

  it('style fields can', () => {
    runScript('sd.add.line(0,0,10,0)');
    const r = runScript('sd.update(sd.query.byType("line")[0], { layer: "DOORS", lt: "HIDDEN" });');
    expect(r.ok).toBe(true);
    expect(state.entities[0].layer).toBe('DOORS');
  });

  it('non finite numbers are refused at the door', () => {
    const r = runScript('sd.add.line(0, 0, Infinity, 0);');
    expect(r.ok).toBe(false);
    expect(state.entities.length).toBe(0);
  });

  it('the obvious globals are shadowed inside a run', () => {
    const r = runScript('print(typeof window, typeof document, typeof fetch);');
    expect(r.output).toEqual(['undefined undefined undefined']);
  });

  it('runaway printing is cut off', () => {
    const r = runScript('for (let i = 0; i < 10000; i++) print(i);');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('500');
  });
});

describe('saved scripts', () => {
  beforeEach(reset);

  it('save, look up, run by name, delete', () => {
    saveScript('halve', 'sd.add.line(0,0,5,0)');
    expect(scriptByName('HALVE')).toBeTruthy();
    expect(scriptByName('halve').name).toBe('HALVE');
    const r = runScript(scriptByName('halve').code);
    expect(r.ok).toBe(true);
    expect(deleteScript('halve')).toBe(true);
    expect(scriptByName('halve')).toBe(null);
  });

  it('saving over a name replaces it', () => {
    saveScript('X', 'print(1)');
    saveScript('x', 'print(2)');
    expect(state.scripts.length).toBe(1);
    expect(scriptByName('X').code).toBe('print(2)');
  });

  it('scripts survive save and load with the project', () => {
    saveScript('MINE', 'sd.add.line(0,0,1,1)');
    const p = validateProject(JSON.parse(serializeProject(state, true)));
    expect(p.scripts.length).toBe(1);
    const target = { ...state, scripts: [] };
    applyProject(target, p);
    expect(target.scripts[0].name).toBe('MINE');
  });

  it('junk script lists are cleaned on load', () => {
    expect(validateScripts([null, { name: 'A' }, { name: 'B', code: 'x' }, { name: 'b', code: 'y' }]))
      .toEqual([{ name: 'B', code: 'x' }]);
    expect(validateScripts('nope')).toEqual([]);
  });

  it('the shipped examples actually run', () => {
    for (const ex of EXAMPLE_SCRIPTS){
      const r = runScript(ex.code);
      expect(r.ok).toBe(true);
    }
  });
});

describe('the commands are registered', () => {
  it('SCRIPT and RUN reach the command line', () => {
    expect(lookupCommand('SCRIPT').action).toBe('script');
    expect(lookupCommand('JS').action).toBe('script');
    expect(lookupCommand('RUN').action).toBe('runscript');
  });
});

void makeSd;
