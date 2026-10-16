// Generates the extension icons (rounded violet square + 4-point sparkle) as PNGs, no dependencies.
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Signed-distance-ish coverage with 4x4 supersampling. */
function pixel(size, x, y) {
  const S = 4;
  let bg = 0,
    star = 0;
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size,
        v = (y + (sy + 0.5) / S) / size;
      const r = 0.22,
        dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0),
        dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
      if (dx * dx + dy * dy <= r * r) bg++;
      // 4-point sparkle: |x|^p + |y|^p <= R^p with p < 1 gives concave arms.
      const px = Math.abs(u - 0.5) / 0.34,
        py = Math.abs(v - 0.5) / 0.34,
        p = 0.55;
      if (px ** p + py ** p <= 1) star++;
    }
  }
  const a = bg / (S * S),
    s = star / (S * S);
  const t = y / size; // vertical gradient violet → indigo
  const base = [Math.round(139 - 40 * t), Math.round(92 - 30 * t), Math.round(246 - 10 * t)];
  const rgb = base.map((c) => Math.round(c * (1 - s) + 255 * s));
  return [...rgb, Math.round(255 * a)];
}

export function iconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(size, x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
