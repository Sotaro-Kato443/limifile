import { describe, expect, it } from "vitest";
import { createDecodeQueue } from "./decode-queue";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createDecodeQueue", () => {
  it("指定した同時実行数を超えて実行しない", async () => {
    const queue = createDecodeQueue(2);
    let concurrent = 0;
    let maxObserved = 0;

    const runTask = () =>
      queue.enqueue(async () => {
        concurrent += 1;
        maxObserved = Math.max(maxObserved, concurrent);
        await wait(20);
        concurrent -= 1;
      });

    await Promise.all([runTask(), runTask(), runTask(), runTask(), runTask()]);

    expect(maxObserved).toBe(2);
    expect(concurrent).toBe(0);
  });

  it("maxConcurrency=1では直列実行になる", async () => {
    const queue = createDecodeQueue(1);
    let concurrent = 0;
    let maxObserved = 0;

    const runTask = () =>
      queue.enqueue(async () => {
        concurrent += 1;
        maxObserved = Math.max(maxObserved, concurrent);
        await wait(10);
        concurrent -= 1;
      });

    await Promise.all([runTask(), runTask(), runTask()]);

    expect(maxObserved).toBe(1);
  });

  it("1件の失敗が他のタスクの実行を妨げない", async () => {
    const queue = createDecodeQueue(2);

    const results = await Promise.allSettled([
      queue.enqueue(async () => {
        throw new Error("boom");
      }),
      queue.enqueue(async () => "ok-1"),
      queue.enqueue(async () => "ok-2"),
    ]);

    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: "ok-1" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "ok-2" });
  });
});
