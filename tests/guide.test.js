import { describe, it, expect } from 'vitest';
import { lookupCommand } from '../src/core/command.js';
import { guideHTML } from '../src/ui/guide.js';

describe('Field Guide', () => {
  it('HELP / GUIDE / ? open the in-app guide', () => {
    expect(lookupCommand('HELP').action).toBe('guide');
    expect(lookupCommand('GUIDE').action).toBe('guide');
    expect(lookupCommand('?').action).toBe('guide');
  });

  it('is CAD chrome, not a cream magazine', () => {
    const html = guideHTML();
    expect(html).toContain('The Field');
    expect(html).toContain('guide-chrome');
    expect(html).toContain('Command:');
    expect(html).toContain('MODEL');
    expect(html).toContain('DORMER');
    expect(html).not.toMatch(/Fraunces|#f6f1e7|#fffdf6/i);
  });
});
