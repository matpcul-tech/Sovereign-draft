import { describe, it, expect } from 'vitest';
import { parseLength, parsePoint, fmtFtIn } from '../src/core/format.js';
import { lookupCommand } from '../src/core/command.js';

describe('parseLength', () => {
  it('reads decimal feet', () => {
    expect(parseLength('10')).toBe(10);
    expect(parseLength('3.25')).toBeCloseTo(3.25);
  });
  it("reads 12'6\"", () => {
    expect(parseLength("12'6\"")).toBeCloseTo(12.5);
    expect(parseLength("12'-6\"")).toBeCloseTo(12.5);
  });
  it('reads inches only', () => {
    expect(parseLength('6"')).toBeCloseTo(0.5);
    expect(parseLength("0'-6\"")).toBeCloseTo(0.5);
  });
});

describe('parsePoint', () => {
  it('absolute x,y', () => {
    expect(parsePoint('10,20')).toEqual([10, 20]);
    expect(parsePoint('#24,36')).toEqual([24, 36]);
  });
  it('relative cartesian', () => {
    expect(parsePoint('@8,0', [10, 10])).toEqual([18, 10]);
  });
  it('relative polar @8<45', () => {
    const p = parsePoint('@8<45', [0, 0]);
    expect(p[0]).toBeCloseTo(8 * Math.SQRT1_2);
    expect(p[1]).toBeCloseTo(8 * Math.SQRT1_2);
  });
  it('distance along rubber-band', () => {
    const p = parsePoint('10', [0, 0], [1, 0]);
    expect(p).toEqual([10, 0]);
  });
  it("accepts 12'6\" as a distance", () => {
    const p = parsePoint("12'6\"", [0, 0], [0, 1]);
    expect(p[1]).toBeCloseTo(12.5);
  });
});

describe('lookupCommand', () => {
  it('resolves aliases from the brief', () => {
    expect(lookupCommand('A').tool).toBe('arc');
    expect(lookupCommand('B').tool).toBe('fillet');
    expect(lookupCommand('N').tool).toBe('chamfer');
    expect(lookupCommand('I').tool).toBe('mirror');
    expect(lookupCommand('G').tool).toBe('scale');
    expect(lookupCommand('W').tool).toBe('move');
    expect(lookupCommand('U').tool).toBe('copy');
    expect(lookupCommand('Y').tool).toBe('array');
    expect(lookupCommand('J').tool).toBe('join');
    expect(lookupCommand('K').tool).toBe('hatch');
    expect(lookupCommand('L').tool).toBe('line');
    expect(lookupCommand('XP').action).toBe('explode');
    expect(lookupCommand('FLIP').action).toBe('flip');
    expect(lookupCommand('XL').tool).toBe('xline');
    expect(lookupCommand('GRID').tool).toBe('grid');
    expect(lookupCommand('ROOMS').action).toBe('rooms');
  });
});

describe('fmtFtIn half-inch still matches legacy tests', () => {
  it('keeps 10 ft and 6 in', () => {
    expect(fmtFtIn(10)).toBe('10\'-0"');
    expect(fmtFtIn(0.5)).toBe('6"');
  });
});
