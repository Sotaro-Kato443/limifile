import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { compressOutputFileName } from "./compress-output-filename";
import { compressWebpOutputFileName } from "./compress-webp-output-filename";
import { validateDeclaredDimensions } from "./decode-safety";
import { createCompressionClient, type CompressionClient } from "./image-compression-client";
import { readDeclaredDimensions } from "./image-header-dimensions";
import { createObjectUrlManager, type ObjectUrlManager } from "./object-url-manager";
import { detectWebpAnimation } from "./webp-animation-detection";
import type {
  CompressionEligibility,
  CompressionFailureReason,
  CompressionJob,
  CompressionOutputFormat,
  CompressionResult,
  CompressionSource,
  CompressionTarget,
} from "./compression-types";
import type { IntakeItem } from "./types";

/**
 * 画像圧縮に必要なブラウザ機能(Worker/OffscreenCanvas/createImageBitmap/convertToBlob)を
 * 同期的に判定する。UA文字列判定は行わない。MVPではメインスレッドフォールバックを持たないため、
 * いずれか一つでも欠けていれば「非対応」として扱う。
 */
function detectCompressionSupport(): boolean {
  if (typeof Worker === "undefined") return false;
  if (typeof OffscreenCanvas === "undefined") return false;
  if (typeof createImageBitmap === "undefined") return false;
  if (typeof OffscreenCanvas.prototype.convertToBlob !== "function") return false;
  return true;
}

function sourceFor(item: IntakeItem): CompressionSource | null {
  if (item.status.kind === "ready" && item.detectedFormat === "jpeg") {
    return {
      kind: "jpeg",
      blob: item.file,
      width: item.status.dimensions.width,
      height: item.status.dimensions.height,
    };
  }
  if (item.status.kind === "ready" && item.detectedFormat === "webp") {
    return {
      kind: "webp",
      blob: item.file,
      width: item.status.dimensions.width,
      height: item.status.dimensions.height,
    };
  }
  if (item.status.kind === "heic-done") {
    return {
      kind: "heic-derived-jpeg",
      blob: item.status.result.blob,
      width: item.status.result.width,
      height: item.status.result.height,
    };
  }
  return null;
}

/**
 * WebPのみ、アニメーション判定・寸法安全性検証にファイルの生バイト列読み取りが必要なため
 * 非同期になる。解決済みの結果はuseImageCompression内のstateにキャッシュし、eligibilityForへ渡す。
 */
export type WebpEligibilityCheck = "ready" | "unsupported-animation" | "unsafe-dimensions";

/**
 * アイテムの圧縮対応可否を判定する。compression-types.tsのCompressionEligibilityを参照。
 * JPEG本体・HEIC変換後JPEGは既知の寸法を同期的に安全性検証できるためwebpCheck不要。
 * WebPはアニメーション判定・寸法安全性検証にファイル読み取りが必要なため、
 * 呼び出し側(useImageCompressionフック)が非同期に解決した結果をwebpCheckとして渡す。
 * webpCheckを渡さない(省略する)場合、WebPアイテムは常にnot-ready扱いになる。
 */
export function eligibilityFor(
  item: IntakeItem,
  isSupported: boolean,
  webpCheck?: WebpEligibilityCheck,
): CompressionEligibility {
  if (!isSupported) return { kind: "unsupported-browser" };

  const source = sourceFor(item);
  if (source) {
    if (source.kind === "webp") {
      if (webpCheck === undefined) return { kind: "not-ready" };
      if (webpCheck === "ready") return { kind: "ready", source };
      return { kind: webpCheck };
    }

    const safetyError = validateDeclaredDimensions({ width: source.width, height: source.height });
    if (safetyError) return { kind: "unsafe-dimensions" };
    return { kind: "ready", source };
  }

  // allowedFormats(jpeg/webp/heic、CompressWorkbench.tsx参照)により、png・avif等の対象外形式は
  // intake側で既に"unsupported-format"として拒否されている(item.status.kind === "ready"へは
  // 進まない)。detectedFormatが実在する値(null以外)であれば、このツール固有の案内文言
  // (compressionWorkbench.formatMismatch)を出す(use-raster-to-jpg.tsのisWrongFormatRejectedと
  // 同じ設計)。detectedFormatがnull(そもそも画像として認識できない)場合は汎用文言に委ね、
  // not-readyのまま返す。
  const isWrongFormatRejected =
    item.status.kind === "unsupported-format" && item.detectedFormat !== null;
  if (isWrongFormatRejected) {
    return { kind: "unsupported-format" };
  }

  return { kind: "not-ready" };
}

/** HEIC変換結果のObject URLキーと衝突しないよう、圧縮結果専用の接尾辞を付与する */
function compressUrlId(itemId: string): string {
  return `${itemId}-compress`;
}

/** アイテムIDごとのrequest generation(バージョン)を保持するマップを直接操作する純粋関数群。
 * コンポーネントのレンダーサイクルとは無関係な単なるカウンタなので、useCallbackのdepsに
 * 含める必要が無いようフック本体の外(モジュールスコープ)に置く。usePngCompressionと同じ方式。 */
function currentVersion(versions: Record<string, number>, itemId: string): number {
  return versions[itemId] ?? 0;
}
function bumpVersion(versions: Record<string, number>, itemId: string): number {
  const next = currentVersion(versions, itemId) + 1;
  versions[itemId] = next;
  return next;
}

export interface UseImageCompressionResult {
  isSupported: boolean;
  jobs: Record<string, CompressionJob>;
  eligibilityFor(item: IntakeItem): CompressionEligibility;
  startCompression(item: IntakeItem, target: CompressionTarget): void;
  cancelCompression(itemId: string): void;
  /** アイテム削除時に呼ぶ。実行中/待機中のジョブをキャンセルし、Object URLを解放する */
  removeJob(itemId: string): void;
  /** 全消去時に呼ぶ */
  clearJobs(): void;
}

/**
 * アイテムIDをキーにした独立したCompressionJob群を管理するフック。
 * 既存のIntakeItem/useImageIntakeの状態には一切書き込まない(状態管理を分離するため)。
 * 圧縮結果のObject URLは専用のObjectUrlManagerで管理し、HEIC変換結果等の既存Object URLの
 * ライフサイクルには影響しない。
 *
 * request generation(バージョン)によるstale結果防止: usePngCompressionと同じ方式で、
 * アイテムごとに単調増加するバージョン番号を持つ。startCompressionのたびに新しいバージョンを
 * 発行し、cancelCompression/removeJob/clearJobs/unmountはいずれも対象アイテムのバージョンを
 * 無効化(bump)する。arrayBuffer完了後・enqueue直前・onStart/onProgress・outcome受信後の
 * 各地点で「現在のバージョンと一致するか」を確認し、一致しない場合は何も表示・更新せず終了する。
 * これにより、削除・全消去・再圧縮・アンマウントがarrayBuffer読み込み中や圧縮処理中に発生しても、
 * 古い処理が後からenqueueされたり、古い結果が新しい結果を上書きしたりしない。
 *
 * FIFO保証: 複数ファイルのarrayBuffer化は並行に進み得るが、Worker側へのenqueue自体は
 * enqueueOrderChainRefによるPromiseチェーンで直列化し、必ずstartCompressionが呼ばれた順に
 * enqueueする(arrayBufferの完了順には依存しない)。usePngCompressionと同じ方式。
 */
export function useImageCompression(
  errors: Record<CompressionFailureReason, string>,
): UseImageCompressionResult {
  const [jobs, setJobs] = useState<Record<string, CompressionJob>>({});
  const [webpChecks, setWebpChecks] = useState<Record<string, WebpEligibilityCheck>>({});
  const startedWebpChecksRef = useRef<Set<string>>(new Set());

  const isSupportedRef = useRef<boolean | undefined>(undefined);
  if (isSupportedRef.current === undefined) {
    isSupportedRef.current = detectCompressionSupport();
  }
  const isSupported = isSupportedRef.current;

  const clientRef = useRef<CompressionClient>();
  if (!clientRef.current && isSupported) {
    clientRef.current = createCompressionClient();
  }

  const urlManagerRef = useRef<ObjectUrlManager>();
  if (!urlManagerRef.current) {
    urlManagerRef.current = createObjectUrlManager();
  }

  // アイテムIDごとのrequest generation。バージョンが一致しない継続処理は全て無視する。
  const requestVersionsRef = useRef<Record<string, number>>({});

  // startCompressionが呼ばれた順にclient.enqueue()を呼ぶことを保証するためのチェーン
  const enqueueOrderChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const client = clientRef.current;
    const urlManager = urlManagerRef.current;
    return () => {
      // アンマウント後に古いarrayBuffer/enqueueの継続処理がstate更新・Object URL生成を
      // 行わないよう、既知の全アイテムのバージョンを無効化する
      for (const itemId of Object.keys(requestVersionsRef.current)) {
        bumpVersion(requestVersionsRef.current, itemId);
      }
      client?.destroy();
      urlManager?.revokeAll();
    };
  }, []);

  const updateJob = useCallback((itemId: string, job: CompressionJob) => {
    setJobs((prev) => ({ ...prev, [itemId]: job }));
  }, []);

  /**
   * WebPアイテムのアニメーション・寸法安全性チェックを、アイテムIDごとに一度だけ非同期実行する。
   * 呼び出しはeligibilityFor経由でレンダー中に発生しうるため、Setによる開始済み判定で
   * 重複実行(二重startやStrictModeの再実行)を防ぎ、結果はwebpChecks stateへ反映して
   * 再レンダーを促す(この関数自体は同期的にstateを書き換えない)。
   */
  const ensureWebpCheckStarted = useCallback((item: IntakeItem) => {
    if (item.status.kind !== "ready" || item.detectedFormat !== "webp") return;
    if (startedWebpChecksRef.current.has(item.id)) return;
    startedWebpChecksRef.current.add(item.id);

    void (async () => {
      let result: WebpEligibilityCheck;
      try {
        const buffer = await item.file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const declaredDimensions = readDeclaredDimensions(bytes, "webp");
        const safetyError = validateDeclaredDimensions(declaredDimensions);
        if (safetyError) {
          result = "unsafe-dimensions";
        } else {
          const animation = detectWebpAnimation(bytes);
          if (animation === "animated") {
            result = "unsupported-animation";
          } else if (animation === "static") {
            result = "ready";
          } else {
            // malformed/not-webp(通常は発生しないが、壊れたRIFFへの安全側フォールバック)
            result = "unsafe-dimensions";
          }
        }
      } catch {
        result = "unsafe-dimensions";
      }
      setWebpChecks((prev) => ({ ...prev, [item.id]: result }));
    })();
  }, []);

  const startCompression = useCallback(
    (item: IntakeItem, target: CompressionTarget) => {
      ensureWebpCheckStarted(item);
      const eligibility = eligibilityFor(item, isSupported, webpChecks[item.id]);
      if (eligibility.kind !== "ready") return;
      const { source } = eligibility;
      const outputFormat: CompressionOutputFormat = source.kind === "webp" ? "webp" : "jpeg";

      // 同一アイテムに対する前回の要求(arrayBuffer読み込み中・Worker待機中・実行中)を
      // 無効化する。Worker側で実際に待機中/実行中だった場合はcancelで打ち切る。
      const version = bumpVersion(requestVersionsRef.current, item.id);
      clientRef.current?.cancel(item.id);

      const outputFileName =
        outputFormat === "webp"
          ? compressWebpOutputFileName(item.file.name)
          : compressOutputFileName(item.file.name, target.label);
      const urlManager = urlManagerRef.current!;
      // 再圧縮の場合、直前の結果のObject URLを新しい結果へ置き換える前に解放する
      urlManager.revoke(compressUrlId(item.id));

      if (source.blob.size <= target.bytes) {
        const objectUrl = urlManager.create(compressUrlId(item.id), source.blob);
        const result: CompressionResult = {
          objectUrl,
          blob: source.blob,
          outputFileName,
          outputFormat,
          unchanged: true,
          originalBytes: source.blob.size,
          outputBytes: source.blob.size,
          targetBytes: target.bytes,
          originalWidth: source.width,
          originalHeight: source.height,
          outputWidth: source.width,
          outputHeight: source.height,
          encodeCount: 0,
          resizeCount: 0,
          elapsedMs: 0,
        };
        updateJob(item.id, { target, status: { kind: "done", result } });
        return;
      }

      updateJob(item.id, { target, status: { kind: "queued" } });

      void (async () => {
        // 読み込み自体は即座に開始する(複数アイテムで並行に進んでよい)。失敗した場合も
        // Promiseの拒否をここで一度だけ捕捉し、値として持ち回る(unhandled rejection防止)。
        const readPromise = source.blob.arrayBuffer().then(
          (buffer) => ({ ok: true as const, buffer }),
          (error: unknown) => ({ ok: false as const, error }),
        );

        // 自分の番が来るまで待つ(直前に開始された要求のenqueue呼び出しが終わるまで)。
        // ここで直列化するのはenqueue呼び出しの順序のみで、読み込み自体は並行に進む。
        const myTurn = enqueueOrderChainRef.current;
        let releaseNextTurn = () => {};
        const nextTurn = new Promise<void>((resolve) => {
          releaseNextTurn = resolve;
        });
        enqueueOrderChainRef.current = nextTurn;

        try {
          await myTurn;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return; // 順番待ち中に打ち切り・再送信で無効化された

          const readResult = await readPromise;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return; // 読み込み中に打ち切り・再送信で無効化された

          if (!readResult.ok) {
            // 詳細はDEV表示・ログ用途にのみ残し、利用者向けにはencode-failedの固定文言を使う
            updateJob(item.id, {
              target,
              status: {
                kind: "error",
                reason: "encode-failed",
                message: errors["encode-failed"],
              },
            });
            return;
          }

          const client = clientRef.current;
          if (!client) return;

          const outcomePromise = client.enqueue(
            {
              id: item.id,
              buffer: readResult.buffer,
              targetBytes: target.bytes,
              format: outputFormat,
            },
            {
              onStart: () => {
                if (currentVersion(requestVersionsRef.current, item.id) !== version) return;
                updateJob(item.id, {
                  target,
                  status: {
                    kind: "processing",
                    progress: { phase: "preparing", attempt: 0, maxAttempts: 12 },
                  },
                });
              },
              onProgress: (progress) => {
                if (currentVersion(requestVersionsRef.current, item.id) !== version) return;
                updateJob(item.id, { target, status: { kind: "processing", progress } });
              },
            },
          );

          // enqueue呼び出しは完了した(要求順を確保できた)ので、次の要求へ順番を譲る。
          // 圧縮処理自体の完了(outcomePromiseの解決)を待つ必要は無い。
          releaseNextTurn();

          const outcome = await outcomePromise;
          if (currentVersion(requestVersionsRef.current, item.id) !== version) return; // stale outcomeは表示せず終了する

          if (outcome.status === "cancelled") {
            // cancelCompression/removeJob側で既にcancelled状態へ更新済みのため何もしない
            return;
          }
          if (outcome.status === "error") {
            updateJob(item.id, {
              target,
              status: { kind: "error", reason: "encode-failed", message: outcome.message },
            });
            return;
          }
          if (outcome.status === "unreachable") {
            updateJob(item.id, {
              target,
              status: {
                kind: "error",
                reason: "target-unreachable",
                message: errors["target-unreachable"],
              },
            });
            return;
          }
          if (outcome.status === "unsafe-dimensions") {
            updateJob(item.id, {
              target,
              status: {
                kind: "error",
                reason: "unsafe-dimensions",
                message: errors["unsafe-dimensions"],
              },
            });
            return;
          }
          if (outcome.status === "unsupported-webp-encoder") {
            updateJob(item.id, {
              target,
              status: {
                kind: "error",
                reason: "unsupported-webp-encoder",
                message: errors["unsupported-webp-encoder"],
              },
            });
            return;
          }
          if (outcome.status === "unsupported-animation") {
            updateJob(item.id, {
              target,
              status: {
                kind: "error",
                reason: "unsupported-animation",
                message: errors["unsupported-animation"],
              },
            });
            return;
          }
          if (outcome.status === "malformed-webp" || outcome.status === "dimension-mismatch") {
            updateJob(item.id, {
              target,
              status: {
                kind: "error",
                reason: "decode-failed",
                message: errors["decode-failed"],
              },
            });
            return;
          }

          const outputBlob =
            outcome.status === "webp-done"
              ? new Blob([outcome.webpBuffer], { type: "image/webp" })
              : new Blob([outcome.jpegBuffer], { type: "image/jpeg" });
          const objectUrl = urlManagerRef.current!.create(compressUrlId(item.id), outputBlob);
          const result: CompressionResult = {
            objectUrl,
            blob: outputBlob,
            outputFileName,
            outputFormat,
            unchanged: false,
            originalBytes: source.blob.size,
            outputBytes: outputBlob.size,
            targetBytes: target.bytes,
            originalWidth: source.width,
            originalHeight: source.height,
            outputWidth: outcome.width,
            outputHeight: outcome.height,
            encodeCount: outcome.encodeCount,
            resizeCount: outcome.resizeCount,
            elapsedMs: outcome.elapsedMs,
          };
          updateJob(item.id, { target, status: { kind: "done", result } });
        } finally {
          // 早期return・例外いずれの場合でも、次の要求の順番待ちを解放する
          // (既に呼び出し済みの場合は何もしない)
          releaseNextTurn();
        }
      })();
    },
    [isSupported, updateJob, webpChecks, ensureWebpCheckStarted, errors],
  );

  const cancelCompression = useCallback((itemId: string) => {
    // arrayBuffer読み込み中(まだWorkerへ送っていない)場合でも、Worker待機中・実行中の
    // 場合でも、どちらも安全にキャンセルできるよう先にバージョンを無効化してから
    // Worker側のcancelを試みる(該当タスクが無ければ何もしない安全なno-op)。
    bumpVersion(requestVersionsRef.current, itemId);
    clientRef.current?.cancel(itemId);
    setJobs((prev) => {
      const current = prev[itemId];
      if (!current) return prev;
      if (current.status.kind !== "queued" && current.status.kind !== "processing") return prev;
      return { ...prev, [itemId]: { target: current.target, status: { kind: "cancelled" } } };
    });
  }, []);

  const removeJob = useCallback((itemId: string) => {
    bumpVersion(requestVersionsRef.current, itemId);
    clientRef.current?.cancel(itemId);
    urlManagerRef.current?.revoke(compressUrlId(itemId));
    startedWebpChecksRef.current.delete(itemId);
    setJobs((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    setWebpChecks((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  const clearJobs = useCallback(() => {
    for (const itemId of Object.keys(requestVersionsRef.current)) {
      bumpVersion(requestVersionsRef.current, itemId);
    }
    clientRef.current?.cancelAll();
    urlManagerRef.current?.revokeAll();
    startedWebpChecksRef.current.clear();
    setJobs({});
    setWebpChecks({});
  }, []);

  const boundEligibilityFor = useCallback(
    (item: IntakeItem) => {
      ensureWebpCheckStarted(item);
      return eligibilityFor(item, isSupported, webpChecks[item.id]);
    },
    [isSupported, webpChecks, ensureWebpCheckStarted],
  );

  return {
    isSupported,
    jobs,
    eligibilityFor: boundEligibilityFor,
    startCompression,
    cancelCompression,
    removeJob,
    clearJobs,
  };
}
