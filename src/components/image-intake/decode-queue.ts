/** iPhone Safari等でのメモリ負荷を抑えるため、画像デコードの同時実行数を制限する既定値 */
export const DEFAULT_MAX_CONCURRENT_DECODES = 2;

export interface DecodeQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * 同時実行数を制限したタスクキューを作る。
 * 1件のタスクが失敗しても、他のタスクの実行やキュー自体には影響しない。
 */
export function createDecodeQueue(maxConcurrency: number): DecodeQueue {
  let active = 0;
  const pending: Array<() => void> = [];

  function runNext(): void {
    if (active >= maxConcurrency) return;
    const next = pending.shift();
    if (!next) return;
    active += 1;
    next();
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            runNext();
          });
      });
      runNext();
    });
  }

  return { enqueue };
}
