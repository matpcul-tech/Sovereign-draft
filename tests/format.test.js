import { describe, it, expect } from 'vitest';
import { fmtFtIn } from '../src/core/format.js';

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
});
