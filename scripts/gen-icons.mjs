/* Generate PWA PNG icons (192/512) without native deps: raw RGBA raster
 * encoded as a PNG with zlib. Matches the favicon mark: navy tile, gold
 * square outline, teal dot.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf){
  let c, table = crc32.table;
  if (!table){
    table = crc32.table = [];
    for (let n = 0; n < 256; n++){
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba){
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++){
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const NAVY = [7, 16, 31], GOLD = [212, 168, 67], TEAL = [0, 212, 184];

function render(size){
  const px = Buffer.alloc(size * size * 4);
  const s = size / 64; // design space is 64x64
  const put = (i, c) => { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  for (let y = 0; y < size; y++){
    for (let x = 0; x < size; x++){
      const i = (y * size + x) * 4;
      const dx = x / s, dy = y / s;
      put(i, NAVY);
      // gold square outline: 14..50, stroke 4
      const inOuter = dx >= 14 && dx <= 50 && dy >= 14 && dy <= 50;
      const inInner = dx >= 18 && dx <= 46 && dy >= 18 && dy <= 46;
      if (inOuter && !inInner) put(i, GOLD);
      // teal dot r=7 at center
      const ddx = dx - 32, ddy = dy - 32;
      if (ddx * ddx + ddy * ddy <= 49) put(i, TEAL);
    }
  }
  return png(size, size, px);
}

mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of [192, 512]){
  writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), render(size));
  console.log(`icon-${size}.png written`);
}
