import type { DownloadJob, JobState } from './model';
const transitions: Record<JobState, readonly JobState[]> = {
  QUEUED: ['PROBING', 'PAUSED', 'CANCELED'],
  PROBING: ['DOWNLOADING', 'PAUSING', 'FAILED', 'WAITING_FOR_NETWORK'],
  DOWNLOADING: ['RETRYING', 'PAUSING', 'ASSEMBLING', 'FAILED', 'WAITING_FOR_NETWORK'],
  PAUSING: ['PAUSED', 'FAILED', 'CANCELED'],
  PAUSED: ['QUEUED', 'CANCELED'],
  RETRYING: ['DOWNLOADING', 'PAUSING', 'FAILED', 'WAITING_FOR_NETWORK'],
  WAITING_FOR_NETWORK: ['QUEUED', 'PAUSED', 'CANCELED'],
  ASSEMBLING: ['EXPORTING', 'FAILED', 'CANCELED'],
  EXPORTING: ['COMPLETED', 'ASSEMBLING', 'FAILED'],
  COMPLETED: [],
  FAILED: ['QUEUED', 'CANCELED', 'EXPORTING'],
  CANCELED: ['QUEUED'],
};
export function canTransition(from: JobState, to: JobState) {
  return transitions[from].includes(to);
}
export function transition(job: DownloadJob, state: JobState, event?: string) {
  if (!canTransition(job.state, state))
    throw new Error(`Illegal transition ${job.state} → ${state}`);
  job.state = state;
  job.updatedAt = Date.now();
  job.timeline = [
    ...job.timeline.slice(-99),
    { at: job.updatedAt, event: event ?? state.replaceAll('_', ' ').toLowerCase() },
  ];
}
