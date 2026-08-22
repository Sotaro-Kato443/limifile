/**
 * png-compression.worker.ts全体で共有する単一deadline方式のための小さなユーティリティ。
 * 入力デコード・UPNGロード・探索・最終出力再デコードのすべてが、Worker全体で1回だけ計算した
 * deadlineから残り時間を都度計算して使う(各工程に個別のtime budgetを新たに割り当てない)。
 */
export class TimeoutError extends Error {
  constructor() {
    super("処理が時間予算を超過しました");
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return Promise.reject(new TimeoutError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
