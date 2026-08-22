import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageDropZone } from "./image-drop-zone";
import { ja } from "../../i18n/dictionaries/ja";

describe("ImageDropZone", () => {
  afterEach(() => {
    cleanup();
  });

  it("既定では汎用の対応形式ヒントを表示する", () => {
    render(<ImageDropZone messages={ja.ui.dropZone} onFiles={vi.fn()} />);
    expect(screen.getByText(/対応形式: JPG, PNG, WebP, HEIC\/HEIF/)).toBeInTheDocument();
    expect(screen.getByText(/複数選択可/)).toBeInTheDocument();
  });

  it("formatsHintを渡すとページ固有の対応形式が表示される(inputのaccept属性は変わらない)", () => {
    render(<ImageDropZone messages={ja.ui.dropZone} onFiles={vi.fn()} formatsHint="HEIC・HEIF" />);
    expect(screen.getByText("対応形式: HEIC・HEIF(複数選択可)")).toBeInTheDocument();

    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    expect(input.accept).toContain("image/jpeg");
    expect(input.accept).toContain("image/heic");
  });

  it("acceptを渡すとinputのaccept属性が上書きされる(PNG専用ページ等)", () => {
    render(<ImageDropZone messages={ja.ui.dropZone} onFiles={vi.fn()} accept="image/png,.png" />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    expect(input.accept).toBe("image/png,.png");
    expect(input.accept).not.toContain("image/jpeg");
  });

  it("acceptを省略した場合は既存の全形式共通値のままになる(既存呼び出し元への影響なし)", () => {
    render(<ImageDropZone messages={ja.ui.dropZone} onFiles={vi.fn()} />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    expect(input.accept).toContain("image/jpeg");
    expect(input.accept).toContain("image/png");
    expect(input.accept).toContain("image/webp");
    expect(input.accept).toContain("image/heic");
    expect(input.accept).toContain("image/heif");
  });

  it("クリックで選択できることがラベル+input(type=file)の関連付けで示される", () => {
    render(<ImageDropZone messages={ja.ui.dropZone} onFiles={vi.fn()} />);
    const input = screen.getByLabelText(/画像を選択、またはここにドラッグ&ドロップ/);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("multiple");
  });

  it("ファイル選択でonFilesが呼ばれ、同じファイルを再選択できるようinputがリセットされる", () => {
    const onFiles = vi.fn();
    render(<ImageDropZone messages={ja.ui.dropZone} onFiles={onFiles} />);
    const input = screen.getByLabelText(/画像を選択/) as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
  });

  it("ドラッグ中は状態を示すクラスが付与され、ドロップで解除される", () => {
    const onFiles = vi.fn();
    const { container } = render(<ImageDropZone messages={ja.ui.dropZone} onFiles={onFiles} />);
    const dropZone = container.querySelector(".image-drop-zone") as HTMLElement;

    expect(dropZone.className).not.toContain("image-drop-zone--active");

    fireEvent.dragOver(dropZone);
    expect(dropZone.className).toContain("image-drop-zone--active");

    fireEvent.dragLeave(dropZone);
    expect(dropZone.className).not.toContain("image-drop-zone--active");
  });

  it("ドロップされたファイルでonFilesが呼ばれ、ドラッグ状態が解除される", () => {
    const onFiles = vi.fn();
    const { container } = render(<ImageDropZone messages={ja.ui.dropZone} onFiles={onFiles} />);
    const dropZone = container.querySelector(".image-drop-zone") as HTMLElement;
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });

    fireEvent.dragOver(dropZone);
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(dropZone.className).not.toContain("image-drop-zone--active");
  });
});
