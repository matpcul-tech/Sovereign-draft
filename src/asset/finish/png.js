import { deflate, inflate } from "pako";

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(type, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error("PNG byte length does not match the image size.");
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), row + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk(new Uint8Array([73, 72, 68, 82]), ihdr), chunk(new Uint8Array([73, 68, 65, 84]), deflate(raw)), chunk(new Uint8Array([73, 69, 78, 68]), new Uint8Array())];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function decodePng(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) throw new Error("Not a PNG.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let inflated = null;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error("Only 8-bit RGBA PNG is read here.");
    } else if (type === "IDAT") {
      inflated = inflate(data);
    } else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!inflated) throw new Error("PNG has no image data.");
  const rgba = new Uint8Array(width * height * 4);
  const stride = width * 4 + 1;
  for (let y = 0; y < height; y++) {
    if (inflated[y * stride] !== 0) throw new Error("Only uncompressed PNG rows are read here.");
    rgba.set(inflated.subarray(y * stride + 1, y * stride + 1 + width * 4), y * width * 4);
  }
  return { width, height, rgba };
}

export function whitePng(size = 8) {
  const rgba = new Uint8Array(size * size * 4);
  rgba.fill(255);
  return encodePng(size, size, rgba);
}
