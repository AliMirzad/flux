import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

// Small, deterministic ZIP32 package writer; download data never uses this code.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function filesIn(directory, prefix = '') {
  const entries = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) entries.push(...(await filesIn(path, name + '/')));
    else if (entry.isFile()) entries.push({ name, path });
    else throw new Error('Release may only contain regular files.');
  }
  return entries;
}
const files = await filesIn('dist');
const local = [];
const central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(file.name, 'utf8');
  const data = await readFile(file.path);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  if (data.length > 0xffffffff || offset > 0xffffffff)
    throw new Error('Release exceeds ZIP32 limits.');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8);
  record.writeUInt16LE(8, 10);
  record.writeUInt16LE(33, 14);
  record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(compressed.length, 20);
  record.writeUInt32LE(data.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE(offset, 42);
  central.push(record, name);
  offset += header.length + name.length + compressed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...local, directory, end]);
await mkdir('releases', { recursive: true });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const zip = resolve(`releases/flux-${pkg.version}.zip`);
await writeFile(zip, archive);
const digest = createHash('sha256').update(archive).digest('hex');
await writeFile(`${zip}.sha256`, `${digest}  flux-${pkg.version}.zip\n`);
console.log(`Created ${zip}\n${files.length} files, ${archive.length} bytes\nSHA-256 ${digest}`);
