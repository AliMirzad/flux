import { createSHA256 } from 'hash-wasm';
type Hasher = Awaited<ReturnType<typeof createSHA256>>;
const idle: Hasher[] = [];

/** Reuse WASM memories after each operation; concurrent callers own distinct instances. */
export async function withSHA256<T>(work: (hash: Hasher) => T | Promise<T>): Promise<T> {
  const hash = idle.pop() ?? (await createSHA256());
  try {
    hash.init();
    return await work(hash);
  } finally {
    // Clear previous digest state before pooling, including after failed/canceled operations.
    hash.init();
    if (idle.length < 32) idle.push(hash);
  }
}
