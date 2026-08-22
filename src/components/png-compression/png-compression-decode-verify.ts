import { DECODE_SAFETY_LIMITS, validateDeclaredDimensions } from "../image-intake/decode-safety";
import { PNG_MIME_TYPE } from "./png-compression-types";
import { TimeoutError, withTimeout } from "./png-compression-timeout";

export type PngDecodeVerification =
  | { status: "ok"; bitmap: ImageBitmap }
  | { status: "timeout" }
  | { status: "decode-failed" }
  | { status: "dimension-mismatch" }
  | { status: "unsafe-dimensions" }
  | { status: "invalid-mime" };

/**
 * PNGバイト列を実際にcreateImageBitmapでデコードし、期待した寸法と一致するか、
 * decode safety上限内かを確認する。§5(入力デコード検証)・§6(最終出力再デコード)の
 * 両方から共通で使う。
 *
 * `requireMimeCheck`はtrueの場合のみ、Blobを明示的に`image/png`で構築しその`type`を確認する
 * (§6の最終出力検証専用。§5の入力検証では既にstrict PNG parserでsignature等を確認済みのため
 * 必須ではないが、渡す側の一貫性のためオプションとして残す)。
 *
 * 戻り値が"ok"の場合、呼び出し側が責任を持って`bitmap.close()`を呼ぶこと。
 */
export async function verifyPngDecodable(
  buffer: ArrayBuffer,
  expectedWidth: number,
  expectedHeight: number,
  timeBudgetMs: number,
  requireMimeCheck = false,
): Promise<PngDecodeVerification> {
  if (timeBudgetMs <= 0) return { status: "timeout" };

  if (requireMimeCheck) {
    const blob = new Blob([buffer], { type: PNG_MIME_TYPE });
    if (blob.type !== PNG_MIME_TYPE) return { status: "invalid-mime" };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await withTimeout(
      createImageBitmap(new Blob([buffer], { type: PNG_MIME_TYPE }), {
        imageOrientation: "from-image",
      }),
      timeBudgetMs,
    );
  } catch (error) {
    if (error instanceof TimeoutError) return { status: "timeout" };
    return { status: "decode-failed" };
  }

  if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
    bitmap.close();
    return { status: "dimension-mismatch" };
  }

  const safetyError = validateDeclaredDimensions(
    { width: bitmap.width, height: bitmap.height },
    DECODE_SAFETY_LIMITS,
  );
  if (safetyError) {
    bitmap.close();
    return { status: "unsafe-dimensions" };
  }

  return { status: "ok", bitmap };
}
