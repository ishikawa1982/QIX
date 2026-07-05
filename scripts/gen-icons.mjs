// Generates PNG app icons (no image deps) with a simple neon-diamond motif.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../client/public/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pixel(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const d = (Math.abs(x - cx) + Math.abs(y - cy)) / (size / 2); // diamond distance 0..~1
  // Background gradient (dark navy).
  const bgT = y / size;
  const bg = [Math.round(11 + bgT * 6), Math.round(16 + bgT * 8), Math.round(32 + bgT * 16)];
  if (d < 0.62) {
    // Neon cyan -> pink diamond.
    const t = d / 0.62;
    const r = Math.round(34 + t * (244 - 34));
    const g = Math.round(211 + t * (114 - 211));
    const b = Math.round(238 + t * (182 - 238));
    return [r, g, b, 255];
  }
  return [bg[0], bg[1], bg[2], 255];
}

for (const size of [192, 512]) {
  const png = encodePng(size, pixel);
  writeFileSync(new URL(`icon-${size}.png`, `file://${outDir}`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}
