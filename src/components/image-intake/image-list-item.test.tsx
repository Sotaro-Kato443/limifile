import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageListItem } from "./image-list-item";
import { ja } from "../../i18n/dictionaries/ja";
import type { IntakeItem } from "./types";

function createHeicDoneItem(
  overrides: {
    id?: string;
    fileName?: string;
    objectUrl?: string;
    jpegBytes?: number;
    width?: number;
    height?: number;
    blob?: Blob;
  } = {},
): IntakeItem {
  const fileName = overrides.fileName ?? "photo.heic";
  const file = new File([new Uint8Array([1, 2, 3])], fileName, { type: "image/heic" });
  const jpegBytes = overrides.jpegBytes ?? 12345;
  const blob = overrides.blob ?? new Blob([new Uint8Array(jpegBytes)], { type: "image/jpeg" });
  return {
    id: overrides.id ?? "file-1",
    file,
    objectUrl: "blob:mock-original",
    extension: "heic",
    detectedFormat: "heic",
    mimeType: "image/heic",
    extensionMismatch: false,
    status: {
      kind: "heic-done",
      result: {
        objectUrl: overrides.objectUrl ?? "blob:mock-converted",
        blob,
        jpegBytes,
        width: overrides.width ?? 800,
        height: overrides.height ?? 600,
      },
    },
  };
}

describe("ImageListItem — HEIC変換後のプレビュー/ダウンロード", () => {
  const noop = () => {};

  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("「JPGを確認」でプレビューダイアログが開き、正しいObject URLの画像が表示される", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    const trigger = screen.getByRole("button", { name: "JPGを確認" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "photo.heicのプレビュー" });
    expect(dialog).toBeInTheDocument();

    const img = dialog.querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:mock-converted");
  });

  it("プレビュー操作でページ遷移が発生しない(location.hrefが変化しない)", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);
    const hrefBefore = window.location.href;

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));

    expect(window.location.href).toBe(hrefBefore);
  });

  it("閉じるボタンでダイアログが閉じ、閉じた後も一覧の内容(ファイル名・変換結果)が残る", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
    fireEvent.click(screen.getByRole("button", { name: "プレビューを閉じる" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("photo.heic")).toBeInTheDocument();
    expect(screen.getByText("HEICを互換性の高いJPGへ変換しました")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
  });

  it("Escapeキーで閉じる", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;

    // ブラウザ実装によってはdialogのネイティブclose/cancelイベントが安定して発火しないため、
    // 実装はEscapeキー押下をdialog上のkeydownで検知してclosePreview()を直接呼ぶ。
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("背景(ダイアログ自身)のクリックで閉じる", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;

    // ダイアログ要素自身がクリックのtargetになる場合(=中身以外の背景部分)を模す
    fireEvent.click(dialog, { target: dialog });

    expect(dialog.open).toBe(false);
  });

  it("閉じた後、「JPGを確認」ボタンへフォーカスが戻る(閉じるボタン経由)", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    const trigger = screen.getByRole("button", { name: "JPGを確認" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "プレビューを閉じる" }));

    expect(document.activeElement).toBe(trigger);
  });

  it("閉じた後、「JPGを確認」ボタンへフォーカスが戻る(Escapeキー経由)", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    const trigger = screen.getByRole("button", { name: "JPGを確認" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(document.activeElement).toBe(trigger);
  });

  it("複数画像がある場合、クリックした画像だけがプレビューされる", () => {
    const itemA = createHeicDoneItem({
      id: "file-a",
      fileName: "a.heic",
      objectUrl: "blob:mock-a",
    });
    const itemB = createHeicDoneItem({
      id: "file-b",
      fileName: "b.heic",
      objectUrl: "blob:mock-b",
    });

    render(
      <ul>
        <ImageListItem item={itemA} onRemove={noop} messages={ja.ui} />
        <ImageListItem item={itemB} onRemove={noop} messages={ja.ui} />
      </ul>,
    );

    const triggers = screen.getAllByRole("button", { name: "JPGを確認" });
    fireEvent.click(triggers[1]); // b.heic側だけを開く

    const dialogs = screen.getAllByRole("dialog");
    const openDialogs = dialogs.filter((d) => (d as HTMLDialogElement).open);
    expect(openDialogs).toHaveLength(1);
    expect(openDialogs[0].querySelector("img")?.getAttribute("src")).toBe("blob:mock-b");
  });

  it("プレビューの開閉ではObject URLをrevokeしない", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
    fireEvent.click(screen.getByRole("button", { name: "プレビューを閉じる" }));

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("ダウンロードリンクにdownload/target/relが設定され、ファイル名が.jpgになる", () => {
    const item = createHeicDoneItem({ fileName: "IMG_1201.HEIC" });
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    const link = screen.getByRole("link", { name: "JPGをダウンロード" }) as HTMLAnchorElement;
    expect(link.getAttribute("download")).toBe("IMG_1201.jpg");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toBe("blob:mock-converted");
  });

  it("Web Share非対応環境では「JPGをダウンロード」だけが表示され、補足文は表示されない", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
    expect(screen.queryByText(/iPhone/)).not.toBeInTheDocument();
  });

  it("プレビュー・ダウンロード操作で画像が外部送信されない", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sendSpy = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);
    const appendSpy = vi.spyOn(FormData.prototype, "append");

    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
    fireEvent.click(screen.getByRole("button", { name: "プレビューを閉じる" }));
    fireEvent.click(screen.getByRole("link", { name: "JPGをダウンロード" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    const filePayloads = appendSpy.mock.calls.filter(([, value]) => value instanceof Blob);
    expect(filePayloads).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("背景スクロール抑制の解除は、空文字ではなく開く前の値へ復元する", () => {
    document.body.style.overflow = "scroll";
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "プレビューを閉じる" }));

    expect(document.body.style.overflow).toBe("scroll");

    document.body.style.overflow = "";
  });

  it("プレビュー表示中にアンマウントされても、開く前のoverflow値へ確実に戻る", () => {
    document.body.style.overflow = "scroll";
    const item = createHeicDoneItem();
    const { unmount } = render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.body.style.overflow).toBe("scroll");

    document.body.style.overflow = "";
  });

  it("プレビュー未表示のままアンマウントしても、overflowを不必要に上書きしない", () => {
    document.body.style.overflow = "auto";
    const item = createHeicDoneItem();
    const { unmount } = render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    unmount();

    expect(document.body.style.overflow).toBe("auto");

    document.body.style.overflow = "";
  });

  it("dialogが既にopenの状態で再度トリガーしても、showModal()は重複実行されず例外も発生しない", () => {
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);
    const trigger = screen.getByRole("button", { name: "JPGを確認" });

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    const showModalSpy = vi.spyOn(dialog, "showModal");

    expect(() => fireEvent.click(trigger)).not.toThrow();

    expect(showModalSpy).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });
});

interface MockShareOptions {
  canShare?: boolean;
  shareImpl?: (data: ShareData) => Promise<void>;
}

function mockShareSupport({ canShare = true, shareImpl }: MockShareOptions = {}) {
  const shareMock = vi.fn(shareImpl ?? (() => Promise.resolve()));
  const canShareMock = vi.fn(() => canShare);
  Object.defineProperty(navigator, "share", {
    value: shareMock,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "canShare", {
    value: canShareMock,
    configurable: true,
    writable: true,
  });
  return { shareMock, canShareMock };
}

function clearShareSupport() {
  // biome-ignore-line: navigator.share/canShareはjsdomの標準プロパティではなくテストで追加したもの
  delete (navigator as unknown as { share?: unknown }).share;
  delete (navigator as unknown as { canShare?: unknown }).canShare;
}

/**
 * このdescribeブロックはHEIC変換結果(主にiPhone/iPad由来)の保存導線を検証するため、
 * タッチ端末として扱う。非タッチ端末・端末判定自体の網羅的なテストはjpg-preview-and-save.test.tsxを参照。
 */
function mockTouchDevice() {
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 5,
    configurable: true,
  });
}

function clearTouchMock() {
  // biome-ignore-line: navigator.maxTouchPointsはjsdomの標準プロパティではなくテストで追加したもの
  delete (navigator as unknown as { maxTouchPoints?: unknown }).maxTouchPoints;
}

function abortError(): DOMException {
  return new DOMException("The user aborted a request.", "AbortError");
}

describe("ImageListItem — Web Share対応の保存導線(タッチ端末)", () => {
  const noop = () => {};

  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    mockTouchDevice();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearShareSupport();
    clearTouchMock();
  });

  it("共有対応環境: 「JPGを保存」ボタンが表示され、従来の主ダウンロードリンクは表示されない", () => {
    mockShareSupport();
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    expect(screen.getByRole("button", { name: "JPGを保存" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "JPGをダウンロード" })).not.toBeInTheDocument();
    expect(
      screen.getByText("iPhone・iPadでは「JPGを保存」から保存先を選択できます。"),
    ).toBeInTheDocument();
  });

  it("共有対応環境: navigator.shareが1回呼ばれ、JPEG Fileが1件だけtitle/text/url無しで渡される", () => {
    const { shareMock } = mockShareSupport();
    const item = createHeicDoneItem({ fileName: "IMG_1201.HEIC" });
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを保存" }));

    expect(shareMock).toHaveBeenCalledTimes(1);
    const shareData = shareMock.mock.calls[0][0] as ShareData;
    expect(Object.keys(shareData)).toEqual(["files"]);
    expect(shareData.files).toHaveLength(1);
    const sharedFile = shareData.files![0];
    expect(sharedFile.name).toBe("IMG_1201.jpg");
    expect(sharedFile.type).toBe("image/jpeg");
  });

  it("canShareがfalseの場合: 従来の「JPGをダウンロード」リンクが正しい属性で表示される", () => {
    mockShareSupport({ canShare: false });
    const item = createHeicDoneItem({ fileName: "IMG_1201.HEIC" });
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    expect(screen.queryByRole("button", { name: "JPGを保存" })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "JPGをダウンロード" }) as HTMLAnchorElement;
    expect(link.getAttribute("download")).toBe("IMG_1201.jpg");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toBe("blob:mock-converted");
  });

  it("navigator.canShareが例外を投げる場合: 共有非対応として扱い、従来のダウンロードリンクへ安全にフォールバックする", () => {
    Object.defineProperty(navigator, "share", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: () => {
        throw new Error("canShare implementation error");
      },
      configurable: true,
      writable: true,
    });
    const item = createHeicDoneItem({ fileName: "IMG_1201.HEIC" });
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    expect(screen.queryByRole("button", { name: "JPGを保存" })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "JPGをダウンロード" }) as HTMLAnchorElement;
    expect(link.getAttribute("download")).toBe("IMG_1201.jpg");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("navigator.shareがAbortErrorで拒否された場合: エラー表示せず、変換結果を維持し、Object URLを解放しない", async () => {
    mockShareSupport({ shareImpl: () => Promise.reject(abortError()) });
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを保存" }));

    // rejectハンドラの完了(マイクロタスク)を待ってから、エラー表示が出ないことを確認する
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText(/共有に失敗/)).not.toBeInTheDocument();
    expect(screen.getByText("HEICを互換性の高いJPGへ変換しました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JPGを保存" })).toBeInTheDocument();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("navigator.shareがその他のエラーで拒否された場合: エラー表示され、変換結果は残り、通常ダウンロードは引き続き使用できる", async () => {
    mockShareSupport({ shareImpl: () => Promise.reject(new Error("share failed")) });
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを保存" }));

    await screen.findByText("share failed");

    expect(screen.getByText("HEICを互換性の高いJPGへ変換しました")).toBeInTheDocument();
    // タッチ端末の副導線として常時表示されている「通常のダウンロード」がエラー後も使用できる
    const fallbackLink = screen.getByRole("link", {
      name: "通常のダウンロード",
    }) as HTMLAnchorElement;
    expect(fallbackLink.getAttribute("download")).toBe("photo.jpg");
    expect(fallbackLink.getAttribute("target")).toBe("_blank");
    expect(fallbackLink.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("保存操作後も一覧が残り、プレビューが引き続き開け、同じ画像を再度保存できる", async () => {
    const { shareMock } = mockShareSupport();
    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);

    fireEvent.click(screen.getByRole("button", { name: "JPGを保存" }));
    await vi.waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    expect(screen.getByText("photo.heic")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "プレビューを閉じる" }));

    fireEvent.click(screen.getByRole("button", { name: "JPGを保存" }));
    expect(shareMock).toHaveBeenCalledTimes(2);
  });

  it("保存処理はページ遷移・window.open・履歴変更・外部通信を行わない", () => {
    const { shareMock } = mockShareSupport();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sendSpy = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);

    const hrefBefore = window.location.href;
    const historyLengthBefore = window.history.length;

    const item = createHeicDoneItem();
    render(<ImageListItem item={item} onRemove={noop} messages={ja.ui} />);
    fireEvent.click(screen.getByRole("button", { name: "JPGを保存" }));

    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe(hrefBefore);
    expect(window.history.length).toBe(historyLengthBefore);
    expect(openSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("ImageListItem — 長いファイル名", () => {
  afterEach(() => {
    cleanup();
  });

  it("長いファイル名は省略されず全文表示され、折り返し用クラスが付与される", () => {
    const longName =
      "とても長いファイル名のサンプル-2024-01-15-旅行の写真-海と山と空-スマートフォンで撮影したもの.jpg";
    const item = createHeicDoneItem({ fileName: longName });
    render(<ImageListItem item={item} onRemove={vi.fn()} messages={ja.ui} />);

    const nameEl = screen.getByText(longName);
    expect(nameEl).toBeInTheDocument();
    expect(nameEl.className).toContain("image-list-item__name");
  });
});
