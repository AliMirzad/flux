import type { ByteStore } from '../engine/ports';
interface SyncHandle {
  write(data: Uint8Array, options: { at: number }): number;
  read(data: Uint8Array, options: { at: number }): number;
  getSize(): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
export class OPFSStore implements ByteStore {
  private handle: SyncHandle | null = null;
  async open(id: string) {
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error('Invalid partial file ID.');
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('partials', { create: true });
    const file = await directory.getFileHandle(id, { create: true });
    this.handle = await (
      file as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> }
    ).createSyncAccessHandle();
  }
  private get access() {
    if (!this.handle) throw new Error('Partial storage is not open.');
    return this.handle;
  }
  async write(offset: number, data: Uint8Array) {
    let written = 0;
    while (written < data.length) {
      const n = this.access.write(data.subarray(written), { at: offset + written });
      if (n <= 0) throw new Error('Disk write made no progress. Free storage and resume.');
      written += n;
    }
  }
  async read(offset: number, length: number) {
    const data = new Uint8Array(length);
    const count = this.access.read(data, { at: offset });
    return data.subarray(0, count);
  }
  async size() {
    return this.access.getSize();
  }
  async truncate(size: number) {
    this.access.truncate(size);
  }
  async flush() {
    this.access.flush();
  }
  async close() {
    this.handle?.close();
    this.handle = null;
  }
}
export async function partialFile(id: string) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('partials');
  return (await dir.getFileHandle(id)).getFile();
}
export async function removePartial(id: string) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('partials');
    await dir.removeEntry(id);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}
export async function cleanupOrphans(ids: Set<string>) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('partials', { create: true });
  const entries = (
    dir as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }
  ).keys();
  for await (const id of entries) if (!ids.has(id)) await dir.removeEntry(id);
}
