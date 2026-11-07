import { describe, expect, it } from 'vitest';
import { lookupCommand } from '../src/core/command.js';
import { parseLine } from '../src/asset/grammar.js';
import { parseLevel } from '../src/asset/level.js';

describe('street asset commands', () => {
  it('keeps drafting BOX and adds the asset space', () => {
    expect(lookupCommand('BOX').action).toBe('prim:box');
    expect(lookupCommand('ASSET').action).toBe('asset');
    expect(lookupCommand('LEVEL').action).toBe('assetlevel');
    expect(lookupCommand('ARTIST').action).toBe('assetartist');
    expect(lookupCommand('SEDAN').action).toBe('assetsedan');
    expect(lookupCommand('SHOP').action).toBe('assetshop');
    expect(lookupCommand('BIN').action).toBe('assetbin');
    expect(lookupCommand('GLB').action).toBe('assetglb');
  });

  it('parses a block the artist can lay out', () => {
    const plan = parseLevel([
      'NAME night-block',
      'LEVEL',
      'ROAD 32',
      'SHOP -8 0 #efe6d4',
      'SHOP 8 10 #b5523a',
      'CAR -1.5 4 0 #1c3d66',
      'BIN -5 12'
    ]);
    expect(plan.name).toBe('night-block');
    expect(plan.places.filter(p => p.kind === 'shop')).toHaveLength(2);
    expect(parseLine('BOX 0 0.5 0 1 1 1 paint').op.kind).toBe('box');
  });
});
