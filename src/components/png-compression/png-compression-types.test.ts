import { describe, expect, it } from "vitest";
import {
  colorCountCandidatesForPixelCount,
  COLOR_COUNT_CANDIDATES_LARGE,
  COLOR_COUNT_CANDIDATES_MEDIUM,
  COLOR_COUNT_CANDIDATES_SMALL,
  MEDIUM_PIXEL_THRESHOLD,
  SMALL_PIXEL_THRESHOLD,
} from "./png-compression-types";

describe("colorCountCandidatesForPixelCount", () => {
  it("250,000px以下は全14候補を返す", () => {
    expect(colorCountCandidatesForPixelCount(1)).toEqual(COLOR_COUNT_CANDIDATES_SMALL);
    expect(colorCountCandidatesForPixelCount(SMALL_PIXEL_THRESHOLD)).toEqual(
      COLOR_COUNT_CANDIDATES_SMALL,
    );
    expect(COLOR_COUNT_CANDIDATES_SMALL).toHaveLength(14);
  });

  it("250,001〜2,000,000pxは8候補を返す", () => {
    expect(colorCountCandidatesForPixelCount(SMALL_PIXEL_THRESHOLD + 1)).toEqual(
      COLOR_COUNT_CANDIDATES_MEDIUM,
    );
    expect(colorCountCandidatesForPixelCount(MEDIUM_PIXEL_THRESHOLD)).toEqual(
      COLOR_COUNT_CANDIDATES_MEDIUM,
    );
    expect(COLOR_COUNT_CANDIDATES_MEDIUM).toHaveLength(8);
  });

  it("2,000,000px超は4候補を返す(フルHD 1920x1080=2,073,600pxはこの境界のすぐ外側に該当する)", () => {
    expect(colorCountCandidatesForPixelCount(MEDIUM_PIXEL_THRESHOLD + 1)).toEqual(
      COLOR_COUNT_CANDIDATES_LARGE,
    );
    expect(colorCountCandidatesForPixelCount(1920 * 1080)).toEqual(COLOR_COUNT_CANDIDATES_LARGE);
    expect(colorCountCandidatesForPixelCount(4000 * 3000)).toEqual(COLOR_COUNT_CANDIDATES_LARGE);
    expect(COLOR_COUNT_CANDIDATES_LARGE).toHaveLength(4);
  });

  it("各候補リストは降順である", () => {
    for (const list of [
      COLOR_COUNT_CANDIDATES_SMALL,
      COLOR_COUNT_CANDIDATES_MEDIUM,
      COLOR_COUNT_CANDIDATES_LARGE,
    ]) {
      const sorted = [...list].sort((a, b) => b - a);
      expect([...list]).toEqual(sorted);
    }
  });
});
