import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBDatabase as FakeDatabase } from 'fake-indexeddb';
import { Repository } from '../../src/storage/repository';
import { createJob } from '../../src/application/jobs';
import { defaultSettings } from '../../src/domain/model';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

describe('durable metadata repository', () => {
  it('reopens a closed database before retrying transaction creation without replaying writes', async () => {
    const repository = new Repository();
    await repository.getSettings();
    const transaction = vi
      .spyOn(FakeDatabase.prototype, 'transaction')
      .mockImplementationOnce(function (this: IDBDatabase) {
        this.close();
        throw new DOMException('The database connection is closing.', 'InvalidStateError');
      });
    const job = createJob({ url: 'https://example.org/recovered' });
    await repository.putJob(job);
    transaction.mockRestore();
    expect(await repository.getJobs()).toEqual([job]);
    await repository.putJobs([createJob({ url: 'https://example.org/batch' })]);
    expect(await repository.getJobs()).toHaveLength(2);
  });
  it('commits an independent snapshot and restores it through a new repository instance', async () => {
    const first = new Repository();
    const job = createJob({ url: 'https://example.org/file' });
    job.state = 'PAUSED';
    job.resource = {
      finalUrl: job.url,
      size: 100,
      ranges: true,
      etag: '"stable"',
      modified: null,
      filename: job.filename,
      mime: 'application/octet-stream',
    };
    job.segments = [{ start: 0, end: 49, hash: 'a'.repeat(64) }];
    job.downloaded = 50;
    await first.putJob(job);
    job.segments[0]!.end = 99;
    job.downloaded = 100;
    const second = new Repository();
    const restored = (await second.getJobs())[0]!;
    expect(restored.state).toBe('PAUSED');
    expect(restored.downloaded).toBe(50);
    expect(restored.segments[0]?.end).toBe(49);
    expect(restored.resource?.etag).toBe('"stable"');
    await second.deleteJob(restored.id);
    expect(await first.getJobs()).toEqual([]);
  });
  it('restores user settings and provides defaults on first launch', async () => {
    const first = new Repository();
    expect(await first.getSettings()).toEqual(defaultSettings);
    await first.putSettings({
      ...defaultSettings,
      maxConnections: 4,
      globalLimit: 1024,
      interception: true,
    });
    const settings = await new Repository().getSettings();
    expect(settings.maxConnections).toBe(4);
    expect(settings.globalLimit).toBe(1024);
    expect(settings.interception).toBe(true);
  });
});
