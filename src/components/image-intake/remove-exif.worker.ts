/// <reference lib="webworker" />
// メタデータ削除は必ずこのDedicated Worker内で実行する。メインスレッドでは呼び出さない。

import { RemoveExifError, removeJpegMetadata, type RemoveExifErrorCode } from "./jpeg-metadata";

declare const self: DedicatedWorkerGlobalScope;

export interface RemoveExifWorkerRequestMessage {
  id: string;
  buffer: ArrayBuffer;
}

export interface RemoveExifWorkerDoneMessage {
  id: string;
  type: "result";
  status: "done";
  jpegBuffer: ArrayBuffer;
  originalBytes: number;
  outputBytes: number;
  orientationKept: boolean;
  iccKept: boolean;
  elapsedMs: number;
}

export interface RemoveExifWorkerErrorMessage {
  id: string;
  type: "result";
  status: "error";
  code: RemoveExifErrorCode;
  message: string;
}

export type RemoveExifWorkerResultMessage =
  RemoveExifWorkerDoneMessage | RemoveExifWorkerErrorMessage;

self.onmessage = (event: MessageEvent<RemoveExifWorkerRequestMessage>) => {
  const { id, buffer } = event.data;
  const originalBytes = buffer.byteLength;
  try {
    const startTime = performance.now();
    const result = removeJpegMetadata(buffer);
    const elapsedMs = performance.now() - startTime;
    const message: RemoveExifWorkerDoneMessage = {
      id,
      type: "result",
      status: "done",
      jpegBuffer: result.output,
      originalBytes,
      outputBytes: result.output.byteLength,
      orientationKept: result.orientationKept,
      iccKept: result.iccKept,
      elapsedMs,
    };
    self.postMessage(message, [result.output]);
  } catch (error) {
    const code: RemoveExifErrorCode =
      error instanceof RemoveExifError ? error.code : "invalid-jpeg";
    const message: RemoveExifWorkerErrorMessage = {
      id,
      type: "result",
      status: "error",
      code,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(message);
  }
};
