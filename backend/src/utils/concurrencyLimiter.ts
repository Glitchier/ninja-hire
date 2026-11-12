export type Task<T> = () => Promise<T>;

export interface TaskResult<T> {
  status: "fulfilled" | "rejected";
  value?: T;
  reason?: any;
}

/**
 * Concurrency Limiter written by hand without external libraries!
 * Executes up to `limit` promises concurrently, preserving the original array order.
 */
export async function mapConcurrent<Item, Result>(
  items: Item[],
  limit: number,
  fn: (item: Item, index: number) => Promise<Result>,
): Promise<TaskResult<Result>[]> {
  const results: TaskResult<Result>[] = new Array(items.length);
  let currentIndex = 0;

  // Worker loop: pulls tasks one by one until queue is empty
  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index]!;

      try {
        const val = await fn(item, index);
        results[index] = { status: "fulfilled", value: val };
      } catch (err) {
        // One failure does NOT abort the rest!
        results[index] = { status: "rejected", reason: err };
      }
    }
  }

  // Spawn up to `limit` workers in parallel
  const workerCount = Math.min(limit, items.length);
  const workers: Promise<void>[] = [];

  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  // Wait for all worker streams to finish
  await Promise.all(workers);

  return results;
}
