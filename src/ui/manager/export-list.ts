import type { DownloadJob } from '../../domain/model';
import { serializeDownloadList } from '../../application/lists';

export async function exportDownloadList(jobs: DownloadJob[]) {
  const text = serializeDownloadList(jobs);
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (picker) {
    const handle = await picker({ suggestedName: 'flux-downloads.json' });
    const stream = await handle.createWritable();
    try {
      await stream.write(text);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => undefined);
      throw error;
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'flux-downloads.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
