import type { HlsVariant, HlsAudio } from './hls';
export type HlsReview =
  | { kind: 'master'; url: string; variants: HlsVariant[]; audio: HlsAudio[] }
  | {
      kind: 'media';
      url: string;
      transport: 'mp4' | 'mpegts';
      encrypted: boolean;
      parts: number;
      duration: number;
      origins: string[];
      audioUrl?: string;
    };
export interface MediaSource {
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
