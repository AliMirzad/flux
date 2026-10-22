import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Deterministic ZIP32 packaging for releases and the local companion installer.
export async function createZip(files) {
  if (files.length > 65535) throw new Error('Too many ZIP32 entries.');
  const local = [],
    central = [];
  let offset = 0;
  const names = new Set();
  for (const file of files) {
    if (
      !file.name ||
      file.name.startsWith('/') ||
      file.name.includes('\\') ||
      file.name.split('/').some((part) => part === '..' || part === '.') ||
      names.has(file.name)
    )
      throw new Error('Unsafe or duplicate ZIP entry.');
    names.add(file.name);
    const name = Buffer.from(file.name, 'utf8');
    const data = file.data === undefined ? await readFile(file.path) : Buffer.from(file.data);
    const compressed = deflateRawSync(data, { level: 9 });
    if (
      name.length > 65535 ||
      data.length > 0xffffffff ||
      compressed.length > 0xffffffff ||
      offset > 0xffffffff
    )
      throw new Error('Archive exceeds ZIP32 limits.');
    const crc = crc32(data);
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
    record.writeUInt16LE(0x314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  if (offset + directory.length > 0xffffffff) throw new Error('Archive exceeds ZIP32 limits.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
