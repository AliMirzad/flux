import type { DownloadJob, Settings } from '../domain/model';
import type { HlsReview } from '../engine/media/types';
export type WorkerCommand =
  | { type: 'inspect-hls'; requestId: string; url: string }
  | { type: 'cancel-hls-review'; requestId: string }
  | { type: 'start'; job: DownloadJob; settings: Settings }
  | { type: 'pause'; id: string }
  | { type: 'settings'; settings: Settings }
  | {
      type: 'redirect-result';
      requestId: string;
      url?: string;
      error?: string;
      permissionOrigin?: string;
    };
export type WorkerEvent =
  | {
      type: 'hls-review';
      requestId: string;
      review?: HlsReview;
      error?: string;
      permissionOrigin?: string;
    }
  | { type: 'traffic'; used: number; limit: number; resetsAt: number }
  | { type: 'progress' | 'done' | 'paused' | 'failed'; job: DownloadJob }
  | {
      type: 'redirect';
      requestId: string;
      from: string;
      location: string | null;
    }
  | {
      type: 'prepare-request';
      requestId: string;
      from: string;
      location: string | null;
    };
