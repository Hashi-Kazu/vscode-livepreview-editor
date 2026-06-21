// Generates media/icon.png (128x128) — a simple, dependency-free PNG icon so the
// extension is Marketplace-ready. Run: node generate-icon.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 128;

function px(buf, x, y, [r, g, b, a]) {
  const i = (y * S + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

function build() {
  const img = Buffer.alloc(S * S * 4, 0);
  const radius = 24;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), S - 1 - radius);
    const cy = Math.min(Math.max(y, radius), S - 1 - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius || (x >= radius && x <= S - 1 - radius) || (y >= radius && y <= S - 1 - radius);
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRounded(x, y)) continue;
      // Vertical gradient background (indigo → blue).
      const t = y / S;
      const r = Math.round(60 + t * 31);
      const g = Math.round(110 + t * 31);
      const b = Math.round(220 + t * 19);
      px(img, x, y, [r, g, b, 255]);
    }
  }

  // White "document" card.
  const dx0 = 34;
  const dx1 = 94;
  const dy0 = 28;
  const dy1 = 100;
  for (let y = dy0; y < dy1; y++) {
    for (let x = dx0; x < dx1; x++) px(img, x, y, [248, 250, 252, 255]);
  }

  // Text lines on the card (the first line styled as a heading bar).
  const lines = [
    { y: 40, x0: 42, x1: 86, color: [60, 110, 220, 255], h: 6 }, // heading
    { y: 54, x0: 42, x1: 82, color: [120, 130, 150, 255], h: 4 },
    { y: 64, x0: 42, x1: 86, color: [120, 130, 150, 255], h: 4 },
    { y: 74, x0: 42, x1: 70, color: [120, 130, 150, 255], h: 4 },
    { y: 86, x0: 42, x1: 80, color: [120, 130, 150, 255], h: 4 },
  ];
  for (const ln of lines) {
    for (let y = ln.y; y < ln.y + ln.h; y++) {
      for (let x = ln.x0; x < ln.x1; x++) px(img, x, y, ln.color);
    }
  }

  // Encode PNG.
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0; // filter: none
    img.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  const idat = zlib.deflateSync(raw);

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const out = path.join(__dirname, 'media', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log('wrote', out, png.length, 'bytes');
}

// CRC32 (PNG spec).
const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

build();
