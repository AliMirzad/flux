import { build } from 'esbuild';
import { writeFile, readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
await build({
  entryPoints: ['src/background/index.ts'],
  outfile: 'dist/background.js',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  minify: true,
});
const licenses = await Promise.all(
  [
    'react/LICENSE',
    'react-dom/LICENSE',
    'lucide-react/LICENSE',
    'hash-wasm/LICENSE',
    '@rgrove/parse-xml/LICENSE',
    'parse5/LICENSE',
    'entities/LICENSE',
  ].map(
    async (path) =>
      `${path.replace(/\/LICENSE$/, '')}\n${await readFile(`node_modules/${path}`, 'utf8')}`,
  ),
);
await writeFile('dist/THIRD_PARTY_NOTICES.txt', licenses.join('\n\n---\n\n'));
await writeFile(
  'dist/THIRD_PARTY_NOTICES.txt',
  '\n\n---\n\nmux.js 6.3.0 (Flux parser guards; see scripts/vendor-media.mjs)\n' +
    (await readFile('src/engine/media/vendor/mux-LICENSE.txt', 'utf8')),
  { flag: 'a' },
);
await build({
  entryPoints: ['src/content/index.ts'],
  outfile: 'dist/content.js',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const kind = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length);
  kind.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([kind, data])), 8 + data.length);
  return out;
}
// The flux bolt (same shape as the in-app brand mark) in a 24-unit box.
const bolt = [
  [4, 14],
  [13.6, 2.2],
  [11.8, 10],
  [20, 10],
  [10.4, 21.8],
  [12.2, 14],
];
function insideBolt(x, y) {
  let inside = false;
  for (let i = 0, j = bolt.length - 1; i < bolt.length; j = i++) {
    const [xi, yi] = bolt[i];
    const [xj, yj] = bolt[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function insideTile(px, py) {
  const radius = 0.22;
  const dx = Math.max(radius - px, px - (1 - radius), 0);
  const dy = Math.max(radius - py, py - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}
const tile = [16, 21, 31];
const accent = [82, 217, 191];
for (const size of [16, 48, 128]) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const samples = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let coverage = 0;
      let boltCoverage = 0;
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++) {
          const px = (x + (sx + 0.5) / samples) / size;
          const py = (y + (sy + 0.5) / samples) / size;
          if (!insideTile(px, py)) continue;
          coverage++;
          // Bolt fills ~70% of the tile, centered.
          if (insideBolt(((px - 0.5) / 0.7) * 24 + 12, ((py - 0.5) / 0.7) * 24 + 12))
            boltCoverage++;
        }
      const mix = coverage ? boltCoverage / coverage : 0;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++)
        rows[offset + c] = Math.round(tile[c] + (accent[c] - tile[c]) * mix);
      rows[offset + 3] = Math.round((coverage / (samples * samples)) * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  await writeFile(
    `dist/icon${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
