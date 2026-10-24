import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBDatabase as FakeDatabase, IDBKeyRange } from 'fake-indexeddb';
import { Repository } from '../../src/storage/repository';
import { createJob } from '../../src/application/jobs';
import { defaultSettings } from '../../src/domain/model';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

describe('durable metadata repository', () => {
  it('commits logical media checkpoints with their jobs and removes only the selected job metadata', async () => {
    const repository = new Repository();
    const first = createJob({ url: 'https://example.org/first.m3u8', media: 'hls' });
    const second = createJob({ url: 'https://example.org/second.m3u8', media: 'hls' });
    const record = {
      index: 0,
      url: 'https://example.org/init.mp4',
      finalUrl: 'https://example.org/init.mp4',
      etag: '"stable"',
      fullSize: 10,
      bytes: 10,
      sourceHash: 'a'.repeat(64),
    };
    first.segments = [{ start: 0, end: 9, hash: record.sourceHash }];
    first.downloaded = 10;
    await repository.putMediaCheckpoint(first, record);
    await repository.putMediaCheckpoint(second, record);
    const reopened = new Repository();
    expect((await reopened.getJob(first.id))?.downloaded).toBe(10);
    expect(await reopened.getMediaCheckpoints(first.id)).toEqual([record]);
    await reopened.deleteJob(first.id);
    expect(await repository.getJob(first.id)).toBeUndefined();
    expect(await repository.getMediaCheckpoints(first.id)).toEqual([]);
    expect(await repository.getMediaCheckpoints(second.id)).toEqual([record]);
    await repository.clearMediaCheckpoints(second.id);
    expect(await repository.getMediaCheckpoints(second.id)).toEqual([]);
    expect(await repository.getJob(second.id)).toBeDefined();
  });
  it('does not partially commit batches or media progress when later data cannot be cloned', async () => {
    const repository = new Repository();
    const job = createJob({ url: 'https://example.org/one.m3u8', media: 'hls' });
    const invalid = { ...job, note: (() => {}) as unknown as string };
    await expect(repository.putJobs([job, invalid])).rejects.toMatchObject({
      name: 'DataCloneError',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await repository.getJobs()).toEqual([]);
    await repository.putJob(job);
    const record = {
      index: 0,
      url: 'https://example.org/init.mp4',
      finalUrl: 'https://example.org/init.mp4',
      etag: null,
      fullSize: 10,
      bytes: 10,
      sourceHash: (() => {}) as unknown as string,
    };
    await expect(
      repository.putMediaCheckpoint({ ...job, downloaded: 10 }, record),
    ).rejects.toMatchObject({ name: 'DataCloneError' });
    expect((await repository.getJob(job.id))?.downloaded).toBe(0);
    expect(await repository.getMediaCheckpoints(job.id)).toEqual([]);
  });
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
