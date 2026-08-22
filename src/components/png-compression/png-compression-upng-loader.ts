import { UpngLoadError, type UpngEncodeFunction } from "./png-compression-types";

/**
 * @upng/upng-js@2.2.2は、フィルタ後の生ピクセルバッファが1,000万byteを超える場合のみ
 * `window.UZIP`という(存在しない)グローバル変数を参照する経路を通り、windowが定義されて
 * いない環境(Dedicated Workerがまさにこれに該当する)で`ReferenceError`となる
 * (spike/png-target-compressionの実証で確認済み)。
 *
 * この互換処理はDedicated Worker内でのみ行う(メインスレッドのwindowを書き換えることは
 * 絶対にしない)。`!workerGlobal.window`の条件により、メインスレッド(windowが常に存在する)
 * では何もせず、windowが存在しない環境(Worker/Node)でのみ`globalThis`をwindowとして
 * 割り当てる。UPNG自体はwindow.UZIPを実際には使わない(存在すればそちらを使うだけの
 * 任意の高速化経路であり、undefinedでも`null!=window.UZIP`がfalseになりpakoへ
 * フォールバックする)ため、この割り当ては安全である。
 *
 * UPNGの読み込みは動的import・かつPNG処理を実際に開始するタイミング(元ファイルそのまま返却の
 * 判定より後)まで遅延する。呼び出し元(png-compression.worker.ts)がこの遅延を担保する。
 *
 * この関数はself.onmessageの副作用を持たない独立したモジュールに置くことで、
 * Worker全体を経由せず単体で(Node環境でも)テストできるようにしている。
 */
export async function loadUpngEncode(): Promise<UpngEncodeFunction> {
  // `window`をunknown型として扱うことで、lib.domが宣言する`Window & typeof globalThis`との
  // 型不整合を避ける(この関数の目的はUPNG内部のwindow.UZIP参照が例外を投げないようにする
  // ことだけであり、実際のWindow型としての機能を提供する必要はない)。
  const workerGlobal = globalThis as unknown as { window?: unknown };
  if (!workerGlobal.window) {
    workerGlobal.window = globalThis;
  }

  try {
    const upng = await import("@upng/upng-js/dist/UPNG.esm.js");
    const encode = upng.default.encode;
    return (imgs, w, h, cnum) => encode(imgs, w, h, cnum);
  } catch (error) {
    throw new UpngLoadError(error);
  }
}

export function getRgbaAtSize(bitmap: ImageBitmap, width: number, height: number): ArrayBuffer {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvasの2Dコンテキストを取得できませんでした");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return imageData.data.buffer as ArrayBuffer;
}
