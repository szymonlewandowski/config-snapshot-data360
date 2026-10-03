// Generates extension/icons/icon{16,32,48,128}.png (no dependencies): teal rounded square,
// white stacked "layers" glyph with a download arrow. Rendered with 4x4 supersampling.
//   node scripts/make-icons.js
import fs from 'node:fs';
import zlib from 'node:zlib';

const TEAL = [11, 122, 117];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Shapes in unit coordinates (0..1).
const inRoundRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inBar = (x, y, x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function glyph(x, y) {
  // three stacked layers (top two) + arrow (bottom)
  const layer1 = inBar(x, y, 0.22, 0.78, 0.2, 0.3);
  const layer2 = inBar(x, y, 0.22, 0.78, 0.37, 0.47);
  const stem = inBar(x, y, 0.44, 0.56, 0.52, 0.68);
  const head = y >= 0.64 && y <= 0.82 && Math.abs(x - 0.5) <= (0.82 - y) * 1.1;
  return layer1 || layer2 || stem || head;
}

function render(size) {
  const S = 4;
  return png(size, (px, py) => {
    let bg = 0, fg = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const x = (px + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
      if (inRoundRect(x, y, 0.22)) { bg++; if (glyph(x, y)) fg++; }
    }
    const n = S * S;
    if (!bg) return [0, 0, 0, 0];
    const t = fg / bg;
    const mix = TEAL.map((c, i) => Math.round(c * (1 - t) + WHITE[i] * t));
    return [...mix, Math.round((bg / n) * 255)];
  });
}

const dir = new URL('../src/icons/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
for (const s of [16, 32, 48, 128]) fs.writeFileSync(new URL(`icon${s}.png`, dir), render(s));
console.log('icons written to src/icons/');
