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

  /* The in-app sheet is the copy people actually reach for (HELP), and it
   * once drifted 310 words lighter than the standalone page: auto-rooms,
   * XP explode, the snap readout, what the project file carries. Each
   * capability the guide promises is named here, so a future tightening
   * cannot quietly drop one again. */
  it('carries every capability the standalone guide promises', () => {
    const html = guideHTML();
    for (const fact of [
      'auto-rooms',            // rooms follow the walls
      'XP',                    // explode
      'vertex',                // the 3D snap readout names its lock
      'alt',                   // and how to move free of it
      'one page per sheet',    // what Export PDF issues
      'placed renders',        // what the project file carries
      'UNDO',                  // undo is a typed command too
      'TURNTABLE',             // the video verbs
      'WALK',
      'KEYMAP ACAD',           // the AutoCAD keymap
      'STL',                   // mesh exports
    ]) expect(html, fact + ' went missing from the in-app guide').toContain(fact);
  });

  it('is valid markup: no bare angle bracket inside a code span', () => {
    /* <code>@8<45</code> only rendered by parser luck. */
    expect(guideHTML()).not.toMatch(/<code>[^<]*<(?!\/code>)/);
  });
});
