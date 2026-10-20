import type { HlsVariant } from './hls';
export type HlsReview =
  | { kind: 'master'; url: string; variants: HlsVariant[] }
  | { kind: 'media'; url: string; parts: number; duration: number; origins: string[] };
export interface MediaCheckpoint {
  index: number;
  url: string;
  finalUrl: string;
  etag: string | null;
  fullSize: number | null;
  bytes: number;
  sourceHash: string;
}
