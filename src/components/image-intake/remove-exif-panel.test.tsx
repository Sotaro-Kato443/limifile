import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoveExifPanel } from "./remove-exif-panel";
import { ja } from "../../i18n/dictionaries/ja";
import type { RemoveMetadataJob } from "./remove-exif-types";

describe("RemoveExifPanel", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ジョブが無い場合は削除開始ボタンのみ表示される", () => {
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={undefined}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "メタデータを削除する" })).toBeInTheDocument();
    expect(screen.queryByText("削除待ち…")).not.toBeInTheDocument();
  });

  it("削除開始ボタンを押すとonStartが呼ばれる", () => {
    const onStart = vi.fn();
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={undefined}
        onStart={onStart}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "メタデータを削除する" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("queued状態: 削除待ちを表示し、開始ボタンを無効化する", () => {
    const job: RemoveMetadataJob = { status: { kind: "queued" } };
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("削除待ち…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "メタデータを削除する" })).toBeDisabled();
  });

  it("processing状態: 削除中とキャンセルボタンを表示する", () => {
    const job: RemoveMetadataJob = { status: { kind: "processing" } };
    const onCancel = vi.fn();
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onStart={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("削除中…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("done状態: 固定の説明文・統計・プレビュー/保存導線を表示する", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
    const job: RemoveMetadataJob = {
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo-metadata-removed.jpg",
          originalBytes: 1_000_000,
          outputBytes: 998_000,
          originalWidth: 4032,
          originalHeight: 3024,
          outputWidth: 4032,
          outputHeight: 3024,
          orientationKept: false,
          iccKept: false,
          elapsedMs: 3.4,
        },
      },
    };
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("メタデータを削除しました")).toBeInTheDocument();
    expect(
      screen.getByText(
        "EXIF、XMP、IPTC、コメントなどのメタデータ領域を削除しました。これらの領域には、位置情報・撮影日時・カメラ情報などが含まれる場合があります。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/元容量:/)).toBeInTheDocument();
    expect(screen.getByText(/出力容量:/)).toBeInTheDocument();
    expect(screen.getByText(/再エンコード: なし/)).toBeInTheDocument();
    expect(screen.getByText(/出力形式: JPG/)).toBeInTheDocument();
    expect(screen.getByText(/向き情報: 削除/)).toBeInTheDocument();
    expect(screen.getByText(/カラープロファイル: 削除/)).toBeInTheDocument();
    // 断定的な「位置情報を削除しました」等の個別文言は使用しない
    expect(screen.queryByText(/位置情報を削除しました/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JPGを確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度削除する" })).toBeInTheDocument();
  });

  it("done状態(orientationKept): 向きを保つ旨の補足文言を表示する", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
    const job: RemoveMetadataJob = {
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo-metadata-removed.jpg",
          originalBytes: 100,
          outputBytes: 90,
          originalWidth: 300,
          originalHeight: 480,
          outputWidth: 300,
          outputHeight: 480,
          orientationKept: true,
          iccKept: false,
          elapsedMs: 1,
        },
      },
    };
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText("写真の表示方向を保つため、向き情報のみ残しています。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/向き情報: 保持/)).toBeInTheDocument();
  });

  it("done状態(iccKept): 色味を保つ旨の補足文言を表示する", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "image/jpeg" });
    const job: RemoveMetadataJob = {
      status: {
        kind: "done",
        result: {
          objectUrl: "blob:mock-result",
          blob,
          outputFileName: "photo-metadata-removed.jpg",
          originalBytes: 100,
          outputBytes: 95,
          originalWidth: 300,
          originalHeight: 200,
          outputWidth: 300,
          outputHeight: 200,
          orientationKept: false,
          iccKept: true,
          elapsedMs: 1,
        },
      },
    };
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText("色味を保つため、カラープロファイルは残しています。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/カラープロファイル: 保持/)).toBeInTheDocument();
  });

  it.each([
    ["invalid-jpeg", "JPEGとして読み取れませんでした。ファイルが壊れている可能性があります。"],
    ["malformed-exif", "EXIF情報の構造が不正です。ファイルが壊れている可能性があります。"],
    ["ambiguous-orientation", "向き情報が複数あり、どれが正しいか判断できませんでした。"],
  ] as const)("error状態(%s): 対応する文言を表示する", (code, expected) => {
    const job: RemoveMetadataJob = { status: { kind: "error", code, message: "内部メッセージ" } };
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
    // 開始ボタンは無効化されず、再実行できる
    expect(screen.getByRole("button", { name: "メタデータを削除する" })).not.toBeDisabled();
  });

  it("cancelled状態: キャンセルした旨を表示する", () => {
    const job: RemoveMetadataJob = { status: { kind: "cancelled" } };
    render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={job}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("キャンセルしました")).toBeInTheDocument();
  });

  it("queued状態はrole=status、error状態はrole=alertでスクリーンリーダーへ通知される", () => {
    const queuedJob: RemoveMetadataJob = { status: { kind: "queued" } };
    const { rerender } = render(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={queuedJob}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("削除待ち…");

    const errorJob: RemoveMetadataJob = {
      status: { kind: "error", code: "invalid-jpeg", message: "内部メッセージ" },
    };
    rerender(
      <RemoveExifPanel
        messages={ja.ui}
        fileName="photo.jpg"
        job={errorJob}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
