import type { NewDownload, Settings, DownloadJob, Snapshot, DownloadQueue } from '../domain/model';
import type { HlsReview } from '../engine/media/types';
export type Action =
  | 'pause'
  | 'resume'
  | 'retry'
  | 'cancel'
  | 'remove'
  | 'start'
  | 'up'
  | 'down'
  | 'redownload'
  | 'show'
  | 'review-browser';
export interface ManagerAPI {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;
  add(input: NewDownload): Promise<void>;
  inspectHls(url: string, signal?: AbortSignal): Promise<HlsReview>;
  addBatch(inputs: NewDownload[]): Promise<{ added: number; skipped: number }>;
  replaceSource(id: string, url: string): Promise<void>;
  saveQueue(queue: DownloadQueue): Promise<void>;
  removeQueue(id: string): Promise<void>;
  discoverLinks(): Promise<{ url: string; filename: string }[]>;
  action(id: string, action: Action): Promise<void>;
  pauseAll(): Promise<void>;
  resumeAll(): Promise<void>;
  updateSettings(settings: Settings): Promise<void>;
  enableAutomaticCapture(): Promise<void>;
  updateJob(
    id: string,
    patch: Partial<
      Pick<
        DownloadJob,
        | 'filename'
        | 'priority'
        | 'scheduledAt'
        | 'speedLimit'
        | 'maxConnections'
        | 'mode'
        | 'queueId'
      >
    >,
  ): Promise<void>;
  exportFile(id: string): Promise<void>;
  chooseDownloadFolder(): Promise<void>;
  previewCompletionSound(): Promise<void>;
  browserDownload(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  cleanup(): Promise<void>;
  requestPersistence(): Promise<boolean>;
  detectMedia(): Promise<{ url: string; filename: string }[]>;
}
