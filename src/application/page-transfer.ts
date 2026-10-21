/** Chrome JSON messaging copies each chunk; keep these buffers independent of total file size. */
export const PAGE_CHUNK_BYTES = 256 * 1024;
export const PAGE_FILE_LIMIT = 1024 ** 3;
export const PAGE_TRANSFER_TTL = 3600000;
export const PAGE_TRANSFER_SLOTS = 8;
export const pageTransferKey = (token: string) => `blobTransfer:${token}`;
export interface PageTransferGrant {
  source: string;
  tabId: number;
  frameId: number;
  documentId: string;
  size: number;
  at: number;
}
export interface PageTransferMessage {
  type: string;
  token?: unknown;
  index?: unknown;
  data?: unknown;
  size?: unknown;
  filename?: unknown;
}
interface Sink {
  id: string;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
interface Upload {
  sink: Sink;
  grant: PageTransferGrant;
  next: number;
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
}
export function validPageGrant(grant: PageTransferGrant, sender: chrome.runtime.MessageSender) {
  return (
    Number.isSafeInteger(grant.size) &&
    grant.size >= 0 &&
    grant.size <= PAGE_FILE_LIMIT &&
    Number.isFinite(grant.at) &&
    Date.now() >= grant.at &&
    Date.now() - grant.at < PAGE_TRANSFER_TTL &&
    sender.tab?.id === grant.tabId &&
    sender.frameId === grant.frameId &&
    !!sender.documentId &&
    sender.documentId === grant.documentId &&
    !!sender.url &&
    sender.url.split('#')[0] === grant.source
  );
}
/** Single-use, sender-authorized, bounded and backpressured page-file receiver. */
export class PageTransfers {
  private uploads = new Map<string, Upload>();
  private busy = new Set<string>();
  private cleaning = false;
  constructor(
    private ports: {
      authorize(token: string, sender: chrome.runtime.MessageSender): Promise<PageTransferGrant>;
      consume(token: string): Promise<void>;
      open(): Promise<Sink>;
      remove(id: string): Promise<void>;
      finish(id: string, grant: PageTransferGrant, filename?: string): Promise<string>;
    },
  ) {}
  get pendingIds() {
    return [...this.uploads.values()].map((upload) => upload.sink.id);
  }
  get receiving() {
    return this.busy.size > 0 || this.uploads.size > 0;
  }
  async whenIdle<T>(operation: () => Promise<T>) {
    if (this.receiving || this.cleaning)
      throw new Error('Wait for the page file to finish before cleaning temporary data.');
    this.cleaning = true;
    try {
      return await operation();
    } finally {
      this.cleaning = false;
    }
  }
  private arm(token: string, upload: Upload) {
    if (upload.timer) clearTimeout(upload.timer);
    upload.timer = setTimeout(() => {
      if (this.busy.has(token)) this.arm(token, upload);
      else void this.drop(token).catch(() => undefined);
    }, 120000);
  }
  private async drop(token: string) {
    const upload = this.uploads.get(token);
    this.uploads.delete(token);
    if (upload?.timer) clearTimeout(upload.timer);
    try {
      await this.ports.consume(token);
    } finally {
      if (upload)
        try {
          await upload.sink.abort();
        } finally {
          await this.ports.remove(upload.sink.id);
        }
    }
  }
  async receive(message: PageTransferMessage, sender: chrome.runtime.MessageSender) {
    const token = message.token;
    if (typeof token !== 'string' || !/^[a-f\d-]{36}$/i.test(token))
      throw new Error('Invalid transfer token.');
    // Unauthorized messages must never abort another document's upload.
    const grant = await this.ports.authorize(token, sender);
    if (this.cleaning) throw new Error('Temporary data cleanup is in progress.');
    if (this.busy.has(token)) throw new Error('Wait for the previous transfer acknowledgement.');
    if (
      !this.uploads.has(token) &&
      new Set([...this.uploads.keys(), ...this.busy]).size >= PAGE_TRANSFER_SLOTS
    )
      throw new Error('Too many page files are being received.');
    this.busy.add(token);
    try {
      if (message.type === 'blob-abort') {
        await this.drop(token);
        return { ok: true };
      }
      let upload = this.uploads.get(token);
      if (upload && JSON.stringify(upload.grant) !== JSON.stringify(grant))
        throw new Error('The transfer authorization changed.');
      let bytes: Uint8Array | undefined;
      if (message.type === 'blob-chunk') {
        if (
          message.index !== (upload?.next ?? 0) ||
          typeof message.data !== 'string' ||
          !message.data.length ||
          message.data.length % 4 !== 0 ||
          message.data.length > Math.ceil(PAGE_CHUNK_BYTES / 3) * 4 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)
        )
          throw new Error('Invalid or out-of-order page data chunk.');
        const binary = atob(message.data);
        if (
          !binary.length ||
          binary.length > PAGE_CHUNK_BYTES ||
          (upload?.bytes ?? 0) + binary.length > grant.size
        )
          throw new Error('The page file exceeded its authorized size.');
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      } else if (
        message.type !== 'blob-done' ||
        message.size !== grant.size ||
        (upload?.bytes ?? 0) !== grant.size ||
        (message.filename !== undefined &&
          (typeof message.filename !== 'string' || message.filename.length > 1024))
      )
        throw new Error('The completed page file does not match its authorized size.');
      if (!upload) {
        upload = { sink: await this.ports.open(), grant, next: 0, bytes: 0, timer: null };
        this.uploads.set(token, upload);
      }
      this.arm(token, upload);
      if (bytes) {
        await upload.sink.write(bytes);
        upload.bytes += bytes.byteLength;
        upload.next++;
        return { ok: true };
      }
      await upload.sink.close();
      // Consume before publishing: a replay cannot create a second file.
      await this.ports.consume(token);
      const id = await this.ports.finish(
        upload.sink.id,
        grant,
        message.filename as string | undefined,
      );
      if (upload.timer) clearTimeout(upload.timer);
      this.uploads.delete(token);
      return { ok: true, id };
    } catch (error) {
      await this.drop(token).catch(() => undefined);
      throw error;
    } finally {
      this.busy.delete(token);
    }
  }
}
