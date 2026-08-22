import { renderHook, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useTrackProcessingOutcome,
  type TrackableProcessingStatus,
} from "./use-track-processing-outcome";

afterEach(() => {
  delete window.umami;
  window.history.replaceState({}, "", "/");
});

describe("useTrackProcessingOutcome", () => {
  it("doneを1回だけ成功として送り、再処理の新しいdoneは別結果として送る", async () => {
    const track = vi.fn();
    window.umami = { track };
    window.history.replaceState({}, "", "/compress-image/");

    const queued = { kind: "queued" };
    const firstDone = { kind: "done" };
    const secondDone = { kind: "done" };
    const { rerender } = renderHook(
      ({ status }: { status: TrackableProcessingStatus }) => useTrackProcessingOutcome(status),
      { initialProps: { status: queued } },
    );

    rerender({ status: firstDone });
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    rerender({ status: firstDone });
    expect(track).toHaveBeenCalledTimes(1);

    rerender({ status: secondDone });
    await waitFor(() => expect(track).toHaveBeenCalledTimes(2));
    expect(track).toHaveBeenLastCalledWith("process_success", {
      tool_id: "compress-image",
    });
  });

  it("errorの自由記述messageは参照せず、reasonだけを固定カテゴリで送る", async () => {
    const track = vi.fn();
    window.umami = { track };
    window.history.replaceState({}, "", "/remove-exif/");

    renderHook(() =>
      useTrackProcessingOutcome({
        kind: "error",
        reason: "decode-failed",
        message: "private-file-name.jpg could not be decoded",
      } as TrackableProcessingStatus),
    );

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith("process_error", {
        tool_id: "remove-exif",
        error_code: "decode_failed",
      }),
    );
    expect(JSON.stringify(track.mock.calls)).not.toContain("private-file-name.jpg");
  });

  it("unreachableは成功ではなく目標未達エラーとして送る", async () => {
    const track = vi.fn();
    window.umami = { track };
    window.history.replaceState({}, "", "/compress-png/");

    renderHook(() => useTrackProcessingOutcome({ kind: "unreachable" }));

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith("process_error", {
        tool_id: "compress-png",
        error_code: "target_unreachable",
      }),
    );
  });
});
