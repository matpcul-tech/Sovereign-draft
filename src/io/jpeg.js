/* Just enough JPEG reading to embed one in a PDF.
 *
 * PDF accepts JPEG bytes verbatim under the DCTDecode filter, so embedding a
 * firm's logo needs no decoding at all - only the pixel dimensions for the
 * image dictionary and enough validation to refuse a file that is not a
 * JPEG, because a broken image object can render the whole page blank in
 * strict viewers.
 */

export function isJpeg(bytes){
  return !!bytes && bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/* Width, height and channel count from the start-of-frame marker. */
export function jpegInfo(bytes){
  if (!isJpeg(bytes)) return null;
  let p = 2;
  while (p + 9 < bytes.length){
    if (bytes[p] !== 0xff){ p++; continue; }
    const marker = bytes[p + 1];
    /* SOF0..SOF15, excluding DHT(C4), DAC(CC) and RST/other non-frame markers. */
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc){
      return {
        height: (bytes[p + 5] << 8) | bytes[p + 6],
        width: (bytes[p + 7] << 8) | bytes[p + 8],
        channels: bytes[p + 9],
        progressive: marker === 0xc2
      };
    }
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (len < 2) return null;
    p += 2 + len;
  }
  return null;
}

/* A data URL's payload as bytes, for logos stored with the project. */
export function dataUrlToBytes(url){
  const m = /^data:image\/jpe?g;base64,(.+)$/i.exec(String(url || ''));
  if (!m) return null;
  try {
    const bin = typeof atob === 'function' ? atob(m[1]) : Buffer.from(m[1], 'base64').toString('binary');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  } catch { return null; }
}
