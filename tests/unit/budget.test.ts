import { describe, it, expect } from 'vitest';
import {
  TrafficBudget,
  TrafficLimitError,
  type TrafficRecord,
} from '../../src/engine/speed/budget';

function setup(limit = 10, period = 1000) {
  let now = 100;
  let record: TrafficRecord | undefined;
  const writes: TrafficRecord[] = [];
  const storage = {
    load: async () => structuredClone(record),
    save: async (next: TrafficRecord) => {
      record = structuredClone(next);
      writes.push(record);
    },
  };
  const updates: { used: number; limit: number; resetsAt: number }[] = [];
  const budget = new TrafficBudget(
    storage,
    (state) => updates.push(state),
    () => now,
  );
  return {
    budget,
    storage,
    writes,
    updates,
    ready: budget.configure(limit, period),
    advance: (at: number) => (now = at),
  };
}
const signal = () => new AbortController().signal;
describe('durable shared download allowance', () => {
  it('serializes concurrent connections and refuses a chunk that would cross the allowance', async () => {
    const test = setup();
    await test.ready;
    const results = await Promise.allSettled([
      test.budget.consume(6, signal()),
      test.budget.consume(5, signal()),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(TrafficLimitError);
    await test.budget.consume(4, signal());
    await expect(test.budget.check(signal())).rejects.toMatchObject({ resetsAt: 1000 });
    expect(test.writes.at(-1)!.used).toBe(10);
  });
  it('reserves durable bounded credit before bytes pass and conservatively retains it through restart', async () => {
    const test = setup(4 * 1024 * 1024);
    await test.ready;
    for (let i = 0; i < 16; i++) await test.budget.consume(16384, signal());
    expect(test.writes).toHaveLength(2); // Window initialization plus one 1 MiB lease.
    expect(test.writes[1]!.used).toBe(1024 * 1024);
    const restored = new TrafficBudget(
      test.storage,
      () => {},
      () => 100,
    );
    await restored.configure(1024 * 1024, 1000);
    await expect(restored.check(signal())).rejects.toBeInstanceOf(TrafficLimitError);
  });
  it('renews only at the next window and honors pause and persistence failures', async () => {
    const test = setup();
    await test.ready;
    await test.budget.consume(10, signal());
    test.advance(999);
    await expect(test.budget.consume(1, signal())).rejects.toBeInstanceOf(TrafficLimitError);
    test.advance(1000);
    await test.budget.consume(3, signal());
    expect(test.writes.at(-1)!.periodStart).toBe(1000);
    const aborted = new AbortController();
    aborted.abort();
    await expect(test.budget.consume(1, aborted.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const failing = new TrafficBudget({
      load: async () => undefined,
      save: async () => {
        throw new Error('disk failure');
      },
    });
    await expect(failing.configure(10, 1000)).rejects.toThrow('disk failure');
    await expect(failing.consume(1, signal())).rejects.toThrow('disk failure');
  });
});
