import type { RemoveExifErrorCode } from "./jpeg-metadata";

/** メタデータ削除入力の由来。UI文言の出し分け(HEICはJPGに変換したうえで削除する旨の表示)に使う */
export type RemoveMetadataSourceKind = "jpeg" | "heic-derived-jpeg";

export interface RemoveMetadataSource {
  kind: RemoveMetadataSourceKind;
  blob: Blob;
  width: number;
  height: number;
}

export interface RemoveMetadataResult {
  objectUrl: string;
  blob: Blob;
  outputFileName: string;
  originalBytes: number;
  outputBytes: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  /** 表示方向を保つためのOrientationタグ付き最小EXIFを残したか */
  orientationKept: boolean;
  /** カラープロファイル(ICC_PROFILE)を維持したか */
  iccKept: boolean;
  elapsedMs: number;
}

export type RemoveMetadataJobStatus =
  | { kind: "queued" }
  | { kind: "processing" }
  | { kind: "done"; result: RemoveMetadataResult }
  | { kind: "error"; code: RemoveExifErrorCode; message: string }
  | { kind: "cancelled" };

export interface RemoveMetadataJob {
  status: RemoveMetadataJobStatus;
}

/**
 * アイテムのメタデータ削除対応可否。
 * - not-ready: 解析中/HEIC変換待ち・変換中/エラー/未対応形式(JPEG・HEIC以外)
 * - unsupported-format: 解析済みだがPNG/WebP(今回は対象外)
 * - unsupported-browser: Dedicated Workerが無い環境
 * - ready: 削除を開始できる状態(JPEG本体、またはHEIC変換後のJPEG)
 */
export type RemoveMetadataEligibility =
  | { kind: "not-ready" }
  | { kind: "unsupported-format" }
  | { kind: "unsupported-browser" }
  | { kind: "ready"; source: RemoveMetadataSource };
