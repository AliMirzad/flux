import type { DownloadJob, Settings } from '../domain/model';
import type { RedirectPolicy } from './network/policy';
import type { MediaCheckpoint } from './media/types';
import type { TransportPort } from './media/transmux';
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
  finishRecording?: () => boolean;
  fetcher?: typeof fetch;
  allowLocalForTests?: boolean;
  acquireHost?: (host: string, signal: AbortSignal) => Promise<() => void>;
  globalThrottle?: (bytes: number, signal: AbortSignal) => Promise<void>;
  checkAllowance?: (signal: AbortSignal) => Promise<void>;
  reservePayload?: (bytes: number, signal: AbortSignal) => Promise<void>;
  accountPayload?: (bytes: number, signal: AbortSignal) => Promise<void>;
  redirectPolicy?: RedirectPolicy;
  transportFactory?: (
    signal: AbortSignal,
    initialization?: Uint8Array,
    discontinuity?: boolean,
  ) => TransportPort;
  mediaCheckpoints?: {
    load(): Promise<MediaCheckpoint[]>;
    save(job: DownloadJob, record: MediaCheckpoint): Promise<void>;
    clear(): Promise<void>;
  };
}
