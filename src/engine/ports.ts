import type { DownloadJob, Settings } from '../domain/model';
import type { RedirectPolicy } from './network/policy';
import type { MediaCheckpoint } from './media/types';
export interface ByteStore {
  open(id: string): Promise<void>;
  write(offset: number, data: Uint8Array): Promise<void>;
  read(offset: number, length: number): Promise<Uint8Array>;
  size(): Promise<number>;
  truncate(size: number): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
export interface EngineOptions {
  job: DownloadJob;
  settings: Settings;
  store: ByteStore;
  signal: AbortSignal;
  checkpoint(job: DownloadJob): Promise<void>;
  progress(job: DownloadJob): void;
  fetcher?: typeof fetch;
  allowLocalForTests?: boolean;
  acquireHost?: (host: string, signal: AbortSignal) => Promise<() => void>;
  globalThrottle?: (bytes: number, signal: AbortSignal) => Promise<void>;
  checkAllowance?: (signal: AbortSignal) => Promise<void>;
  reservePayload?: (bytes: number, signal: AbortSignal) => Promise<void>;
  accountPayload?: (bytes: number, signal: AbortSignal) => Promise<void>;
  redirectPolicy?: RedirectPolicy;
  mediaCheckpoints?: {
    load(): Promise<MediaCheckpoint[]>;
    save(job: DownloadJob, record: MediaCheckpoint): Promise<void>;
    clear(): Promise<void>;
  };
}
