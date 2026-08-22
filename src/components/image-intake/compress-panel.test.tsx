import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompressPanel } from "./compress-panel";
import { ja } from "../../i18n/dictionaries/ja";
import type { CompressionJob } from "./compression-types";

function makeTarget(bytes = 500_000) {
  return { bytes, label: "500kb", displayText: "500KB" };
}

describe("CompressPanel", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ジョブが無い場合は目標容量入力のみ表示される", () => {
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={undefined}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("目標容量")).toBeInTheDocument();
    expect(screen.queryByText("圧縮待ち…")).not.toBeInTheDocument();
  });

  it("queued状態: 圧縮待ちを表示し、入力を無効化する", () => {
    const job: CompressionJob = { target: makeTarget(), status: { kind: "queued" } };
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("圧縮待ち…")).toBeInTheDocument();
    expect(screen.getByLabelText("目標容量")).toBeDisabled();
  });

  it("processing状態: 段階表示と試行回数、キャンセルボタンを表示する", () => {
    const job: CompressionJob = {
      target: makeTarget(),
      status: {
        kind: "processing",
        progress: { phase: "quality", attempt: 3, maxAttempts: 12 },
      },
    };
    const onCancel = vi.fn();
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onCompress={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/画質を調整中/)).toBeInTheDocument();
    expect(screen.getByText(/試行 3 \/ 最大12/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("processing状態(preparing, attempt=0)は試行回数を表示しない", () => {
    const job: CompressionJob = {
      target: makeTarget(),
      status: {
        kind: "processing",
        progress: { phase: "preparing", attempt: 0, maxAttempts: 12 },
      },
    };
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("圧縮準備中")).toBeInTheDocument();
    expect(screen.queryByText(/試行/)).not.toBeInTheDocument();
  });

  it("done状態(unchanged): 「すでに目標容量以下です」と各種数値、プレビュー/保存導線を表示する", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
    const job: CompressionJob = {
      target: makeTarget(),
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo-500kb.jpg",
          outputFormat: "jpeg",
          unchanged: true,
          originalBytes: 400_000,
          outputBytes: 400_000,
          targetBytes: 500_000,
          originalWidth: 1000,
          originalHeight: 800,
          outputWidth: 1000,
          outputHeight: 800,
          encodeCount: 0,
          resizeCount: 0,
          elapsedMs: 0,
        },
      },
    };
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("すでに目標容量以下です")).toBeInTheDocument();
    expect(screen.getByText(/元容量:/)).toBeInTheDocument();
    expect(screen.getByText(/圧縮後容量:/)).toBeInTheDocument();
    expect(screen.getByText(/削減率: 0%/)).toBeInTheDocument();
    expect(screen.getByText(/出力形式: JPG/)).toBeInTheDocument();
    expect(screen.queryByText(/エンコード回数/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JPGを確認" })).toBeInTheDocument();
  });

  it("done状態(圧縮あり): 削減率・エンコード回数・リサイズ回数・処理時間を表示する", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
    const job: CompressionJob = {
      target: makeTarget(),
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo-500kb.jpg",
          outputFormat: "jpeg",
          unchanged: false,
          originalBytes: 1_000_000,
          outputBytes: 500_000,
          targetBytes: 500_000,
          originalWidth: 2000,
          originalHeight: 1000,
          outputWidth: 1500,
          outputHeight: 750,
          encodeCount: 5,
          resizeCount: 1,
          elapsedMs: 12_345,
        },
      },
    };
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("圧縮が完了しました")).toBeInTheDocument();
    expect(screen.getByText(/削減率: 50%/)).toBeInTheDocument();
    expect(screen.getByText(/エンコード回数: 5/)).toBeInTheDocument();
    expect(screen.getByText(/リサイズ回数: 1/)).toBeInTheDocument();
    expect(screen.getByText(/処理時間: 12\.3秒/)).toBeInTheDocument();
  });

  it("error状態(target-unreachable): 指定の文言を表示し、目標値を変えて再実行できる", () => {
    const onCompress = vi.fn();
    const job: CompressionJob = {
      target: makeTarget(1000),
      status: {
        kind: "error",
        reason: "target-unreachable",
        message: "この画像は現在の最低画質・最小寸法では指定容量以下にできませんでした",
      },
    };
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onCompress={onCompress}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText("この画像は現在の最低画質・最小寸法では指定容量以下にできませんでした"),
    ).toBeInTheDocument();
    // 「画質劣化なし」等の断定表現は使用しない
    expect(screen.queryByText(/劣化なし/)).not.toBeInTheDocument();

    // 入力は無効化されていないため、目標値を変えて再実行できる
    expect(screen.getByLabelText("目標容量")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "1MB" }));
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));
    expect(onCompress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 1_000_000 }));
  });

  it("cancelled状態: キャンセルした旨を表示する", () => {
    const job: CompressionJob = { target: makeTarget(), status: { kind: "cancelled" } };
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("キャンセルしました")).toBeInTheDocument();
  });

  it("error状態(encode-failed): Worker内部の技術的なメッセージではなく固定の平易な文言を表示する", () => {
    const job: CompressionJob = {
      target: makeTarget(),
      status: {
        kind: "error",
        reason: "encode-failed",
        message: "OffscreenCanvasの2Dコンテキストを取得できませんでした",
      },
    };
    render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText("画像処理を開始できませんでした。もう一度お試しください。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("OffscreenCanvasの2Dコンテキストを取得できませんでした"),
    ).not.toBeInTheDocument();
  });

  it("queued/processing/error状態はrole属性でスクリーンリーダーへ通知される", () => {
    const queuedJob: CompressionJob = { target: makeTarget(), status: { kind: "queued" } };
    const { rerender } = render(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={queuedJob}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("圧縮待ち…");

    const errorJob: CompressionJob = {
      target: makeTarget(),
      status: { kind: "error", reason: "target-unreachable", message: "達成できませんでした" },
    };
    rerender(
      <CompressPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={errorJob}
        onCompress={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("達成できませんでした");
  });

  describe("fixedTarget指定時(/compress-image-to-500kb等の固定容量ページ用)", () => {
    it("目標容量入力欄(数値・単位・プリセット)を一切表示せず、圧縮するボタンのみ表示する", () => {
      render(
        <CompressPanel
          messages={ja.ui}
          fileName="photo.jpg"
          job={undefined}
          onCompress={vi.fn()}
          onCancel={vi.fn()}
          fixedTarget={makeTarget(500_000)}
        />,
      );

      expect(screen.queryByLabelText("目標容量")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "圧縮する" })).toBeInTheDocument();
    });

    it("圧縮するボタン押下時、常にfixedTargetの値でonCompressを呼ぶ", () => {
      const onCompress = vi.fn();
      render(
        <CompressPanel
          messages={ja.ui}
          fileName="photo.jpg"
          job={undefined}
          onCompress={onCompress}
          onCancel={vi.fn()}
          fixedTarget={makeTarget(500_000)}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));
      expect(onCompress).toHaveBeenCalledWith(makeTarget(500_000));
    });

    it("処理中(queued/processing)はボタンをdisabledにする", () => {
      const job: CompressionJob = {
        target: makeTarget(),
        status: { kind: "processing", progress: { phase: "quality", attempt: 1, maxAttempts: 12 } },
      };
      render(
        <CompressPanel
          messages={ja.ui}
          fileName="photo.jpg"
          job={job}
          onCompress={vi.fn()}
          onCancel={vi.fn()}
          fixedTarget={makeTarget(500_000)}
        />,
      );

      expect(screen.getByRole("button", { name: "圧縮する" })).toBeDisabled();
    });

    it("done/error/cancelled後もボタンは再度押下でき、既存の結果表示ロジックをそのまま再利用する", () => {
      const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
      const job: CompressionJob = {
        target: makeTarget(),
        status: {
          kind: "done",
          result: {
            objectUrl: "blob:mock-result",
            blob,
            outputFileName: "photo-500kb.jpg",
            outputFormat: "jpeg",
            unchanged: false,
            originalBytes: 1_000_000,
            outputBytes: 400_000,
            targetBytes: 500_000,
            originalWidth: 2000,
            originalHeight: 1000,
            outputWidth: 1500,
            outputHeight: 750,
            encodeCount: 3,
            resizeCount: 0,
            elapsedMs: 100,
          },
        },
      };
      render(
        <CompressPanel
          messages={ja.ui}
          fileName="photo.jpg"
          job={job}
          onCompress={vi.fn()}
          onCancel={vi.fn()}
          fixedTarget={makeTarget(500_000)}
        />,
      );

      expect(screen.getByText("圧縮が完了しました")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "圧縮する" })).not.toBeDisabled();
    });

    it("fixedTarget未指定(従来利用)はCompressTargetInputを表示し、挙動を変えない(後方互換)", () => {
      const onCompress = vi.fn();
      render(
        <CompressPanel
          messages={ja.ui}
          fileName="photo.jpg"
          job={undefined}
          onCompress={onCompress}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByLabelText("目標容量")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "1MB" }));
      fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));
      expect(onCompress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 1_000_000 }));
    });
  });
});
