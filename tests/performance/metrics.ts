import type { CDPSession } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export class ChromeMetrics {
  peakPrivateBytes: number | null = null;
  peakWorkingSetBytes: number | null = null;
  cpuSeconds = 0;
  samples = 0;
  errors: string[] = [];
  private previous = new Map<number, number>();
  constructor(private session: CDPSession) {}
  async sample() {
    try {
      const { processInfo } = await this.session.send('SystemInfo.getProcessInfo');
      for (const process of processInfo) {
        const previous = this.previous.get(process.id);
        if (previous !== undefined) this.cpuSeconds += Math.max(0, process.cpuTime - previous);
        this.previous.set(process.id, process.cpuTime);
      }
      const ids = processInfo
        .map((process) => process.id)
        .filter((id) => Number.isInteger(id) && id > 0);
      if (process.platform === 'win32') {
        const script = `$p=Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue; [pscustomobject]@{private=($p|Measure-Object PrivateMemorySize64 -Sum).Sum;working=($p|Measure-Object WorkingSet64 -Sum).Sum}|ConvertTo-Json -Compress`;
        const result = await execute(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { windowsHide: true, timeout: 5000 },
        );
        const memory = JSON.parse(result.stdout);
        if (Number.isFinite(memory.private))
          this.peakPrivateBytes = Math.max(this.peakPrivateBytes ?? 0, memory.private);
        if (Number.isFinite(memory.working))
          this.peakWorkingSetBytes = Math.max(this.peakWorkingSetBytes ?? 0, memory.working);
      } else {
        const result = await execute('ps', ['-o', 'rss=', '-p', ids.join(',')], { timeout: 5000 });
        const rss = result.stdout
          .trim()
          .split(/\s+/)
          .reduce((sum, value) => sum + Number(value) * 1024, 0);
        if (Number.isFinite(rss))
          this.peakWorkingSetBytes = Math.max(this.peakWorkingSetBytes ?? 0, rss);
      }
      this.samples++;
    } catch (error) {
      if (this.errors.length < 5)
        this.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  result() {
    return {
      samples: this.samples,
      cpuSeconds: this.cpuSeconds,
      peakPrivateBytes: this.peakPrivateBytes,
      peakWorkingSetBytes: this.peakWorkingSetBytes,
      errors: this.errors,
    };
  }
}
