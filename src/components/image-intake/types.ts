export type SupportedImageFormat = "jpeg" | "png" | "webp" | "heic" | "avif";

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface HeicConversionResult {
  /** 変換後JPEGのObject URL(object-url-managerが一元管理する) */
  objectUrl: string;
  /** 変換後JPEGのBlob本体。Web Share用のFileを同期的に生成するために保持する */
  blob: Blob;
  jpegBytes: number;
  width: number;
  height: number;
}

export type IntakeItemStatus =
  | { kind: "analyzing" }
  | { kind: "ready"; dimensions: ImageDimensions }
  | { kind: "unsupported-format" }
  | { kind: "error"; message: string }
  /** HEIC変換待ち(キュー内で順番待ち) */
  | { kind: "heic-pending" }
  /** HEIC変換中(Workerで処理中) */
  | { kind: "heic-converting" }
  /** HEIC→JPG変換成功 */
  | { kind: "heic-done"; result: HeicConversionResult }
  /** HEIC→JPG変換失敗 */
  | { kind: "heic-error"; message: string }
  /** HEICファイルサイズが上限(MAX_HEIC_INPUT_BYTES)を超えるため、Workerへ送信する前に拒否した */
  | { kind: "heic-too-large" }
  /** Worker/WebAssembly/OffscreenCanvas等、HEIC変換に必要なブラウザ機能が無いため開始しなかった */
  | { kind: "heic-unsupported-browser" }
  /**
   * AVIFファイルサイズが上限(MAX_AVIF_INPUT_BYTES)を超えるため、file.arrayBuffer()自体を
   * 呼ぶ前に拒否した(heic-too-largeと同じ位置づけ)。
   */
  | { kind: "avif-too-large" }
  /**
   * ftypのcompatible_brandsにavis(image sequence)が含まれるため拒否した。avif-isobmff.tsの
   * hasAvisBrandによる判定で、この時点ではまだ一度もデコードしていない。
   */
  | { kind: "avif-unsupported-animation" }
  /**
   * avif-isobmff.tsのispe候補が0件、または1件でも安全上限(DECODE_SAFETY_LIMITS)を超えるため、
   * getImageDimensions(=HTMLImageElementによる実デコード)を呼ぶ前に拒否した。
   */
  | { kind: "avif-unsafe-dimensions" }
  /**
   * ispe候補の検証までは安全と判断できたが、実際のgetImageDimensions(ブラウザのAVIFデコーダ)が
   * 失敗した場合。原因はブラウザがそのAVIFの機能セット(AV1プロファイル・ビット深度等)に
   * 対応していない場合と、ファイル自体が壊れている場合の両方があり得るため、どちらかを
   * 断定するメッセージにはしない(intakeErrors.avifDecodeFailed参照)。
   */
  | { kind: "avif-decode-failed" }
  /**
   * useImageIntake({enableRasterPreDecodeSafety: true})を有効化したツールでのみ発生する。
   * JPEG/PNG/WebPファイルサイズが上限(MAX_RASTER_PRE_DECODE_INPUT_BYTES)を超えるため、
   * file.arrayBuffer()自体を呼ぶ前に拒否した(heic-too-large/avif-too-largeと同じ位置づけ)。
   */
  | { kind: "raster-too-large" }
  /**
   * useImageIntake({enableRasterPreDecodeSafety: true})を有効化したツールでのみ発生する。
   * readDeclaredDimensions()で読み取った宣言寸法がDECODE_SAFETY_LIMITSを超える(または
   * ヘッダー自体を解析できない)ため、getImageDimensions(実デコード)を呼ぶ前に拒否した。
   */
  | { kind: "raster-unsafe-dimensions" }
  /**
   * useImageIntake({enableRasterPreDecodeSafety: true})を有効化したツールでのみ発生する。
   * 宣言寸法の検証までは安全と判断できたが、実際のgetImageDimensions(ブラウザのデコーダ)が
   * 失敗した場合。avif-decode-failedと同じく、原因(非対応コーデック/破損ファイル)を
   * 断定しないメッセージを表示する。
   */
  | { kind: "raster-decode-failed" };

export interface IntakeItem {
  id: string;
  file: File;
  objectUrl: string;
  /** ファイル名から抽出した拡張子(小文字・ドット無し)。抽出できない場合はnull */
  extension: string | null;
  /** マジックバイト/ftypから判定した実形式。JPEG/PNG/WebP/HEIC以外はnull */
  detectedFormat: SupportedImageFormat | null;
  /** ブラウザが報告するMIMEタイプ(file.type)。取得できない場合は空文字 */
  mimeType: string;
  /** 拡張子から推測される形式と、検出された実形式が食い違っているか */
  extensionMismatch: boolean;
  status: IntakeItemStatus;
}
