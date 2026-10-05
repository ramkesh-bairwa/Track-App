// Runs `worker` over `items` with at most `limit` in flight. Workers handle their own errors.
export async function runPool(items, limit, worker, signal) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

export const withTimeout = (signal, ms) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
