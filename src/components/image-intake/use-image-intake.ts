import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { normalizeToolErrorCode, trackToolEvent } from "../../analytics/tool-events";
import { MAX_AVIF_INPUT_BYTES } from "./avif-conversion-types";
import { hasAvisBrand, readAvifIspeCandidates } from "./avif-isobmff";
import { DEFAULT_MAX_CONCURRENT_DECODES, createDecodeQueue } from "./decode-queue";
import { DECODE_SAFETY_LIMITS, validateDeclaredDimensions } from "./decode-safety";
import { detectImageFormat, extractExtension, hasExtensionMismatch } from "./file-signature";
import { parseFtypBox } from "./ftyp-detection";
import { createHeicConversionClient, type HeicConversionClient } from "./heic-conversion-client";
import { HEIC_JPEG_QUALITY, MAX_HEIC_INPUT_BYTES } from "./heic-conversion-types";
import { getImageDimensions } from "./image-dimensions";
import { createObjectUrlManager, type ObjectUrlManager } from "./object-url-manager";
import {
  rasterPreDecodeSafetyPreflight,
  type RasterPreDecodeFormat,
} from "./raster-pre-decode-safety";
import type { ImageDimensions, IntakeItem, SupportedImageFormat } from "./types";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `file-${idCounter}`;
}

/** HEIC→JPG変換後Object URLのマネージャ内キー。元ファイルのidと衝突しないよう接尾辞を付与する */
function heicJpegUrlId(id: string): string {
  return `${id}-heic-jpeg`;
}

/**
 * HEIC変換にはWorker/WebAssembly/OffscreenCanvas.convertToBlobが必要。いずれか欠けている
 * ブラウザではWorker生成・ファイル送信を一切行わず、専用のunsupported-browser状態を表示する。
 * JPEG/PNG/WebPの通常解析はこの判定の影響を受けない(HEIC以外の形式では参照しない)。
 */
function detectHeicConversionSupport(): boolean {
  if (typeof Worker === "undefined") return false;
  if (typeof WebAssembly === "undefined") return false;
  if (typeof OffscreenCanvas === "undefined") return false;
  if (typeof OffscreenCanvas.prototype.convertToBlob !== "function") return false;
  return true;
}

/**
 * AVIFのみに適用するpre-decode safety検証の結果。ready以外はすべて、
 * getImageDimensions(=HTMLImageElementによる実デコード)を一度も呼ばずに拒否した状態を表す。
 */
type AvifPreflightOutcome =
  | { kind: "unsupported-animation" }
  | { kind: "unsafe-dimensions" }
  | { kind: "decode-failed" }
  | { kind: "ready"; dimensions: ImageDimensions };

/**
 * AVIF専用のpre-decode safety検証。detectImageFormat→avif-too-large判定の後、
 * getImageDimensions(実デコード)より前に必ず完了させる一連の処理をまとめたもの。
 *
 * 1. file.arrayBuffer()で圧縮バイト列を読む(これ自体は画像デコードではない)
 * 2. ftypのcompatible_brandsにavis(image sequence)が含まれるか判定する
 * 3. avif-isobmff.tsのispe候補を全て取得し、個別に安全性検証する
 *    (複数候補のwidth/heightの最大値を合成すると実在しない寸法を作ってしまうため、
 *    1件でも安全上限を超える候補があれば安全側で拒否する — avif-isobmff.tsの設計判断と同じ)
 * 4. ここまで安全と判断できた場合のみgetImageDimensionsを呼ぶ
 *
 * raster-convert.worker.tsのAVIF分岐と同じ判定ロジックをintake側でも独立して行う
 * (Worker側の判定が最終的な安全境界であることは変わらない。ここでの検証はUIの状態表示を
 * 早く正しく更新するためのものであり、raster-convert.worker.tsのコメントと同じ位置づけ)。
 */
async function avifPreflight(file: File, objectUrl: string): Promise<AvifPreflightOutcome> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const ftyp = parseFtypBox(bytes);
  if (ftyp && hasAvisBrand([ftyp.majorBrand, ...ftyp.compatibleBrands])) {
    return { kind: "unsupported-animation" };
  }

  // ftypがここで解析できない状況は、detectImageFormat(先頭128byteのftyp解析)で既にavifと
  // 判定された後であれば実運用上起こらない想定だが、万一発生した場合も安全側(unsafe-dimensions)
  // として扱い、getImageDimensionsを呼ばない。
  const candidates = ftyp ? readAvifIspeCandidates(bytes) : [];
  const hasUnsafeCandidate =
    candidates.length === 0 ||
    candidates.some((candidate) => validateDeclaredDimensions(candidate, DECODE_SAFETY_LIMITS));
  if (hasUnsafeCandidate) {
    return { kind: "unsafe-dimensions" };
  }

  // ispe候補までは安全側で判断できたが、実デコード自体はブラウザのAVIF実装に依存する。
  // 対応していないブラウザ・壊れたファイルのいずれでも失敗し得るため、ここだけは
  // 例外を握りつぶさず専用のdecode-failed状態として区別する(原因を断定しないメッセージを
  // 表示するため。intakeErrors.avifDecodeFailed参照)。
  try {
    const dimensions = await getImageDimensions(objectUrl);
    return { kind: "ready", dimensions };
  } catch {
    return { kind: "decode-failed" };
  }
}

function createPlaceholder(file: File, urlManager: ObjectUrlManager): IntakeItem {
  const id = nextId();
  const objectUrl = urlManager.create(id, file);
  return {
    id,
    file,
    objectUrl,
    extension: extractExtension(file.name),
    detectedFormat: null,
    mimeType: file.type,
    extensionMismatch: false,
    status: { kind: "analyzing" },
  };
}

export interface UseImageIntakeResult {
  items: IntakeItem[];
  addFiles: (files: FileList | File[]) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
}

export interface UseImageIntakeOptions {
  /**
   * 指定した場合、detectImageFormat(マジックバイト判定)の結果がこの一覧に含まれない
   * アイテムは、拡張子・MIMEタイプに関わらずunsupported-formatとして即座に扱い、
   * HEIC変換(WASM Worker)の起動や寸法取得(getImageDimensions)を一切開始しない。
   * PNG専用・WebP専用ページ(RasterToJpgWorkbench等)が、対象外形式のファイル
   * (特にHEIC)をドロップされた際にWorkerを無駄に起動しないようにするためのもの。
   * 省略時は既存動作(全形式を解析対象とする)を維持する。
   */
  allowedFormats?: readonly SupportedImageFormat[];
  /**
   * trueの場合、JPEG/PNG/WebPについても、getImageDimensions(実デコード)より前に
   * raster-pre-decode-safety.tsのrasterPreDecodeSafetyPreflight(file.size上限→
   * readDeclaredDimensions→validateDeclaredDimensions)を通す。省略時(既定)は既存動作
   * (これらの形式はheader safetyを経ずに直接getImageDimensionsへ進む)を維持するため、
   * 既存の全Workbenchはこのオプションを指定しない限り一切影響を受けない。
   * Signature Resizer等、外部提出条件のためpre-decode dimension safetyを早期に確定させたい
   * ツール向けのopt-in拡張(avifPreflightと同じ位置づけをJPEG/PNG/WebPにも広げたもの)。
   */
  enableRasterPreDecodeSafety?: boolean;
  /**
   * HEICを選択直後に自動変換するImageWorkbench専用の計測opt-in。
   * 圧縮等の前処理としてHEIC→JPGを行う他Workbenchではfalseのままにし、
   * 1回の利用を「HEIC変換+本処理」の2回として重複計測しない。
   */
  trackHeicConversion?: boolean;
}

/**
 * 選択された画像の一覧と、それぞれの解析状態を管理するフック。
 * 1件の解析失敗が他のファイルの表示を止めないよう、ファイルごとに独立して解析する。
 * 画像デコードを伴う寸法取得は decode-queue によって同時実行数を制限する。
 * HEICのデコード・JPG変換はheic-conversion-client(専用のWorker+キュー)で行い、
 * JPEG/PNG/WebP用のdecode-queueとは独立して管理する。
 * AVIFはHEICと違って専用Workerを持たないが、pre-decode safety検証(avifPreflight、
 * file.arrayBuffer()を含む)自体をJPEG/PNG/WebPと同じdecode-queueに通すことで、
 * 大量のAVIFを同時dropされてもArrayBufferの確保が同時実行数の上限を超えないようにする。
 */
export function useImageIntake(options?: UseImageIntakeOptions): UseImageIntakeResult {
  const allowedFormats = options?.allowedFormats;
  const enableRasterPreDecodeSafety = options?.enableRasterPreDecodeSafety ?? false;
  const trackHeicConversion = options?.trackHeicConversion ?? false;
  const [items, setItems] = useState<IntakeItem[]>([]);
  const urlManagerRef = useRef<ObjectUrlManager>();
  if (!urlManagerRef.current) {
    urlManagerRef.current = createObjectUrlManager();
  }
  const queueRef = useRef(createDecodeQueue(DEFAULT_MAX_CONCURRENT_DECODES));
  const heicClientRef = useRef<HeicConversionClient>();
  if (!heicClientRef.current) {
    heicClientRef.current = createHeicConversionClient();
  }
  const isHeicConversionSupportedRef = useRef<boolean>();
  if (isHeicConversionSupportedRef.current === undefined) {
    isHeicConversionSupportedRef.current = detectHeicConversionSupport();
  }

  useEffect(() => {
    const urlManager = urlManagerRef.current;
    const heicClient = heicClientRef.current;
    return () => {
      heicClient?.destroy();
      urlManager?.revokeAll();
    };
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<IntakeItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const analyze = useCallback(
    async (placeholder: IntakeItem) => {
      let trackedHeicProcessingStarted = false;
      try {
        const detectedFormat = await detectImageFormat(placeholder.file);
        const extensionMismatch = hasExtensionMismatch(detectedFormat, placeholder.file.name);

        if (!detectedFormat) {
          updateItem(placeholder.id, {
            detectedFormat,
            extensionMismatch,
            status: { kind: "unsupported-format" },
          });
          return;
        }

        // allowedFormatsが指定されたページ(PNG専用・WebP専用等)では、対象外形式と
        // 判定された時点でHEIC変換(WASM Worker)・寸法取得のいずれも開始しない。
        // 拡張子/MIMEではなくdetectImageFormat(マジックバイト判定)の結果だけで判定する。
        if (allowedFormats && !allowedFormats.includes(detectedFormat)) {
          updateItem(placeholder.id, {
            detectedFormat,
            extensionMismatch,
            status: { kind: "unsupported-format" },
          });
          return;
        }

        if (detectedFormat === "heic") {
          // Worker生成・ファイル送信より前に、必要なブラウザ機能を確認する。
          // 欠けている場合はWorkerを一切生成せず、専用の状態を表示する
          // (JPEG/PNG/WebPの通常解析はこの分岐に到達しないため影響を受けない)。
          if (!isHeicConversionSupportedRef.current) {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "heic-unsupported-browser" },
            });
            return;
          }

          // arrayBuffer化・Worker送信より前に、圧縮ファイル自体のサイズ上限を確認する。
          // デコード後ピクセル数の上限(Worker側のDECODE_SAFETY_LIMITS検証)とは独立した、
          // 追加の入口制限(heic-conversion-types.ts参照)。
          if (placeholder.file.size > MAX_HEIC_INPUT_BYTES) {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "heic-too-large" },
            });
            return;
          }

          updateItem(placeholder.id, {
            detectedFormat,
            extensionMismatch,
            status: { kind: "heic-pending" },
          });
          if (trackHeicConversion) {
            trackToolEvent({ name: "process_start" });
            trackedHeicProcessingStarted = true;
          }

          const buffer = await placeholder.file.arrayBuffer();
          const outcome = await heicClientRef.current!.enqueue(
            { id: placeholder.id, buffer, quality: HEIC_JPEG_QUALITY },
            { onStart: () => updateItem(placeholder.id, { status: { kind: "heic-converting" } }) },
          );

          if (outcome.status === "cancelled") {
            // 既に一覧から削除済み(removeItem/clearAll)のため状態更新は行わない
            return;
          }

          if (outcome.status !== "done") {
            // invalid-quality(内部安全弁、通常発生しない)・unsafe-dimensions・
            // unsupported-jpeg-encoder・timeout・errorは、いずれもユーザーには同一の
            // 汎用メッセージ(HEIC_CONVERT_ERROR_MESSAGE)で安全に表示する。詳細な理由は
            // DEV環境のデバッグ表示にのみ残す。
            const detail =
              outcome.status === "error" ? outcome.message : `heic-worker:${outcome.status}`;
            updateItem(placeholder.id, {
              status: { kind: "heic-error", message: detail },
            });
            if (trackHeicConversion) {
              trackToolEvent({
                name: "process_error",
                errorCode: normalizeToolErrorCode(outcome.status),
              });
            }
            return;
          }

          const urlManager = urlManagerRef.current;
          if (!urlManager) return;
          const jpegBlob = new Blob([outcome.jpegBuffer], { type: outcome.jpegType });
          const objectUrl = urlManager.create(heicJpegUrlId(placeholder.id), jpegBlob);
          updateItem(placeholder.id, {
            status: {
              kind: "heic-done",
              result: {
                objectUrl,
                blob: jpegBlob,
                jpegBytes: jpegBlob.size,
                width: outcome.width,
                height: outcome.height,
              },
            },
          });
          if (trackHeicConversion) {
            trackToolEvent({ name: "process_success" });
          }
          return;
        }

        if (detectedFormat === "avif") {
          // file.arrayBuffer()より前に、圧縮ファイル自体のサイズ上限を確認する
          // (heicの上限チェックと同じ位置づけ。avif-conversion-types.ts参照)。
          if (placeholder.file.size > MAX_AVIF_INPUT_BYTES) {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "avif-too-large" },
            });
            return;
          }

          // avif.arrayBuffer()の読み込み・ispe候補の検証・getImageDimensionsまでを1つのタスクとして
          // decode-queueに通す。多数のAVIFが同時にdropされた場合でも、DEFAULT_MAX_CONCURRENT_DECODES
          // (既定2)を超える数のファイルが同時にArrayBufferを確保しないようにするため
          // (queueRef自体はPNG/WebP/JPEGのgetImageDimensions呼び出しと共有する)。
          const preflight = await queueRef.current.enqueue(() =>
            avifPreflight(placeholder.file, placeholder.objectUrl),
          );

          if (preflight.kind === "unsupported-animation") {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "avif-unsupported-animation" },
            });
            return;
          }
          if (preflight.kind === "unsafe-dimensions") {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "avif-unsafe-dimensions" },
            });
            return;
          }
          if (preflight.kind === "decode-failed") {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "avif-decode-failed" },
            });
            return;
          }

          updateItem(placeholder.id, {
            detectedFormat,
            extensionMismatch,
            status: { kind: "ready", dimensions: preflight.dimensions },
          });
          return;
        }

        // opt-in: JPEG/PNG/WebPについてもgetImageDimensions(実デコード)より前に
        // pre-decode safety(file size→宣言寸法検証)を通す。既定(enableRasterPreDecodeSafety未指定)
        // では従来どおりこの分岐へは入らず、直接getImageDimensionsへ進む(既存ツールは無変更)。
        if (
          enableRasterPreDecodeSafety &&
          (detectedFormat === "jpeg" || detectedFormat === "png" || detectedFormat === "webp")
        ) {
          const rasterFormat: RasterPreDecodeFormat = detectedFormat;
          const preflight = await queueRef.current.enqueue(() =>
            rasterPreDecodeSafetyPreflight(placeholder.file, placeholder.objectUrl, rasterFormat),
          );

          if (preflight.kind === "too-large") {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "raster-too-large" },
            });
            return;
          }
          if (preflight.kind === "unsafe-dimensions") {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "raster-unsafe-dimensions" },
            });
            return;
          }
          if (preflight.kind === "decode-failed") {
            updateItem(placeholder.id, {
              detectedFormat,
              extensionMismatch,
              status: { kind: "raster-decode-failed" },
            });
            return;
          }

          updateItem(placeholder.id, {
            detectedFormat,
            extensionMismatch,
            status: { kind: "ready", dimensions: preflight.dimensions },
          });
          return;
        }

        const dimensions = await queueRef.current.enqueue(() =>
          getImageDimensions(placeholder.objectUrl),
        );
        updateItem(placeholder.id, {
          detectedFormat,
          extensionMismatch,
          status: { kind: "ready", dimensions },
        });
      } catch (error) {
        if (trackedHeicProcessingStarted) {
          trackToolEvent({ name: "process_error", errorCode: "processing_failed" });
        }
        updateItem(placeholder.id, {
          status: {
            kind: "error",
            message: error instanceof Error ? error.message : "解析に失敗しました",
          },
        });
      }
    },
    [updateItem, allowedFormats, enableRasterPreDecodeSafety, trackHeicConversion],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const urlManager = urlManagerRef.current;
      if (!urlManager) return;

      const placeholders = Array.from(files).map((file) => createPlaceholder(file, urlManager));
      if (placeholders.length === 0) return;

      setItems((prev) => [...prev, ...placeholders]);
      void Promise.allSettled(placeholders.map((placeholder) => analyze(placeholder)));
    },
    [analyze],
  );

  const removeItem = useCallback((id: string) => {
    // 待機中なら除去、実行中ならWorkerごとterminateする(cancel()は両方をカバーする)
    heicClientRef.current?.cancel(id);
    urlManagerRef.current?.revoke(id);
    urlManagerRef.current?.revoke(heicJpegUrlId(id));
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    heicClientRef.current?.cancelAll();
    urlManagerRef.current?.revokeAll();
    setItems([]);
  }, []);

  return { items, addFiles, removeItem, clearAll };
}
