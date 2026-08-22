import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePreviewAndSave, type PreviewFormatLabel } from "./image-preview-and-save";
import { ja } from "../../i18n/dictionaries/ja";

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

function mockTouch(isTouch: boolean) {
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: isTouch ? 5 : 0,
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

function renderComponent(
  overrides: { blob?: Blob; formatLabel?: PreviewFormatLabel; outputFileName?: string } = {},
) {
  const blob = overrides.blob ?? new Blob([new Uint8Array(8)], { type: "image/jpeg" });
  const formatLabel = overrides.formatLabel ?? "JPG";
  render(
    <ImagePreviewAndSave
      fileName="photo.jpg"
      objectUrl="blob:mock-converted"
      blob={blob}
      outputFileName={overrides.outputFileName ?? "photo.jpg"}
      width={800}
      height={600}
      formatLabel={formatLabel}
      messages={ja.ui.previewAndSave}
    />,
  );
  return { blob };
}

describe("ImagePreviewAndSave — 保存/共有導線(JPG)", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearShareSupport();
    clearTouchMock();
  });

  describe("非タッチ・Web Share対応", () => {
    beforeEach(() => {
      mockTouch(false);
      mockShareSupport();
    });

    it("「JPGをダウンロード」が主導線として表示され、「JPGを保存」ボタンは表示されない", () => {
      renderComponent();
      expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "JPGを保存" })).not.toBeInTheDocument();
    });

    it("「共有」ボタンが副導線として表示される", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "共有" })).toBeInTheDocument();
    });

    it("主ダウンロードリンクの属性が正しい", () => {
      renderComponent();
      const link = screen.getByRole("link", { name: "JPGをダウンロード" }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("blob:mock-converted");
      expect(link.getAttribute("download")).toBe("photo.jpg");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("補足文が表示される", () => {
      renderComponent();
      expect(
        screen.getByText("保存先はブラウザのダウンロード設定に従います。"),
      ).toBeInTheDocument();
    });
  });

  describe("タッチ・Web Share対応", () => {
    beforeEach(() => {
      mockTouch(true);
      mockShareSupport();
    });

    it("「JPGを保存」が主ボタンとして表示される", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "JPGを保存" })).toBeInTheDocument();
    });

    it("「JPGを保存」クリックでnavigator.shareが呼ばれる(files/title/text/urlの内容も確認)", () => {
      const { shareMock } = mockShareSupport();
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "JPGを保存" }));

      expect(shareMock).toHaveBeenCalledTimes(1);
      const shareData = shareMock.mock.calls[0][0] as ShareData;
      expect(Object.keys(shareData)).toEqual(["files"]);
      expect(shareData.files).toHaveLength(1);
      expect(shareData.files![0].type).toBe("image/jpeg");
    });

    it("「通常のダウンロード」が副導線として表示される", () => {
      renderComponent();
      expect(screen.getByRole("link", { name: "通常のダウンロード" })).toBeInTheDocument();
    });

    it("通常ダウンロードリンクの属性が正しい", () => {
      renderComponent();
      const link = screen.getByRole("link", { name: "通常のダウンロード" }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("blob:mock-converted");
      expect(link.getAttribute("download")).toBe("photo.jpg");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("補足文が表示される", () => {
      renderComponent();
      expect(
        screen.getByText("iPhone・iPadでは「JPGを保存」から保存先を選択できます。"),
      ).toBeInTheDocument();
    });
  });

  describe("非タッチ・Web Share非対応", () => {
    beforeEach(() => {
      mockTouch(false);
    });

    it("「JPGをダウンロード」のみ表示される", () => {
      renderComponent();
      expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "JPGを保存" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "共有" })).not.toBeInTheDocument();
    });
  });

  describe("タッチ・Web Share非対応", () => {
    beforeEach(() => {
      mockTouch(true);
    });

    it("通常の「JPGをダウンロード」が表示され、共有ボタンは表示されない", () => {
      renderComponent();
      expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "JPGを保存" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "共有" })).not.toBeInTheDocument();
    });

    it("canShareが例外を投げる場合も安全に「JPGをダウンロード」へフォールバックする", () => {
      mockTouch(true);
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
      renderComponent();
      expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "JPGを保存" })).not.toBeInTheDocument();
    });
  });

  describe("navigator.maxTouchPointsによる判定", () => {
    it("maxTouchPoints > 0ならタッチ端末として扱われる(JPGを保存が主ボタン)", () => {
      mockTouch(true);
      mockShareSupport();
      renderComponent();
      expect(screen.getByRole("button", { name: "JPGを保存" })).toBeInTheDocument();
    });
  });

  describe("matchMedia(pointer: coarse)による判定", () => {
    it("maxTouchPointsが0でもmatchMedia(pointer: coarse)がtrueならタッチ端末として扱われる", () => {
      Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: true }) as MediaQueryList),
      );
      mockShareSupport();
      renderComponent();
      expect(screen.getByRole("button", { name: "JPGを保存" })).toBeInTheDocument();
      vi.unstubAllGlobals();
    });
  });

  describe("matchMediaが存在しない環境", () => {
    it("例外にならず、非タッチとして扱われる", () => {
      Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
      vi.stubGlobal("matchMedia", undefined);
      mockShareSupport();
      expect(() => renderComponent()).not.toThrow();
      expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "JPGを保存" })).not.toBeInTheDocument();
      vi.unstubAllGlobals();
    });
  });

  describe("「共有」を押した場合(非タッチ・副ボタン)", () => {
    beforeEach(() => {
      mockTouch(false);
    });

    it("JPEG Fileだけが渡され、title/text/urlは含まれない", () => {
      const { shareMock } = mockShareSupport();
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "共有" }));

      const shareData = shareMock.mock.calls[0][0] as ShareData;
      expect(Object.keys(shareData)).toEqual(["files"]);
    });

    it("ページ遷移が発生しない", () => {
      mockShareSupport();
      renderComponent();
      const hrefBefore = window.location.href;
      fireEvent.click(screen.getByRole("button", { name: "共有" }));
      expect(window.location.href).toBe(hrefBefore);
    });

    it("AbortErrorの場合はエラー表示せず、結果(ダウンロードリンク等)が残る", async () => {
      mockShareSupport({ shareImpl: () => Promise.reject(abortError()) });
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "共有" }));

      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByText(/共有に失敗/)).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
    });

    it("その他のエラーの場合は簡潔なエラーを表示し、通常ダウンロードは引き続き使用できる", async () => {
      mockShareSupport({ shareImpl: () => Promise.reject(new Error("share failed")) });
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "共有" }));

      await screen.findByText("share failed");

      const link = screen.getByRole("link", { name: "JPGをダウンロード" }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("blob:mock-converted");
    });
  });

  describe("ダウンロードを押した場合", () => {
    it("クリック直後にObject URLをrevokeしない(非タッチ・共有非対応)", () => {
      mockTouch(false);
      renderComponent();
      fireEvent.click(screen.getByRole("link", { name: "JPGをダウンロード" }));
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      expect(screen.getByRole("link", { name: "JPGをダウンロード" })).toBeInTheDocument();
    });

    it("クリック直後にObject URLをrevokeしない(タッチ・共有対応の副導線)", () => {
      mockTouch(true);
      mockShareSupport();
      renderComponent();
      fireEvent.click(screen.getByRole("link", { name: "通常のダウンロード" }));
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      expect(screen.getByRole("link", { name: "通常のダウンロード" })).toBeInTheDocument();
    });
  });

  describe("プレビュー", () => {
    it("端末・共有対応にかかわらず「JPGを確認」でプレビューが開ける", () => {
      mockTouch(true);
      mockShareSupport();
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "JPGを確認" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});

describe("ImagePreviewAndSave — formatLabel=WebPの文言出し分け", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearShareSupport();
    clearTouchMock();
  });

  it("非タッチ・共有対応: 「WebPをダウンロード」「共有」が表示される", () => {
    mockTouch(false);
    mockShareSupport();
    renderComponent({
      formatLabel: "WebP",
      blob: new Blob([new Uint8Array(8)], { type: "image/webp" }),
      outputFileName: "photo-compressed.webp",
    });
    expect(screen.getByRole("link", { name: "WebPをダウンロード" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "共有" })).toBeInTheDocument();
  });

  it("タッチ・共有対応: 「WebPを保存」が主ボタンとして表示され、共有ファイルのMIMEはimage/webp", () => {
    mockTouch(true);
    const { shareMock } = mockShareSupport();
    renderComponent({
      formatLabel: "WebP",
      blob: new Blob([new Uint8Array(8)], { type: "image/webp" }),
      outputFileName: "photo-compressed.webp",
    });
    expect(screen.getByRole("button", { name: "WebPを保存" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "WebPを保存" }));
    const shareData = shareMock.mock.calls[0][0] as ShareData;
    expect(shareData.files![0].type).toBe("image/webp");
  });

  it("「WebPを確認」でプレビューが開ける", () => {
    mockTouch(false);
    renderComponent({ formatLabel: "WebP" });
    fireEvent.click(screen.getByRole("button", { name: "WebPを確認" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("タッチ端末の補足文にも「WebPを保存」が使われる", () => {
    mockTouch(true);
    mockShareSupport();
    renderComponent({ formatLabel: "WebP" });
    expect(
      screen.getByText("iPhone・iPadでは「WebPを保存」から保存先を選択できます。"),
    ).toBeInTheDocument();
  });
});
