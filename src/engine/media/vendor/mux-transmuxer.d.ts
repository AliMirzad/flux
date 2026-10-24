export interface MuxOutput {
  type: 'combined' | 'audio' | 'video';
  initSegment: Uint8Array;
  data: Uint8Array;
}
export interface VideoConfig {
  sps: Uint8Array[];
  pps: Uint8Array[];
  sarRatio?: [number, number];
  width: number;
  height: number;
  profileIdc: number;
  profileCompatibility: number;
  levelIdc: number;
}
export class Transmuxer {
  constructor(options: {
    keepOriginalTimestamps: boolean;
    remux: boolean;
    fluxVideoConfig?: VideoConfig;
    fluxContinuousVideo?: boolean;
  });
  on(event: 'data', listener: (output: MuxOutput) => void): void;
  push(bytes: Uint8Array): void;
  flush(): void;
}
export class AdtsStream {
  constructor();
  push(packet: { type: 'audio'; data: Uint8Array; pts: number; dts: number }): void;
}
