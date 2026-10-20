import { afterAll, beforeAll, it, vi } from 'vitest';
import { createJob } from '../../src/application/jobs';
import { defaultSettings } from '../../src/domain/model';
import { runDownload } from '../../src/engine/runner';
import { HostSlots } from '../../src/engine/speed/control';
import { MemoryStore } from '../fixtures/memory-store';
import { startFixture } from '../fixtures/server';

vi.mock('../../src/engine/speed/control', async (load) => {
  const real = await load<typeof import('../../src/engine/speed/control')>();
  if (!process.env.OLD_CONTROLLER) return real;
  class Old {
    target = 1;
    previous = 0;
    last: number;
    cooldown = 0;
    constructor(
      readonly max: number,
      now = performance.now(),
    ) {
      this.last = now;
    }
    sample(rate: number, failed = false, now = performance.now()) {
      if (failed) {
        this.target = Math.max(1, Math.floor(this.target / 2));
        this.cooldown = now + 15000;
        this.last = now;
        return this.target;
      }
      if (now - this.last < 5000 || now < this.cooldown) return this.target;
      if (this.previous > 0 && rate < this.previous * 1.03 && this.target > 1) {
        this.target--;
        this.cooldown = now + 15000;
      } else if (rate > 0 && this.target < this.max) this.target++;
      this.previous = rate;
      this.last = now;
      return this.target;
    }
  }
  return { ...real, AdaptiveController: Old };
});

let fixture: Awaited<ReturnType<typeof startFixture>>;
beforeAll(async () => {
  fixture = await startFixture();
});
afterAll(async () => {
  await fixture.close();
});

const size = 32 * 1024 * 1024;
for (const mode of ['1', '4', '8', '16', 'adaptive'])
  it(
    `measures ${mode}`,
    async () => {
      fixture.reset();
      const settings = {
        ...defaultSettings,
        perHost: 16,
        maxConnections: mode === 'adaptive' ? 16 : Number(mode),
        mode: mode === 'adaptive' ? ('auto' as const) : ('manual' as const),
      };
      const job = createJob({ url: `${fixture.url}/capped?size=${size}&delay=32` }, settings, true);
      job.state = 'PROBING';
      const slots = new HostSlots(16);
      const seen: number[] = [];
      const started = performance.now();
      await runDownload({
        job,
        store: new MemoryStore(64 * 1024 * 1024),
        settings,
        signal: new AbortController().signal,
        checkpoint: async () => {},
        progress: (j) => seen.push(j.connections),
        acquireHost: (host, signal) => slots.acquire(host, signal),
        allowLocalForTests: true,
      });
      const seconds = (performance.now() - started) / 1000;
      console.log(
        `${process.env.OLD_CONTROLLER ? 'OLD' : 'NEW'} ${mode.padEnd(8)} ${(size / 1024 ** 2 / seconds).toFixed(2)} MiB/s  ${seconds.toFixed(1)}s  peak server connections=${fixture.stats.maxActive}`,
      );
    },
    600000,
  );
