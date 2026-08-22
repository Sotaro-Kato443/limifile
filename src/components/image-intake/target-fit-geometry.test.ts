import { describe, expect, it } from "vitest";
import {
  computeContainLayout,
  computeStretchLayout,
  computeTargetFitLayout,
} from "./target-fit-geometry";

describe("computeContainLayout", () => {
  it("縦横比が一致する場合、余白なくtargetいっぱいに描画する", () => {
    const layout = computeContainLayout(400, 400, 200, 200);
    expect(layout).toEqual({ drawWidth: 200, drawHeight: 200, dx: 0, dy: 0, upscaled: false });
  });

  it("横長のsourceを正方形targetへ収めると、上下に余白ができる", () => {
    const layout = computeContainLayout(800, 400, 200, 200);
    expect(layout.drawWidth).toBe(200);
    expect(layout.drawHeight).toBe(100);
    expect(layout.dx).toBe(0);
    expect(layout.dy).toBe(50);
    expect(layout.upscaled).toBe(false);
  });

  it("縦長のsourceを正方形targetへ収めると、左右に余白ができる", () => {
    const layout = computeContainLayout(400, 800, 200, 200);
    expect(layout.drawWidth).toBe(100);
    expect(layout.drawHeight).toBe(200);
    expect(layout.dx).toBe(50);
    expect(layout.dy).toBe(0);
    expect(layout.upscaled).toBe(false);
  });

  it("sourceがtargetより小さい場合、アップスケールしてupscaled=trueになる", () => {
    const layout = computeContainLayout(100, 100, 400, 400);
    expect(layout.drawWidth).toBe(400);
    expect(layout.drawHeight).toBe(400);
    expect(layout.upscaled).toBe(true);
  });

  it("極端な横長sourceでも、drawWidth/drawHeightは0にならない(最低1pxを保証する)", () => {
    const layout = computeContainLayout(16000, 1, 10, 10);
    expect(layout.drawWidth).toBeGreaterThanOrEqual(1);
    expect(layout.drawHeight).toBeGreaterThanOrEqual(1);
  });

  it("極端な縦長sourceでも、drawWidth/drawHeightは0にならない", () => {
    const layout = computeContainLayout(1, 16000, 10, 10);
    expect(layout.drawWidth).toBeGreaterThanOrEqual(1);
    expect(layout.drawHeight).toBeGreaterThanOrEqual(1);
  });

  it("dx+drawWidthはtargetWidth以下、dy+drawHeightはtargetHeight以下(canvas範囲を超えない)", () => {
    const layout = computeContainLayout(333, 777, 250, 140);
    expect(layout.dx + layout.drawWidth).toBeLessThanOrEqual(250);
    expect(layout.dy + layout.drawHeight).toBeLessThanOrEqual(140);
  });
});

describe("computeStretchLayout", () => {
  it("常にtargetWidth×targetHeightいっぱいに描画し、余白を持たない", () => {
    const layout = computeStretchLayout(800, 400, 200, 300);
    expect(layout).toEqual({
      drawWidth: 200,
      drawHeight: 300,
      dx: 0,
      dy: 0,
      upscaled: false,
    });
  });

  it("sourceがtargetの両辺より大きい場合、upscaled=false", () => {
    const layout = computeStretchLayout(1000, 1000, 200, 200);
    expect(layout.upscaled).toBe(false);
  });

  it("片方の辺だけtargetより小さい場合でもupscaled=true", () => {
    const layout = computeStretchLayout(1000, 100, 200, 200);
    expect(layout.upscaled).toBe(true);
  });
});

describe("computeTargetFitLayout", () => {
  it('fitMode="contain"の場合、computeContainLayoutと同じ結果を返す', () => {
    expect(computeTargetFitLayout("contain", 800, 400, 200, 200)).toEqual(
      computeContainLayout(800, 400, 200, 200),
    );
  });

  it('fitMode="stretch"の場合、computeStretchLayoutと同じ結果を返す', () => {
    expect(computeTargetFitLayout("stretch", 800, 400, 200, 200)).toEqual(
      computeStretchLayout(800, 400, 200, 200),
    );
  });
});
