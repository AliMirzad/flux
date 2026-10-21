export const states = [
  'QUEUED',
  'PROBING',
  'DOWNLOADING',
  'PAUSING',
  'PAUSED',
  'RETRYING',
  'WAITING_FOR_NETWORK',
  'ASSEMBLING',
  'EXPORTING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
] as const;
export type JobState = (typeof states)[number];
export type Category =
  'Documents' | 'Archives' | 'Videos' | 'Audio' | 'Images' | 'Software' | 'Other';
export interface Resource {
  finalUrl: string;
  size: number | null;
  ranges: boolean;
  etag: string | null;
  modified: string | null;
  mime: string;
  filename: string;
  reason?: string;
}
export interface Segment {
  start: number;
  end: number;
  hash: string;
}
export interface Timeline {
  at: number;
  event: string;
}
export interface DownloadJob {
  id: string;
  /** A received page file has no replayable network URL. */
  pageFile?: boolean;
  useBrowserCookies?: boolean;
  engine?: 'flux' | 'browser';
  browser?: {
    id: number;
    canResume: boolean;
    danger: string;
    sourceKind: 'http' | 'blob' | 'data';
    startedAt: string;
    referrer?: string;
    missing?: boolean;
    erased?: boolean;
  };
  media?: {
    kind: 'hls';
    transport?: 'mp4' | 'mpegts';
    initializationBytes?: number;
    initializationHash?: string;
    planHash?: string;
    playlistUrl?: string;
    audioUrl?: string;
    audioLabel?: string;
    sourceTrackIds?: { video: number; audio: number };
    trackStarts?: Record<string, number>;
    duration?: number;
    parts?: number;
    completed?: number;
    originSeconds?: number;
    trackEnds?: Record<string, number>;
  };
  queueId?: string;
  url: string;
  filename: string;
  category: Category;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  priority: number;
  order: number;
  scheduledAt: number | null;
  speedLimit: number;
  maxConnections: number;
  mode: 'auto' | 'manual';
  resource: Resource | null;
  segments: Segment[];
  downloaded: number;
  total: number | null;
  speed: number;
  averageSpeed: number;
  connections: number;
  connectionSpeeds: number[];
  retries: number;
  error: string | null;
  note: string | null;
  sha256: string | null;
  expectedHash: string | null;
  timeline: Timeline[];
  exported: boolean;
  exportedAt: number | null;
  /** Chrome download id of the automatic save into the Downloads folder. */
  savedDownloadId?: number | null;
  activeMs: number;
  permissionOrigin?: string | null;
  capturePending?: boolean;
  budgetResumeAt?: number | null;
  queueRetries?: number;
  queueRetryAt?: number | null;
  retryFailure?: { at: number; notBefore: number } | null;
}
export interface DownloadQueue {
  id: string;
  name: string;
  maxActive: number;
  paused: boolean;
  /** Started manually: runs now regardless of the schedule, cleared when the queue finishes. */
  manualRun?: boolean;
  windowStart: string;
  windowEnd: string;
  speedLimit: number;
  days?: number[];
  startsAt?: number | null;
  stopsAt?: number | null;
  notifyOnComplete?: boolean;
  stopOnComplete?: boolean;
  repeatMinutes?: number;
  nextRunAt?: number | null;
  retryAttempts?: number;
  retryDelaySeconds?: number;
}
export interface Settings {
  queues: DownloadQueue[];
  /** Ask in the toolbar popup which queue a captured download joins (when named queues exist). */
  askQueue: boolean;
  /** Show the Add Download dialog in the toolbar popup before a captured download starts. */
  confirmCapture: boolean;
  autoSave: boolean;
  saveByCategory: boolean;
  /** downloads = Chrome's Downloads folder (no picker needed); folder = a folder chosen with the picker. */
  saveLocation: 'downloads' | 'folder';
  /** Optional relative folder inside Chrome's Downloads folder, e.g. "Flux". */
  downloadsSubfolder: string;
  categoryFolders: Record<Category, string>;
  settingsVersion?: number;
  /** Set when the browser showed its own save dialog for a Flux save ("ask where to save" is on). */
  saveDialogDetected?: boolean;
  completionSound: boolean;
  trafficLimit: number;
  trafficPeriodHours: number;
  retryAttempts: number;
  retryDelaySeconds: number;
  maxActive: number;
  perHost: number;
  maxConnections: number;
  mode: 'auto' | 'manual';
  globalLimit: number;
  theme: 'dark' | 'light' | 'system';
  notifications: boolean;
  interception: boolean;
  excludedHosts: string[];
  fileExtensions: string[];
  retentionDays: number;
  recovery: 'ask' | 'auto';
  windowStart: string;
  windowEnd: string;
  categories: boolean;
}
export const defaultSettings: Settings = {
  queues: [],
  askQueue: true,
  confirmCapture: true,
  autoSave: true,
  saveByCategory: true,
  saveLocation: 'downloads',
  downloadsSubfolder: '',
  categoryFolders: {
    Documents: 'Documents',
    Archives: 'Compressed',
    Videos: 'Video',
    Audio: 'Music',
    Images: 'Images',
    Software: 'Programs',
    Other: 'General',
  },
  settingsVersion: 2,
  completionSound: false,
  trafficLimit: 0,
  trafficPeriodHours: 24,
  retryAttempts: 0,
  retryDelaySeconds: 60,
  maxActive: 2,
  perHost: 8,
  maxConnections: 8,
  mode: 'auto',
  globalLimit: 0,
  theme: 'light',
  notifications: false,
  interception: false,
  excludedHosts: [],
  fileExtensions: [
    'zip',
    'rar',
    '7z',
    'tar',
    'gz',
    'bz2',
    'xz',
    'iso',
    'bin',
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'epub',
    'csv',
    'mp4',
    'mkv',
    'webm',
    'mov',
    'avi',
    'mp3',
    'wav',
    'flac',
    'aac',
    'ogg',
    'exe',
    'msi',
    'dmg',
    'pkg',
    'deb',
    'rpm',
    'apk',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
    'avif',
  ],
  retentionDays: 90,
  recovery: 'ask',
  windowStart: '',
  windowEnd: '',
  categories: true,
};
export interface NewDownload {
  url: string;
  useBrowserCookies?: boolean;
  media?: 'hls';
  audioUrl?: string;
  audioLabel?: string;
  queueId?: string;
  startPaused?: boolean;
  filename?: string;
  priority?: number;
  scheduledAt?: number | null;
  speedLimit?: number;
  expectedHash?: string;
  /** Overrides the category guessed from the file name. */
  category?: Category;
  /** Per-download connection count (1, 2, 4, 8 or 16) and strategy. */
  maxConnections?: number;
  mode?: 'auto' | 'manual';
}
export interface Snapshot {
  traffic?: { used: number; limit: number; resetsAt: number };
  destination?: { name: string; authorized: boolean };
  jobs: DownloadJob[];
  settings: Settings;
  ready: boolean;
  error: string | null;
  storage?: { usage: number; quota: number };
}
export const runningStates = new Set<JobState>([
  'PROBING',
  'DOWNLOADING',
  'PAUSING',
  'RETRYING',
  'ASSEMBLING',
  'EXPORTING',
]);
