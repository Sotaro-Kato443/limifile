import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompressTargetInput } from "./compress-target-input";
import { ja } from "../../i18n/dictionaries/ja";

describe("CompressTargetInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("プリセット(100KB/200KB/500KB/1MB/2MB)が表示される", () => {
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={vi.fn()} />);
    for (const label of ["100KB", "200KB", "500KB", "1MB", "2MB"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("KBの定義に関する注記が表示される", () => {
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={vi.fn()} />);
    expect(screen.getByText("1KB=1,000バイトとして計算しています")).toBeInTheDocument();
  });

  it("値と単位を入力し、圧縮するボタンでonCompressが呼ばれる(値変更だけでは呼ばれない)", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "500" } });
    expect(onCompress).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(onCompress).toHaveBeenCalledTimes(1);
    expect(onCompress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 500_000 }));
  });

  it("小数入力を許可する", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("容量の単位"), { target: { value: "MB" } });
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(onCompress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 1_500_000 }));
  });

  it("空欄ではエラーを表示し、onCompressは呼ばれない", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(screen.getByText("目標容量を入力してください")).toBeInTheDocument();
    expect(onCompress).not.toHaveBeenCalled();
  });

  it("0はエラーになる", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(screen.getByText("0より大きい値を入力してください")).toBeInTheDocument();
    expect(onCompress).not.toHaveBeenCalled();
  });

  it("負数はエラーになる", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(screen.getByText("0より大きい値を入力してください")).toBeInTheDocument();
  });

  it("数値でない入力はエラーになる", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(screen.getByText("数値を入力してください")).toBeInTheDocument();
  });

  it("最小値(10KB)未満はエラーになる", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(screen.getByText("10KB以上を指定してください")).toBeInTheDocument();
  });

  it("最大値(50MB)を超えるとエラーになる", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "51" } });
    fireEvent.change(screen.getByLabelText("容量の単位"), { target: { value: "MB" } });
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(screen.getByText("50MB以下を指定してください")).toBeInTheDocument();
  });

  it("プリセットをクリックすると値と単位が反映される", () => {
    const onCompress = vi.fn();
    render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

    fireEvent.click(screen.getByRole("button", { name: "1MB" }));
    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(onCompress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 1_000_000 }));
  });

  it("/compress-image-to-500kbの初期値(defaultValue=500, defaultUnit=KB)を反映できる", () => {
    const onCompress = vi.fn();
    render(
      <CompressTargetInput
        messages={ja.ui.compressionPanel}
        defaultValue={500}
        defaultUnit="KB"
        onCompress={onCompress}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

    expect(onCompress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 500_000 }));
  });

  it("disabled指定時は入力・プリセット・ボタンが無効化される", () => {
    render(<CompressTargetInput messages={ja.ui.compressionPanel} disabled onCompress={vi.fn()} />);

    expect(screen.getByLabelText("目標容量")).toBeDisabled();
    expect(screen.getByRole("button", { name: "500KB" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "圧縮する" })).toBeDisabled();
  });

  describe("onTargetChange", () => {
    it("未指定でも既存の挙動(onCompressの呼び出し等)は変わらない", () => {
      const onCompress = vi.fn();
      render(<CompressTargetInput messages={ja.ui.compressionPanel} onCompress={onCompress} />);

      fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "500" } });
      fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

      expect(onCompress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 500_000 }));
    });

    it("数値入力を変更すると呼ばれる", () => {
      const onTargetChange = vi.fn();
      render(
        <CompressTargetInput
          messages={ja.ui.compressionPanel}
          onCompress={vi.fn()}
          onTargetChange={onTargetChange}
        />,
      );

      fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "500" } });

      expect(onTargetChange).toHaveBeenCalledTimes(1);
    });

    it("同じ値を再入力しても呼ばれない", () => {
      const onTargetChange = vi.fn();
      render(
        <CompressTargetInput
          messages={ja.ui.compressionPanel}
          defaultValue={500}
          defaultUnit="KB"
          onCompress={vi.fn()}
          onTargetChange={onTargetChange}
        />,
      );

      fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "500" } });

      expect(onTargetChange).not.toHaveBeenCalled();
    });

    it("単位(KB/MB)を変更すると呼ばれる", () => {
      const onTargetChange = vi.fn();
      render(
        <CompressTargetInput
          messages={ja.ui.compressionPanel}
          onCompress={vi.fn()}
          onTargetChange={onTargetChange}
        />,
      );

      fireEvent.change(screen.getByLabelText("容量の単位"), { target: { value: "MB" } });

      expect(onTargetChange).toHaveBeenCalledTimes(1);
    });

    it("同じ単位を選び直しても呼ばれない", () => {
      const onTargetChange = vi.fn();
      render(
        <CompressTargetInput
          messages={ja.ui.compressionPanel}
          onCompress={vi.fn()}
          onTargetChange={onTargetChange}
        />,
      );

      fireEvent.change(screen.getByLabelText("容量の単位"), { target: { value: "KB" } });

      expect(onTargetChange).not.toHaveBeenCalled();
    });

    it("値の異なるプリセットをクリックすると呼ばれる", () => {
      const onTargetChange = vi.fn();
      render(
        <CompressTargetInput
          messages={ja.ui.compressionPanel}
          onCompress={vi.fn()}
          onTargetChange={onTargetChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "1MB" }));

      expect(onTargetChange).toHaveBeenCalledTimes(1);
    });

    it("既に選択中と同じ値・単位のプリセットを再クリックしても呼ばれない", () => {
      const onTargetChange = vi.fn();
      render(
        <CompressTargetInput
          messages={ja.ui.compressionPanel}
          defaultValue={500}
          defaultUnit="KB"
          onCompress={vi.fn()}
          onTargetChange={onTargetChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "500KB" }));

      expect(onTargetChange).not.toHaveBeenCalled();
    });

    it("圧縮するボタンのクリック自体では呼ばれない", () => {
      const onTargetChange = vi.fn();
      render(
        <CompressTargetInput
          messages={ja.ui.compressionPanel}
          onCompress={vi.fn()}
          onTargetChange={onTargetChange}
        />,
      );

      fireEvent.input(screen.getByLabelText("目標容量"), { target: { value: "500" } });
      onTargetChange.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "圧縮する" }));

      expect(onTargetChange).not.toHaveBeenCalled();
    });
  });
});
