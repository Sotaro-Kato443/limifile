import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PngToWebpPanel } from "./png-to-webp-panel";
import { ja } from "../../i18n/dictionaries/ja";
import type { PngToWebpJob } from "./png-to-webp-types";

describe("PngToWebpPanel", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ジョブが無い場合、画質3段階と変換ボタンが表示され、標準が既定で選択されている", () => {
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={undefined}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("高画質")).toBeInTheDocument();
    expect(screen.getByText("標準")).toBeInTheDocument();
    expect(screen.getByText("軽量")).toBeInTheDocument();
    expect(screen.getByText("画質を優先")).toBeInTheDocument();
    expect(screen.getByText("画質と容量のバランス")).toBeInTheDocument();
    expect(screen.getByText("ファイルサイズを優先")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /標準/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "WebPへ変換する" })).toBeInTheDocument();
  });

  it("画質を選んでから変換ボタンを押すと、選択したpresetでonConvertが呼ばれる", () => {
    const onConvert = vi.fn();
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={undefined}
        onConvert={onConvert}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /軽量/ }));
    fireEvent.click(screen.getByRole("button", { name: "WebPへ変換する" }));

    expect(onConvert).toHaveBeenCalledWith("light");
  });

  it("何も選び直さずに変換ボタンを押すと、既定のstandardでonConvertが呼ばれる", () => {
    const onConvert = vi.fn();
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={undefined}
        onConvert={onConvert}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "WebPへ変換する" }));
    expect(onConvert).toHaveBeenCalledWith("standard");
  });

  it("queued状態: 変換待ちを表示し、画質選択・ボタンを無効化する", () => {
    const job: PngToWebpJob = { status: { kind: "queued" } };
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("変換待ち…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WebPへ変換する" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /標準/ })).toBeDisabled();
  });

  it("processing状態: 変換中表示とキャンセルボタンを表示する", () => {
    const job: PngToWebpJob = { status: { kind: "processing" } };
    const onCancel = vi.fn();
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("変換中…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("done状態: 変換結果・削減率・寸法・画質設定・プレビュー導線を表示する", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/webp" });
    const job: PngToWebpJob = {
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo.webp",
          qualityPreset: "standard",
          originalBytes: 1_000_000,
          outputBytes: 400_000,
          originalWidth: 1000,
          originalHeight: 800,
          outputWidth: 1000,
          outputHeight: 800,
          elapsedMs: 1500,
        },
      },
    };
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("WebPへ変換しました")).toBeInTheDocument();
    expect(screen.getByText(/削減率: 60%/)).toBeInTheDocument();
    expect(screen.getByText(/出力形式: WebP/)).toBeInTheDocument();
    expect(screen.getByText(/画質設定: 標準/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WebPを確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この画質で再変換する" })).toBeInTheDocument();
  });

  it("error状態(unsupported-animation): hookが組み立てた文言をそのまま表示する", () => {
    const job: PngToWebpJob = {
      status: {
        kind: "error",
        reason: "unsupported-animation",
        message: "アニメーションPNGには現在対応していません。",
      },
    };
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("アニメーションPNGには現在対応していません。")).toBeInTheDocument();
  });

  it("error状態(encode-failed): Worker内部の技術的なメッセージではなく固定の平易な文言を表示する", () => {
    const job: PngToWebpJob = {
      status: {
        kind: "error",
        reason: "encode-failed",
        message: "OffscreenCanvasの2Dコンテキストを取得できませんでした",
      },
    };
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
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

  it("cancelled状態: キャンセルした旨を表示する", () => {
    const job: PngToWebpJob = { status: { kind: "cancelled" } };
    render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("キャンセルしました")).toBeInTheDocument();
  });

  it("queued/processing/error状態はrole属性でスクリーンリーダーへ通知される", () => {
    const queuedJob: PngToWebpJob = { status: { kind: "queued" } };
    const { rerender } = render(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={queuedJob}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("変換待ち…");

    const errorJob: PngToWebpJob = {
      status: { kind: "error", reason: "timeout", message: "タイムアウトしました" },
    };
    rerender(
      <PngToWebpPanel
        messages={ja.ui}
        fileName="photo.png"
        job={errorJob}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("タイムアウトしました");
  });

  it("複数インスタンスをレンダーしても、ラジオボタンのグループが互いに干渉しない", () => {
    render(
      <>
        <PngToWebpPanel
          messages={ja.ui}
          fileName="a.png"
          job={undefined}
          onConvert={vi.fn()}
          onCancel={vi.fn()}
        />
        <PngToWebpPanel
          messages={ja.ui}
          fileName="b.png"
          job={undefined}
          onConvert={vi.fn()}
          onCancel={vi.fn()}
        />
      </>,
    );
    const lightRadios = screen.getAllByRole("radio", { name: /軽量/ });
    expect(lightRadios).toHaveLength(2);
    fireEvent.click(lightRadios[0]);
    expect(lightRadios[0]).toBeChecked();
    expect(lightRadios[1]).not.toBeChecked();
  });
});
