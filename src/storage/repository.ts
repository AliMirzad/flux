import { defaultSettings, type DownloadJob, type Settings } from '../domain/model';
import type { TrafficRecord } from '../engine/speed/budget';
import type { MediaCheckpoint } from '../engine/media/types';
export class Repository {
  private db: Promise<IDBDatabase> | null = null;
  constructor() {
    void this.connection();
  }
  private connection() {
    if (this.db) return this.db;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('flux-downloads', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('jobs', { keyPath: 'id' });
        db.createObjectStore('config');
      };
      request.onsuccess = () => {
        const db = request.result;
        const forget = () => {
          if (this.db === pending) this.db = null;
        };
        db.onclose = forget;
        db.onversionchange = () => {
          db.close();
          forget();
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Storage upgrade is blocked by another extension tab.'));
    });
    this.db = pending;
    void pending.catch(() => {
      if (this.db === pending) this.db = null;
    });
    return pending;
  }
  private async transaction(store: string | string[], mode: IDBTransactionMode) {
    let db = await this.connection();
    try {
      return db.transaction(store, mode, { durability: 'strict' });
    } catch (error) {
      // Transaction creation failed before any write. Reopen once, never replay a committed write.
      if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
      db.close();
      this.db = null;
      db = await this.connection();
      return db.transaction(store, mode, { durability: 'strict' });
    }
  }
  private async run<T>(
    store: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const transaction = await this.transaction(store, mode);
    return new Promise((resolve, reject) => {
      const request = operation(transaction.objectStore(store));
      let value: T;
      request.onsuccess = () => {
        value = request.result;
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Storage transaction aborted.'));
    });
  }
  getJobs() {
    return this.run('jobs', 'readonly', (s) => s.getAll()) as Promise<DownloadJob[]>;
  }
  getJob(id: string) {
    return this.run('jobs', 'readonly', (store) => store.get(id)) as Promise<
      DownloadJob | undefined
    >;
  }
  getTraffic() {
    return this.run('config', 'readonly', (store) => store.get('traffic')) as Promise<
      TrafficRecord | undefined
    >;
  }
  putTraffic(record: TrafficRecord) {
    return this.run('config', 'readwrite', (store) =>
      store.put(structuredClone(record), 'traffic'),
    ).then(() => undefined);
  }
  getDestination() {
    return this.run('config', 'readonly', (store) => store.get('destination')) as Promise<
      FileSystemDirectoryHandle | undefined
    >;
  }
  putDestination(handle: FileSystemDirectoryHandle) {
    return this.run('config', 'readwrite', (store) => store.put(handle, 'destination')).then(
      () => undefined,
    );
  }
  putJob(job: DownloadJob) {
    return this.run('jobs', 'readwrite', (s) => s.put(structuredClone(job))).then(() => undefined);
  }
  async putJobs(jobs: DownloadJob[]) {
    const snapshots = structuredClone(jobs);
    const transaction = await this.transaction('jobs', 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const store = transaction.objectStore('jobs');
      for (const job of snapshots) store.put(job);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error('Batch commit failed.'));
    });
  }
  async deleteJob(id: string) {
    const job = await this.getJob(id);
    if (!job?.media)
      return this.run('jobs', 'readwrite', (store) => store.delete(id)).then(() => undefined);
    const transaction = await this.transaction(['jobs', 'config'], 'readwrite');
    await new Promise<void>((resolve, reject) => {
      transaction.objectStore('jobs').delete(id);
      transaction.objectStore('config').delete(this.mediaRange(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error('Media removal failed.'));
    });
  }
  private mediaRange(id: string) {
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error('Invalid media job ID.');
    return IDBKeyRange.bound(['media', id, 0], ['media', id, 32768]);
  }
  getMediaCheckpoints(id: string) {
    return this.run('config', 'readonly', (store) => store.getAll(this.mediaRange(id))) as Promise<
      MediaCheckpoint[]
    >;
  }
  clearMediaCheckpoints(id: string) {
    return this.run('config', 'readwrite', (store) => store.delete(this.mediaRange(id))).then(
      () => undefined,
    );
  }
  async putMediaCheckpoint(job: DownloadJob, record: MediaCheckpoint) {
    if (!job.media || !Number.isInteger(record.index) || record.index < 0 || record.index > 32768)
      throw new Error('Invalid media checkpoint.');
    this.mediaRange(job.id);
    const snapshot = structuredClone(job),
      checkpoint = structuredClone(record);
    const transaction = await this.transaction(['jobs', 'config'], 'readwrite');
    await new Promise<void>((resolve, reject) => {
      transaction.objectStore('jobs').put(snapshot);
      transaction.objectStore('config').put(checkpoint, ['media', job.id, record.index]);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error('Media checkpoint commit failed.'));
    });
  }
  async putQueueRun(jobs: DownloadJob[], settings: Settings) {
    const snapshots = structuredClone(jobs),
      config = structuredClone(settings);
    const transaction = await this.transaction(['jobs', 'config'], 'readwrite');
    await new Promise<void>((resolve, reject) => {
      for (const job of snapshots) transaction.objectStore('jobs').put(job);
      transaction.objectStore('config').put(config, 'settings');
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error('Queue run could not be committed.'));
    });
  }
  async getSettings(): Promise<Settings> {
    const value = await this.run('config', 'readonly', (s) => s.get('settings'));
    const settings = { ...defaultSettings, ...value };
    const previousDefaults = ['zip', 'pdf', 'mp4', 'mp3', 'exe', 'dmg', '7z', 'iso'];
    if (
      Array.isArray(value?.fileExtensions) &&
      value.fileExtensions.length === previousDefaults.length &&
      previousDefaults.every((extension) => value.fileExtensions.includes(extension))
    )
      settings.fileExtensions = [...defaultSettings.fileExtensions];
    settings.categoryFolders = { ...defaultSettings.categoryFolders, ...value?.categoryFolders };
    if (value && (value.settingsVersion ?? 1) < 2) {
      // Version 2 saves finished files into category folders automatically.
      // A folder chosen earlier with the picker stays the destination.
      settings.autoSave = true;
      settings.saveByCategory = true;
      settings.saveLocation = value.autoSave ? 'folder' : 'downloads';
      settings.settingsVersion = 2;
    }
    return settings;
  }
  putSettings(settings: Settings) {
    return this.run('config', 'readwrite', (s) => s.put(settings, 'settings')).then(
      () => undefined,
    );
  }
}
