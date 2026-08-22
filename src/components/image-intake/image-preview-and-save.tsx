import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { isTouchDevice } from "./touch-device";
import { trackToolEvent } from "../../analytics/tool-events";
import type { UiDictionary } from "../../i18n/schema";

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** プレビュー・保存導線の文言出し分けに使う出力形式ラベル */
export type PreviewFormatLabel = "JPG" | "WebP" | "PNG";

type PreviewAndSaveMessages = UiDictionary["previewAndSave"];

/**
 * 圧縮結果のプレビューを、ページ遷移せずに現在ページ内の<dialog>で表示する。
 * iPhone Safariでは<a download>のBlob URLが「表示」扱いされ現在タブへ遷移することがあり、
 * その後ブラウザバックで選択済みファイル・処理結果(すべてPreactのメモリ上の状態)が
 * 消えてしまう問題への対応。<dialog>のshowModal()はURL/履歴を一切変更しない。
 * HEIC→JPG変換結果・JPEG/WebP圧縮結果など、画像を扱うどの機能からも再利用できる汎用コンポーネント。
 */
export function ImagePreviewDialog({
  fileName,
  objectUrl,
  width,
  height,
  formatLabel,
  messages,
}: {
  fileName: string;
  objectUrl: string;
  width: number;
  height: number;
  formatLabel: PreviewFormatLabel;
  messages: PreviewAndSaveMessages;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  // プレビューを開く直前のdocument.body.style.overflowを保持する。
  // nullは「現在保存中の値が無い(=抑制していない)」を表す。
  const previousBodyOverflowRef = useRef<string | null>(null);

  const restoreBodyOverflow = useCallback(() => {
    if (previousBodyOverflowRef.current === null) return;
    document.body.style.overflow = previousBodyOverflowRef.current;
    previousBodyOverflowRef.current = null;
  }, []);

  // アンマウント時に開いたままだった場合、保存しておいた値へ確実に戻す
  useEffect(() => {
    return () => {
      restoreBodyOverflow();
    };
  }, [restoreBodyOverflow]);

  const openPreview = useCallback(() => {
    const dialog = dialogRef.current;
    // dialog.openの場合はshowModal()の重複実行(InvalidStateError)を避けるため何もしない
    if (!dialog || dialog.open) return;
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
  }, []);

  /**
   * close()の呼び出しと後処理(背景スクロール抑制の復元・フォーカス復帰)を1箇所にまとめ、
   * 閉じるボタン・背景クリック・Escapeのすべてがこの関数を経由するようにする。
   * ブラウザのdialog「close」イベントには依存しない(環境によって発火が不安定なため)。
   */
  const closePreview = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.open) return;
    dialog.close();
    restoreBodyOverflow();
    triggerButtonRef.current?.focus();
  }, [restoreBodyOverflow]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent) => {
      if (event.target === dialogRef.current) {
        closePreview();
      }
    },
    [closePreview],
  );

  const handleDialogKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
      }
    },
    [closePreview],
  );

  return (
    <>
      <button
        type="button"
        ref={triggerButtonRef}
        class="image-list-item__preview-trigger"
        onClick={openPreview}
      >
        {messages.previewTrigger(formatLabel)}
      </button>
      <dialog
        ref={dialogRef}
        class="image-preview-dialog"
        aria-modal="true"
        aria-label={messages.previewDialogAriaLabel(fileName)}
        onClick={handleBackdropClick}
        onKeyDown={handleDialogKeyDown}
      >
        <div class="image-preview-dialog__content">
          <button
            type="button"
            class="image-preview-dialog__close"
            onClick={closePreview}
            aria-label={messages.closePreviewAriaLabel}
          >
            {messages.closePreview}
          </button>
          <img
            class="image-preview-dialog__image"
            src={objectUrl}
            alt={messages.previewImageAlt(fileName, width, height)}
          />
        </div>
      </dialog>
    </>
  );
}

/**
 * 「保存」と「共有」を別の操作として明確に分離する。
 *
 * - タッチ端末(スマートフォン・タブレット等)かつファイル共有対応: 「(形式)を保存」(navigator.share)を
 *   主導線にする。iPhone/iPadではBlob URLへの<a download>が「表示/ダウンロード」選択を経由し、
 *   「表示」を選ぶと現在タブへ遷移してSPAのメモリ上の状態が失われることがあるため。
 * - 非タッチ端末(Mac/Windows/Linux等)かつファイル共有対応: 通常のdownloadリンクを主導線にする。
 *   PC版SafariではWeb Shareを呼ぶとFinderの保存先選択ではなくOSの共有メニューが開いてしまうため、
 *   ダウンロードを主導線に据え、共有は任意の副ボタンとして提供する。
 * - ファイル共有非対応: 端末種別にかかわらず通常のdownloadリンクのみを表示する。
 *
 * タッチ端末の判定はUA文字列を使わず、機能・入力方式ベース(touch-device.ts)で行う。
 * ファイル共有対応判定自体は、UA文字列判定を行わずnavigator.share/canShareの存在と
 * canShare({files})の結果のみで行う(現行方式を維持)。
 */
function useImageSaveAction(blob: Blob, outputFileName: string, shareFailedFallback: string) {
  const [shareError, setShareError] = useState<string | null>(null);

  // クリック時にawaitを挟まず即座にnavigator.share()へ渡せるよう、Fileは事前に生成しておく
  const shareFile = useMemo(
    () => new File([blob], outputFileName, { type: blob.type || "image/jpeg" }),
    [blob, outputFileName],
  );

  const canShareFile = useMemo(() => {
    try {
      return (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [shareFile] }) === true
      );
    } catch {
      // canShare()自体が例外を投げる実装差がある場合も、非対応として安全側に倒す
      return false;
    }
  }, [shareFile]);

  // タッチ能力は端末固有でセッション中に変化しないため、一度だけ判定する
  const isTouch = useMemo(() => isTouchDevice(), []);

  const handleShareClick = useCallback(() => {
    setShareError(null);
    // ここまで同期処理。ユーザーアクティベーションを保ったままnavigator.share()を呼ぶ
    // (title/text/urlは渡さず、共有対象は画像Fileのみ)
    const sharePromise = navigator.share({ files: [shareFile] });
    // Safari等の実装差への防御: Promise相当(thenを持つ)と確認できた場合のみ結果を処理する
    if (sharePromise && typeof sharePromise.then === "function") {
      sharePromise.then(
        () => {
          // Web Shareが完了した場合も、利用者が出力を端末側へ取り出した操作として集計する。
          trackToolEvent({ name: "download" });
        },
        (error: unknown) => {
          if (isAbortError(error)) {
            // ユーザーが共有シートを閉じただけ。エラー表示はしない
            return;
          }
          setShareError(error instanceof Error ? error.message : shareFailedFallback);
        },
      );
    }
  }, [shareFile, shareFailedFallback]);

  return { canShareFile, isTouch, shareError, handleShareClick };
}

export interface ImagePreviewAndSaveProps {
  fileName: string;
  objectUrl: string;
  blob: Blob;
  outputFileName: string;
  width: number;
  height: number;
  /** ボタン・プレビュー文言の出し分けに使う出力形式ラベル(JPEG/HEIC出力は"JPG"、WebP出力は"WebP") */
  formatLabel: PreviewFormatLabel;
  messages: PreviewAndSaveMessages;
}

function DownloadLink({
  objectUrl,
  outputFileName,
  label,
  className,
}: {
  objectUrl: string;
  outputFileName: string;
  label: string;
  className: string;
}) {
  return (
    <a
      class={className}
      href={objectUrl}
      download={outputFileName}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackToolEvent({ name: "download" })}
    >
      {label}
    </a>
  );
}

/**
 * 「(形式)を確認」(プレビュー起動)+保存・共有導線+補足文をまとめて扱う。
 * canShareFile/isTouchの判定結果をプレビュー起動ボタンと補足文で共有するため、
 * 1つのコンポーネントにまとめている。
 */
export function ImagePreviewAndSave({
  fileName,
  objectUrl,
  blob,
  outputFileName,
  width,
  height,
  formatLabel,
  messages,
}: ImagePreviewAndSaveProps) {
  const { canShareFile, isTouch, shareError, handleShareClick } = useImageSaveAction(
    blob,
    outputFileName,
    messages.shareFailedFallback,
  );

  return (
    <>
      <div class="image-list-item__actions">
        <ImagePreviewDialog
          fileName={fileName}
          objectUrl={objectUrl}
          width={width}
          height={height}
          formatLabel={formatLabel}
          messages={messages}
        />
        {!canShareFile ? (
          <DownloadLink
            objectUrl={objectUrl}
            outputFileName={outputFileName}
            label={messages.download(formatLabel)}
            className="image-list-item__download"
          />
        ) : isTouch ? (
          <>
            <button type="button" class="image-list-item__save-trigger" onClick={handleShareClick}>
              {messages.save(formatLabel)}
            </button>
            <DownloadLink
              objectUrl={objectUrl}
              outputFileName={outputFileName}
              label={messages.secondaryDownload}
              className="image-list-item__download image-list-item__download--secondary"
            />
          </>
        ) : (
          <>
            <DownloadLink
              objectUrl={objectUrl}
              outputFileName={outputFileName}
              label={messages.download(formatLabel)}
              className="image-list-item__download"
            />
            <button type="button" class="image-list-item__share-trigger" onClick={handleShareClick}>
              {messages.share}
            </button>
          </>
        )}
      </div>
      {canShareFile && shareError && <p class="image-list-item__save-error">{shareError}</p>}
      {canShareFile && (
        <p class="image-list-item__ios-hint">
          {isTouch ? messages.touchShareCaption(formatLabel) : messages.nonTouchShareCaption}
        </p>
      )}
    </>
  );
}
