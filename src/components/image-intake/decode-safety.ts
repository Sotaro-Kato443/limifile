import type { DeclaredDimensions } from "./image-header-dimensions";

export interface DecodeSafetyLimits {
  /** これを超える辺(幅・高さいずれか)を持つ画像は安全側でデコードを拒否する */
  maxDimension: number;
  /** これを超える総ピクセル数(width*height)を持つ画像は安全側でデコードを拒否する */
  maxPixels: number;
}

/**
 * createImageBitmap等の実デコード前に拒否する寸法の上限。
 *
 * maxDimension=16384: iPhoneのパノラマ写真はApple公称で最大約12,032×5,312px(約63.9MP)に達するため、
 * その辺長に十分な余裕(約36%)を持たせつつ、Chrome/Firefox/Safari各ブラウザで広く安全に扱えるとされる
 * Canvas/WebGLテクスチャの辺長上限(一般に16,384px以上)を超えない値として選定した。
 *
 * maxPixels=67,108,864(64MiB相当のpx数、2^26): 想定しているiPhoneパノラマ(約63.9MP)を引き続き通しつつ、
 * デコード後の生ピクセルバッファ(RGBA=1px当たり4byte)の理論値をちょうど256MiB(67,108,864×4)に抑える
 * きりの良い値として選定した。旧設定の100,000,000px(約381MiB)よりも安全側であり、
 * さらにcreateImageBitmapが返すImageBitmapとエンコード用OffscreenCanvasの両方を同時に保持する
 * (=同種のバッファを2つ同時に抱える)本アプリの処理構造を踏まえても、モバイルSafari等の
 * 限られたタブメモリ予算内に収まりやすい水準とした。
 * なお16,384×16,384(正方形に近い最大辺同士の組み合わせ)は約2.68億pxとなり、この上限を大きく上回るため、
 * 縦横比が1に近い極端に巨大な画像は本上限(総ピクセル数)側で拒否される設計になっている。
 */
export const DECODE_SAFETY_LIMITS: DecodeSafetyLimits = {
  maxDimension: 16384,
  maxPixels: 67_108_864,
};

export type DecodeSafetyErrorCode =
  "missing-dimensions" | "invalid-dimensions" | "dimension-too-large" | "pixel-count-too-large";

/** ユーザー向けの固定文言。内部エラーコード(DecodeSafetyErrorCode)は別途保持し、画面には出さない */
export const UNSAFE_DIMENSIONS_MESSAGE =
  "画像のサイズが大きすぎるため、安全に処理できませんでした。";

/**
 * ヘッダーから読み取った宣言寸法を検証する。
 * width>0・height>0・最大辺・最大総ピクセル数を確認する。
 * オーバーフロー防止のため、両辺がmaxDimension以下であることを確認してから
 * width*heightを計算する(先に個別の辺を確認せず乗算すると、ヘッダーが宣言する
 * 未検証の巨大な値同士の積を扱うことになるため、必ずこの順序で検証する)。
 */
export function validateDeclaredDimensions(
  dimensions: DeclaredDimensions | null,
  limits: DecodeSafetyLimits = DECODE_SAFETY_LIMITS,
): DecodeSafetyErrorCode | null {
  if (!dimensions) return "missing-dimensions";

  const { width, height } = dimensions;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "invalid-dimensions";
  }

  if (width > limits.maxDimension || height > limits.maxDimension) {
    return "dimension-too-large";
  }

  if (width * height > limits.maxPixels) {
    return "pixel-count-too-large";
  }

  return null;
}

/**
 * ヘッダーの宣言寸法と実デコード後の寸法を比較する。EXIF Orientation(5〜8)による
 * 90度回転で幅と高さが入れ替わるケースを誤検出しないよう、入れ替わりは許容する。
 */
export function dimensionsRoughlyMatch(
  declared: DeclaredDimensions,
  actualWidth: number,
  actualHeight: number,
): boolean {
  return (
    (declared.width === actualWidth && declared.height === actualHeight) ||
    (declared.width === actualHeight && declared.height === actualWidth)
  );
}
