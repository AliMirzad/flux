import type { HlsVariant, HlsAudio } from './hls';
import type { DashReview } from './dash';
export type MediaReview = HlsReview | DashReview;
export type HlsReview =
  | { kind: 'master'; url: string; variants: HlsVariant[]; audio: HlsAudio[] }
  | {
      kind: 'media';
      url: string;
      transport: 'mp4' | 'mpegts';
      encrypted: boolean;
      parts: number;
      duration: number;
      live?: boolean;
      origins: string[];
      audioUrl?: string;
    };
export interface MediaSource {
  initializationSource?: MediaSource;
  initializationBytes?: number;
  url: string;
  finalUrl: string;
  etag: string | null;
  fullSize: number | null;
  bytes: number;
  sourceHash: string;
  keyHash?: string;
}
export interface MediaCheckpoint extends MediaSource {
  index: number;
  outputBytes?: number;
  companion?: MediaSource;
}
