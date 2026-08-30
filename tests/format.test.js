import { describe, it, expect, afterEach } from 'vitest';
import { fmtFtIn, parseLength, setDisplayUnits } from '../src/core/format.js';

afterEach(() => setDisplayUnits('ft'));

describe('fmtFtIn', () => {
  it('formats whole feet', () => {
    expect(fmtFtIn(10)).toBe('10\'-0"');
  });
  it('formats inches only', () => {
    expect(fmtFtIn(0.5)).toBe('6"');
  });
  it('formats feet and inches', () => {
    expect(fmtFtIn(3.25)).toBe('3\'-3"');
  });
  it('rounds to the nearest half inch', () => {
    expect(fmtFtIn(1 / 24)).toBe('½"'.replace('½', '0½'));
  });
  it('handles negatives', () => {
    expect(fmtFtIn(-2)).toBe('-2\'-0"');
  });
  it('can display millimetres', () => {
    setDisplayUnits('mm');
    expect(fmtFtIn(10)).toBe('3048 mm');
    expect(fmtFtIn(1)).toBe('305 mm');
  });
});

describe('parseLength metric', () => {
  it('reads an explicit millimetre suffix in any unit mode', () => {
    expect(parseLength('3048mm')).toBeCloseTo(10, 5);
    expect(parseLength('3.048m')).toBeCloseTo(10, 5);
  });
  it('treats a bare number as mm when display units are mm', () => {
    setDisplayUnits('mm');
    expect(parseLength('3048')).toBeCloseTo(10, 5);
  });
});
