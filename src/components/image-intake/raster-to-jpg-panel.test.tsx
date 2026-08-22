import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RasterToJpgPanel } from "./raster-to-jpg-panel";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import { ja } from "../../i18n/dictionaries/ja";
import type { RasterToJpgJob } from "./raster-convert-types";

describe("RasterToJpgPanel", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ジョブが無い場合、画質3段階・背景色ピッカー(既定white)・変換ボタンが表示される", () => {
    render(
      <RasterToJpgPanel
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
    expect(screen.getByRole("radio", { name: /標準/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeInTheDocument();
    const colorInput = screen.getByLabelText("透明部分の背景色") as HTMLInputElement;
    expect(colorInput).toBeInTheDocument();
    expect(colorInput.value).toBe("#ffffff");
    expect(screen.getByText(/透明部分をこの背景色で塗りつぶします/)).toBeInTheDocument();
  });

  it("画質を選んでから変換ボタンを押すと、選択したpreset・既定の背景色でonConvertが呼ばれる", () => {
    const onConvert = vi.fn();
    render(
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={undefined}
        onConvert={onConvert}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /軽量/ }));
    fireEvent.click(screen.getByRole("button", { name: "JPGへ変換する" }));

    expect(onConvert).toHaveBeenCalledWith("light", DEFAULT_RASTER_BACKGROUND);
  });

  it("何も選び直さずに変換ボタンを押すと、既定のstandard・白背景でonConvertが呼ばれる", () => {
    const onConvert = vi.fn();
    render(
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={undefined}
        onConvert={onConvert}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "JPGへ変換する" }));
    expect(onConvert).toHaveBeenCalledWith("standard", DEFAULT_RASTER_BACKGROUND);
  });

  it("背景色を変更してから変換ボタンを押すと、変更後の色でonConvertが呼ばれる", () => {
    const onConvert = vi.fn();
    render(
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={undefined}
        onConvert={onConvert}
        onCancel={vi.fn()}
      />,
    );

    const colorInput = screen.getByLabelText("透明部分の背景色");
    fireEvent.input(colorInput, { target: { value: "#112233" } });
    fireEvent.click(screen.getByRole("button", { name: "JPGへ変換する" }));

    expect(onConvert).toHaveBeenCalledWith("standard", { r: 0x11, g: 0x22, b: 0x33 });
  });

  it("queued状態: 変換待ちを表示し、画質選択・背景色ピッカー・ボタンを無効化する", () => {
    const job: RasterToJpgJob = { status: { kind: "queued" } };
    render(
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("変換待ち…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JPGへ変換する" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /標準/ })).toBeDisabled();
    expect(screen.getByLabelText("透明部分の背景色")).toBeDisabled();
  });

  it("processing状態: 変換中表示とキャンセルボタンを表示する", () => {
    const job: RasterToJpgJob = { status: { kind: "processing" } };
    const onCancel = vi.fn();
    render(
      <RasterToJpgPanel
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

  it("done状態: 変換結果・削減率・寸法・画質設定・背景色・プレビュー導線を表示する", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
    const job: RasterToJpgJob = {
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo.jpg",
          qualityPreset: "standard",
          background: DEFAULT_RASTER_BACKGROUND,
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
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("JPGへ変換しました")).toBeInTheDocument();
    expect(screen.getByText("60%削減")).toBeInTheDocument();
    expect(screen.getByText(/出力形式: JPG/)).toBeInTheDocument();
    expect(screen.getByText(/画質設定: 標準/)).toBeInTheDocument();
    expect(screen.getByText(/使用した背景色: #ffffff/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JPGを確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この設定で再変換する" })).toBeInTheDocument();
  });

  it("done状態: 変換後の方が大きくなった場合は増加として表示する(意味の通らない負のパーセントを表示しない)", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
    const job: RasterToJpgJob = {
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo.jpg",
          qualityPreset: "high",
          background: DEFAULT_RASTER_BACKGROUND,
          originalBytes: 100_000,
          outputBytes: 125_000,
          originalWidth: 1000,
          originalHeight: 800,
          outputWidth: 1000,
          outputHeight: 800,
          elapsedMs: 1500,
        },
      },
    };
    render(
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("25%増加")).toBeInTheDocument();
    expect(screen.queryByText(/-25%/)).not.toBeInTheDocument();
  });

  it("done状態: 変換前後で同じサイズの場合は0%削減として自然に表示する", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
    const job: RasterToJpgJob = {
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo.jpg",
          qualityPreset: "high",
          background: DEFAULT_RASTER_BACKGROUND,
          originalBytes: 100_000,
          outputBytes: 100_000,
          originalWidth: 1000,
          originalHeight: 800,
          outputWidth: 1000,
          outputHeight: 800,
          elapsedMs: 1500,
        },
      },
    };
    render(
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("0%削減")).toBeInTheDocument();
  });

  it("error状態(unsupported-animation): hookが組み立てた文言をそのまま表示する", () => {
    const job: RasterToJpgJob = {
      status: {
        kind: "error",
        reason: "unsupported-animation",
        message: "アニメーション画像には現在対応していません。",
      },
    };
    render(
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={job}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("アニメーション画像には現在対応していません。")).toBeInTheDocument();
  });

  it("error状態(encode-failed): Worker内部の技術的なメッセージではなく固定の平易な文言を表示する", () => {
    const job: RasterToJpgJob = {
      status: {
        kind: "error",
        reason: "encode-failed",
        message: "OffscreenCanvasの2Dコンテキストを取得できませんでした",
      },
    };
    render(
      <RasterToJpgPanel
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
    const job: RasterToJpgJob = { status: { kind: "cancelled" } };
    render(
      <RasterToJpgPanel
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
    const queuedJob: RasterToJpgJob = { status: { kind: "queued" } };
    const { rerender } = render(
      <RasterToJpgPanel
        messages={ja.ui}
        fileName="photo.png"
        job={queuedJob}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("変換待ち…");

    const errorJob: RasterToJpgJob = {
      status: { kind: "error", reason: "timeout", message: "タイムアウトしました" },
    };
    rerender(
      <RasterToJpgPanel
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
        <RasterToJpgPanel
          messages={ja.ui}
          fileName="a.png"
          job={undefined}
          onConvert={vi.fn()}
          onCancel={vi.fn()}
        />
        <RasterToJpgPanel
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
