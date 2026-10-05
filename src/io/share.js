/* Zero-server share: gzip + base64url in the URL hash.
 * A cabin compresses to a few KB. If the token is too long for a URL, callers
 * fall back to downloading the HTML pack.
 */
const MAX_TOKEN = 12000;

function toU8(text){
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text));
  return Buffer.from(String(text), 'utf8');
}

function fromU8(u8){
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(u8);
  return Buffer.from(u8).toString('utf8');
}

function b64urlEncode(u8){
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64url');
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(token){
  const t = String(token || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 === 0 ? '' : '='.repeat(4 - (t.length % 4));
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(t + pad, 'base64'));
  const bin = atob(t + pad);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* Feed a whole buffer through a (De)CompressionStream.
 * The writes must not be awaited before the readable side is drained:
 * write() and close() wait on backpressure, and nothing reads until they
 * resolve, so `await w.write(); await w.close()` deadlocks in Chromium and
 * in Node's web streams. Start reading first, then settle the writer. */
async function through(stream, u8){
  const w = stream.writable.getWriter();
  const fed = Promise.all([w.write(u8), w.close()]);
  fed.catch(() => {}); /* a read error below reports the same failure */
  const out = await new Response(stream.readable).arrayBuffer();
  await fed;
  return new Uint8Array(out);
}

async function gzipU8(u8){
  if (typeof CompressionStream !== 'undefined') return through(new CompressionStream('gzip'), u8);
  const { gzipSync } = await import('zlib');
  return gzipSync(u8);
}

async function gunzipU8(u8){
  if (typeof DecompressionStream !== 'undefined') return through(new DecompressionStream('gzip'), u8);
  const { gunzipSync } = await import('zlib');
  return gunzipSync(u8);
}

export async function encodeShare(text){
  const gz = await gzipU8(toU8(text));
  const token = b64urlEncode(gz);
  if (token.length > MAX_TOKEN){
    const err = new Error('Drawing is too large to share as a URL — download HTML instead');
    err.code = 'SHARE_TOO_BIG';
    err.bytes = token.length;
    throw err;
  }
  return token;
}

export async function decodeShare(token){
  if (!token) throw new Error('Empty share');
  const u8 = b64urlDecode(token);
  return fromU8(await gunzipU8(u8));
}

export function shareUrl(token, base){
  const root = base || (typeof location !== 'undefined' ? (location.origin + location.pathname) : '');
  return root + '#sd=' + token;
}

export function tokenFromHash(hash){
  const h = String(hash || '').replace(/^#/, '');
  if (h.slice(0, 3) === 'sd=') return h.slice(3);
  const m = h.match(/(?:^|&)sd=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export { MAX_TOKEN };
