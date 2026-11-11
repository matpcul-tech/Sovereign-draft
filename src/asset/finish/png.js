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
  let colorType = 6;
  const idats = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      if (data[8] !== 8) throw new Error("Only 8-bit PNG is read here.");
      colorType = data[9];
      if (colorType !== 2 && colorType !== 6) throw new Error("Only RGB and RGBA PNG are read here.");
    } else if (type === "IDAT") idats.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!idats.length) throw new Error("PNG has no image data.");
  let total = 0;
  for (const chunk of idats) total += chunk.length;
  const packed = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of idats) {
    packed.set(chunk, cursor);
    cursor += chunk.length;
  }
  const inflated = inflate(packed);
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const row = inflated.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = unfilterRow(filter, row, prev, bpp);
    raw.set(out, y * stride);
    prev = out;
  }
  const rgba = new Uint8Array(width * height * 4);
  if (bpp === 4) {
    rgba.set(raw);
  } else {
    for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
      rgba[j] = raw[i];
      rgba[j + 1] = raw[i + 1];
      rgba[j + 2] = raw[i + 2];
      rgba[j + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function unfilterRow(filter, row, prev, bpp) {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < out.length; i++) {
    const left = i >= bpp ? out[i - bpp] : 0;
    const up = prev[i] || 0;
    const upLeft = i >= bpp ? prev[i - bpp] || 0 : 0;
    const value = row[i];
    if (filter === 0) out[i] = value;
    else if (filter === 1) out[i] = (value + left) & 255;
    else if (filter === 2) out[i] = (value + up) & 255;
    else if (filter === 3) out[i] = (value + ((left + up) >> 1)) & 255;
    else if (filter === 4) out[i] = (value + paeth(left, up, upLeft)) & 255;
    else throw new Error("PNG filter " + filter + " is not supported.");
  }
  return out;
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dlu = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dlu) return left;
  if (du <= dlu) return up;
  return upLeft;
}

export function whitePng(size = 8) {
  const rgba = new Uint8Array(size * size * 4);
  rgba.fill(255);
  return encodePng(size, size, rgba);
}
