import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare, shareUrl, tokenFromHash } from '../src/io/share.js';
import { sampleCabin, toJSON, toHTML } from '../src/api.js';

describe('share codec', () => {
  it('round-trips a cabin through gzip+base64url', async () => {
    const json = toJSON(sampleCabin(), false);
    const token = await encodeShare(json);
    expect(token.length).toBeLessThan(json.length);
    expect(token).not.toMatch(/[+/=]/);
    const back = await decodeShare(token);
    const a = JSON.parse(json), b = JSON.parse(back);
    expect(b.name).toBe(a.name);
    expect(b.entities.length).toBe(a.entities.length);
  });

  it('parses #sd= from a hash', () => {
    expect(tokenFromHash('#sd=abc')).toBe('abc');
    expect(shareUrl('abc', 'https://x.example/app')).toBe('https://x.example/app#sd=abc');
  });
});

describe('HTML sheet pack', () => {
  it('emits one page per sheet', () => {
    const html = toHTML(sampleCabin());
    expect(html).toContain('class="page"');
    expect((html.match(/class="page"/g) || []).length).toBeGreaterThan(3);
    expect(html).toContain('G-001');
    expect(html).toContain('KITCHEN');
  });
});
