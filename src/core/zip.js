// Minimal ZIP writer, no dependencies. Works in browsers and Node.
// createZip: STORE (sync). createZipCompressed: DEFLATE via the built-in CompressionStream
// (Chrome 80+, Node 18+), falling back to STORE per file when compression does not help.
// Limits: < 65535 entries and < 4 GB in total (no ZIP64). Enough for an org export.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const encoder = new TextEncoder();
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

export const canCompress = () => typeof CompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function';

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {{ name: string, data: string | Uint8Array }[]} entries */
export function createZip(entries, { date = new Date() } = {}) {
  return writeZip(entries.map((e) => {
    const data = toBytes(e.data);
    return { name: encoder.encode(e.name), payload: data, method: 0, crc: crc32(data), size: data.length };
  }), date);
}

/** @param {{ name: string, data: string | Uint8Array }[]} entries */
export async function createZipCompressed(entries, { date = new Date() } = {}) {
  if (!canCompress()) return createZip(entries, { date });
  const files = [];
  for (const e of entries) {
    const data = toBytes(e.data);
    const deflated = data.length > 64 ? await deflateRaw(data) : null;
    const useDeflate = deflated && deflated.length < data.length;
    files.push({ name: encoder.encode(e.name), payload: useDeflate ? deflated : data, method: useDeflate ? 8 : 0, crc: crc32(data), size: data.length });
  }
  return writeZip(files, date);
}

function writeZip(files, date) {
  const { time, date: dosDate } = dosDateTime(date);
  if (files.length >= 0xffff) throw new Error('Too many files for a ZIP without ZIP64');
  const localSize = files.reduce((s, f) => s + 30 + f.name.length + f.payload.length, 0);
  const centralSize = files.reduce((s, f) => s + 46 + f.name.length, 0);
  if (localSize + centralSize > 0xffffffff || files.some((f) => f.size > 0xffffffff)) throw new Error('Export too large for a ZIP without ZIP64');

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let p = 0;
  const offsets = [];
  const header = (at, central, f, offset) => {
    // common fields; central directory entries have 2 extra leading bytes (version made by)
    const o = central ? at + 2 : at;
    view.setUint16(o + 4, 20, true); // version needed (2.0: deflate)
    view.setUint16(o + 6, 0x0800, true); // UTF-8 names
    view.setUint16(o + 8, f.method, true);
    view.setUint16(o + 10, time, true);
    view.setUint16(o + 12, dosDate, true);
    view.setUint32(o + 14, f.crc, true);
    view.setUint32(o + 18, f.payload.length, true);
    view.setUint32(o + 22, f.size, true);
    view.setUint16(o + 26, f.name.length, true);
    if (central) {
      view.setUint16(at + 4, 20, true); // version made by
      view.setUint32(at + 38, 0, true); // external attrs
      view.setUint32(at + 42, offset, true);
    }
  };
  for (const f of files) {
    offsets.push(p);
    view.setUint32(p, 0x04034b50, true);
    header(p, false, f);
    out.set(f.name, p + 30);
    out.set(f.payload, p + 30 + f.name.length);
    p += 30 + f.name.length + f.payload.length;
  }
  const centralStart = p;
  files.forEach((f, i) => {
    view.setUint32(p, 0x02014b50, true);
    header(p, true, f, offsets[i]);
    out.set(f.name, p + 46);
    p += 46 + f.name.length;
  });
  view.setUint32(p, 0x06054b50, true);
  view.setUint16(p + 8, files.length, true);
  view.setUint16(p + 10, files.length, true);
  view.setUint32(p + 12, p - centralStart, true);
  view.setUint32(p + 16, centralStart, true);
  return out;
}
