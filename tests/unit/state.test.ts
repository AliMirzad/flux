import { describe, expect, it } from 'vitest';
import { states, type DownloadJob } from '../../src/domain/model';
import { canTransition, transition } from '../../src/domain/state';

describe('persistent state machine', () => {
  it('supports download, pause, resume and export workflow', () => {
    const workflow = [
      'QUEUED',
      'PROBING',
      'DOWNLOADING',
      'PAUSING',
      'PAUSED',
      'QUEUED',
      'PROBING',
      'DOWNLOADING',
      'ASSEMBLING',
      'EXPORTING',
      'COMPLETED',
    ] as const;
    const job = { state: workflow[0], updatedAt: 0, timeline: [] } as unknown as DownloadJob;
    for (const state of workflow.slice(1)) transition(job, state);
    expect(job.state).toBe('COMPLETED');
    expect(job.timeline).toHaveLength(workflow.length - 1);
    expect(job.updatedAt).toBeGreaterThan(0);
  });
  it('refuses completion without assembly and export', () => {
    expect(canTransition('DOWNLOADING', 'COMPLETED')).toBe(false);
    expect(canTransition('QUEUED', 'COMPLETED')).toBe(false);
    for (const state of states) expect(canTransition('COMPLETED', state)).toBe(false);
    const job = { state: 'PAUSED', timeline: [] } as unknown as DownloadJob;
    expect(() => transition(job, 'DOWNLOADING')).toThrow('Illegal transition');
    expect(job.state).toBe('PAUSED');
  });
  it('bounds persisted event history', () => {
    const job = {
      state: 'PAUSED',
      timeline: Array.from({ length: 150 }, () => ({ at: 0, event: 'old' })),
    } as unknown as DownloadJob;
    transition(job, 'QUEUED', 'Resumed by user');
    expect(job.timeline).toHaveLength(100);
    expect(job.timeline.at(-1)?.event).toBe('Resumed by user');
  });
});
