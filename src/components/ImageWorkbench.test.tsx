import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageWorkbench } from "./ImageWorkbench";

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const WEBP_BYTES = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
// ftypボックスを模した未対応形式のテスト用バイト列。JPEG/PNG/WebPいずれのシグネチャにも一致しない
const UNSUPPORTED_BYTES = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];

function createFile(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

/**
 * jsdomは実際の画像読み込みを行わないため、Imageのonload/onerrorが発火しない。
 * テスト内でのみImageをスタブし、モジュール変数`nextImageShouldFail`で成功/失敗を切り替える。
 */
let nextImageShouldFail = false;

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 600;

  set src(_value: string) {
    const shouldFail = nextImageShouldFail;
    queueMicrotask(() => {
      if (shouldFail) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    });
  }
}

describe("ImageWorkbench", () => {
  let revokeSpy: ReturnType<typeof vi.spyOn>;
  let urlCounter: number;

  beforeEach(() => {
    urlCounter = 0;
    nextImageShouldFail = false;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:mock-${++urlCounter}`);
    revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("Image", StubImage);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("ファイル形式ごとの解析結果", () => {
    it("正常なJPEGは寸法付きで解析完了する", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

      await waitFor(() => {
        expect(screen.getByText(/800×600px/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/未対応の形式です/)).not.toBeInTheDocument();
    });

    it("正常なPNGは寸法付きで解析完了する", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(PNG_BYTES, "photo.png", "image/png")]);

      await waitFor(() => {
        expect(screen.getByText(/800×600px/)).toBeInTheDocument();
      });
    });

    it("正常なWebPは寸法付きで解析完了する", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(WEBP_BYTES, "photo.webp", "image/webp")]);

      await waitFor(() => {
        expect(screen.getByText(/800×600px/)).toBeInTheDocument();
      });
    });

    it("破損ファイル(デコード失敗)は個別にエラー表示され、他のファイルの解析を止めない", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;

      nextImageShouldFail = true;
      selectFiles(input, [createFile(JPEG_BYTES, "broken.jpg", "image/jpeg")]);

      await waitFor(() => {
        expect(
          screen.getByText("この画像を解析できませんでした。別のファイルでお試しください。"),
        ).toBeInTheDocument();
      });

      nextImageShouldFail = false;
      selectFiles(input, [createFile(JPEG_BYTES, "ok.jpg", "image/jpeg")]);

      await waitFor(() => {
        expect(screen.getByText(/800×600px/)).toBeInTheDocument();
      });
      expect(
        screen.getByText("この画像を解析できませんでした。別のファイルでお試しください。"),
      ).toBeInTheDocument();
    });

    it("拡張子と実形式が異なるファイルは警告表示になる", async () => {
      const { container } = render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(PNG_BYTES, "photo.jpg", "image/jpeg")]);

      await waitFor(() => {
        const warning = container.querySelector(".image-list-item__warning");
        expect(warning).not.toBeNull();
        expect(warning?.textContent).toContain("拡張子(.jpg)");
        expect(warning?.textContent).toContain("PNG");
        expect(warning?.textContent).toContain("が一致しません");
      });
    });

    it("未対応形式は個別にエラー表示され、他のファイルの解析を止めない", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;

      selectFiles(input, [
        createFile(UNSUPPORTED_BYTES, "photo.heic", "image/heic"),
        createFile(JPEG_BYTES, "photo.jpg", "image/jpeg"),
      ]);

      await waitFor(() => {
        expect(screen.getByText(/未対応の形式です/)).toBeInTheDocument();
        expect(screen.getByText(/800×600px/)).toBeInTheDocument();
      });
    });
  });

  describe("Object URLのライフサイクル", () => {
    it("ファイルを個別削除すると、そのファイルのObject URLのみ解放される", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(JPEG_BYTES, "a.jpg", "image/jpeg"),
        createFile(JPEG_BYTES, "b.jpg", "image/jpeg"),
      ]);

      await waitFor(() => {
        expect(screen.getByText("a.jpg")).toBeInTheDocument();
        expect(screen.getByText("b.jpg")).toBeInTheDocument();
      });

      expect(revokeSpy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "a.jpgを削除" }));

      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledWith("blob:mock-1");
      expect(screen.queryByText("a.jpg")).not.toBeInTheDocument();
      expect(screen.getByText("b.jpg")).toBeInTheDocument();
    });

    it("すべて削除すると、選択中の全ファイルのObject URLが解放される", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(JPEG_BYTES, "a.jpg", "image/jpeg"),
        createFile(JPEG_BYTES, "b.jpg", "image/jpeg"),
      ]);

      await waitFor(() => {
        expect(screen.getByText("a.jpg")).toBeInTheDocument();
        expect(screen.getByText("b.jpg")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));

      expect(revokeSpy).toHaveBeenCalledTimes(2);
      expect(revokeSpy).toHaveBeenCalledWith("blob:mock-1");
      expect(revokeSpy).toHaveBeenCalledWith("blob:mock-2");
    });

    it("コンポーネントのアンマウント時に、残っている全ファイルのObject URLが解放される", async () => {
      const { unmount } = render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [
        createFile(JPEG_BYTES, "a.jpg", "image/jpeg"),
        createFile(JPEG_BYTES, "b.jpg", "image/jpeg"),
      ]);

      await waitFor(() => {
        expect(screen.getByText("a.jpg")).toBeInTheDocument();
        expect(screen.getByText("b.jpg")).toBeInTheDocument();
      });

      expect(revokeSpy).not.toHaveBeenCalled();

      unmount();

      expect(revokeSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("最低限のアクセシビリティ", () => {
    it("画像選択操作はlabelと関連付けられた実在のinputを通じてキーボード操作可能である", () => {
      render(<ImageWorkbench locale="ja" />);
      // getByLabelTextはlabelとinputの関連付け(for/id)が正しくないと失敗するため、
      // このクエリが成功すること自体がキーボードでの発見可能性を裏付ける
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      expect(input.tagName).toBe("INPUT");
      expect(input.getAttribute("type")).toBe("file");
      expect(input).not.toHaveAttribute("hidden");
      expect(input.tabIndex).not.toBe(-1);
    });

    it("削除ボタンに対象ファイル名を含むアクセシブルなラベルがある", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(JPEG_BYTES, "sample.jpg", "image/jpeg")]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "sample.jpgを削除" })).toBeInTheDocument();
      });
    });

    it("未対応形式のエラーは色やアイコンのみに頼らずテキストとして表示される", async () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(UNSUPPORTED_BYTES, "photo.heic", "image/heic")]);

      await waitFor(() => {
        const status = screen.getByText(/未対応の形式です/);
        expect(status.textContent).toContain("未対応の形式です");
        expect(status).not.toHaveAttribute("aria-hidden");
      });
    });

    it("解析中の状態もテキストとして表示される", () => {
      render(<ImageWorkbench locale="ja" />);
      const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
      selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);

      // 解析完了前の一瞬は「解析中…」がテキストとして存在する
      expect(screen.getByText("解析中…")).toBeInTheDocument();
    });
  });

  describe("locale=en", () => {
    it("英語文言でレンダーされ、既存の日本語UI文言が残らない", async () => {
      const { container } = render(<ImageWorkbench locale="en" />);
      expect(screen.getByText("Select an image, or drag and drop it here")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Your images are processed on this device and are never sent to a server.",
        ),
      ).toBeInTheDocument();

      const input = screen.getByLabelText(/Select an image/) as HTMLInputElement;
      selectFiles(input, [createFile(JPEG_BYTES, "photo.jpg", "image/jpeg")]);
      await waitFor(() => {
        expect(screen.getByText(/800×600px/)).toBeInTheDocument();
      });

      const text = container.textContent ?? "";
      expect(text).not.toContain("画像を選択、またはここにドラッグ&ドロップ");
      expect(text).not.toContain("画像はこの端末内で処理され");
      expect(text).not.toContain("解析中");
      expect(text).not.toContain("削除");
    });
  });
});
