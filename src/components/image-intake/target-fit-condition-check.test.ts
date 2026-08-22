import { describe, expect, it } from "vitest";
import { buildConditionChecklist } from "./target-fit-condition-check";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import type { TargetFitCandidate, TargetFitRequest } from "./target-fit-types";

function makeRequest(overrides: Partial<TargetFitRequest> = {}): TargetFitRequest {
  return {
    targetWidth: 200,
    targetHeight: 100,
    maxBytes: 10_000,
    fitMode: "contain",
    background: DEFAULT_RASTER_BACKGROUND,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<TargetFitCandidate> = {}): TargetFitCandidate {
  return {
    jpegBuffer: new ArrayBuffer(0),
    width: 200,
    height: 100,
    quality: 0.8,
    bytes: 8000,
    mimeType: "image/jpeg",
    upscaled: false,
    ...overrides,
  };
}

describe("buildConditionChecklist", () => {
  it("すべての条件を満たすcandidateでは全項目ok:trueを返す", () => {
    const checklist = buildConditionChecklist(makeCandidate(), makeRequest());
    expect(checklist.width).toEqual({ ok: true, actual: 200, target: 200 });
    expect(checklist.height).toEqual({ ok: true, actual: 100, target: 100 });
    expect(checklist.size).toEqual({ ok: true, actualBytes: 8000, maxBytes: 10_000 });
    expect(checklist.format).toEqual({ ok: true, actual: "image/jpeg" });
  });

  it("widthが一致しない場合、width.okだけがfalseになる(他の項目に影響しない)", () => {
    const checklist = buildConditionChecklist(makeCandidate({ width: 199 }), makeRequest());
    expect(checklist.width.ok).toBe(false);
    expect(checklist.width.actual).toBe(199);
    expect(checklist.height.ok).toBe(true);
    expect(checklist.size.ok).toBe(true);
    expect(checklist.format.ok).toBe(true);
  });

  it("heightが一致しない場合、height.okだけがfalseになる", () => {
    const checklist = buildConditionChecklist(makeCandidate({ height: 99 }), makeRequest());
    expect(checklist.height.ok).toBe(false);
    expect(checklist.width.ok).toBe(true);
  });

  it("bytesがmaxBytesちょうどの場合はok:true(境界値、以下を許容)", () => {
    const checklist = buildConditionChecklist(
      makeCandidate({ bytes: 10_000 }),
      makeRequest({ maxBytes: 10_000 }),
    );
    expect(checklist.size.ok).toBe(true);
  });

  it("bytesがmaxBytesを1でも超えるとok:falseになる", () => {
    const checklist = buildConditionChecklist(
      makeCandidate({ bytes: 10_001 }),
      makeRequest({ maxBytes: 10_000 }),
    );
    expect(checklist.size.ok).toBe(false);
    expect(checklist.size.actualBytes).toBe(10_001);
  });

  it('mimeTypeが"image/jpeg"以外の場合、format.okだけがfalseになる', () => {
    const checklist = buildConditionChecklist(
      makeCandidate({ mimeType: "image/webp" }),
      makeRequest(),
    );
    expect(checklist.format).toEqual({ ok: false, actual: "image/webp" });
    expect(checklist.width.ok).toBe(true);
    expect(checklist.height.ok).toBe(true);
    expect(checklist.size.ok).toBe(true);
  });

  it("複数条件が同時に未達の場合、それぞれ独立にok:falseを返す(型で決め打ちしない)", () => {
    const checklist = buildConditionChecklist(
      makeCandidate({ width: 50, height: 50, bytes: 999_999, mimeType: "image/png" }),
      makeRequest(),
    );
    expect(checklist.width.ok).toBe(false);
    expect(checklist.height.ok).toBe(false);
    expect(checklist.size.ok).toBe(false);
    expect(checklist.format.ok).toBe(false);
  });
});
