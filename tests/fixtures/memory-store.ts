import type { ByteStore } from '../../src/engine/ports';

/** Deliberately small test double; browser production uses OPFS streaming. */
export class MemoryStore implements ByteStore {
  data = new Uint8Array(0);
  maxWrite = 0;
  flushes = 0;
  constructor(private quota = 32 * 1024 * 1024) {}
  async open(_id: string) {}
  async write(offset: number, data: Uint8Array) {
    const end = offset + data.length;
    if (end > this.quota) throw new DOMException('Test quota exceeded.', 'QuotaExceededError');
    this.maxWrite = Math.max(this.maxWrite, data.length);
    if (end > this.data.length) {
      const next = new Uint8Array(end);
      next.set(this.data);
      this.data = next;
    }
    this.data.set(data, offset);
  }
  async read(offset: number, length: number) {
    return this.data.slice(offset, offset + length);
  }
  async size() {
    return this.data.length;
  }
  async truncate(size: number) {
    if (size > this.quota) throw new DOMException('Test quota exceeded.', 'QuotaExceededError');
    const next = new Uint8Array(size);
    next.set(this.data.subarray(0, size));
    this.data = next;
  }
  async flush() {
    this.flushes++;
  }
  async close() {}
}
