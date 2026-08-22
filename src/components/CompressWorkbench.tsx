import { ImageDropZone } from "./image-intake/image-drop-zone";
import { CompressPanel } from "./image-intake/compress-panel";
import { formatBytes } from "./image-intake/format-bytes";
import { FORMAT_LABEL } from "./image-intake/image-list-item";
import { useImageCompression } from "./image-intake/use-image-compression";
import { useImageIntake } from "./image-intake/use-image-intake";
import { PrivacyNotice } from "./privacy-notice";
import { getDictionary } from "../i18n/get-dictionary";
import type { UseImageCompressionResult } from "./image-intake/use-image-compression";
import type { IntakeItem } from "./image-intake/types";
import type { CompressionTarget, SizeUnit } from "./image-intake/compression-types";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";
import type { UiDictionary } from "../i18n/schema";

export interface CompressWorkbenchProps {
  locale: ImplementedLocaleKey;
  /** 例: /compress-image-to-500kbでは500を渡し、目標容量入力の初期値にする */
  defaultTargetValue?: number;
  defaultTargetUnit?: SizeUnit;
}

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
]);

function CompressListItem({
  item,
  onRemove,
  compression,
  defaultTargetValue,
  defaultTargetUnit,
  messages,
}: {
  item: IntakeItem;
  onRemove: (id: string) => void;
  compression: UseImageCompressionResult;
  defaultTargetValue?: number;
  defaultTargetUnit?: SizeUnit;
  messages: UiDictionary;
}) {
  const isDebug = import.meta.env.DEV;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);
  const eligibility = compression.eligibilityFor(item);
  const job = compression.jobs[item.id];

  const handleCompress = (target: CompressionTarget) => {
    compression.startCompression(item, target);
  };

  const handleCancel = () => {
    compression.cancelCompression(item.id);
  };

  const handleRemove = () => {
    compression.removeJob(item.id);
    onRemove(item.id);
  };

  return (
    <li class="image-list-item">
      {item.status.kind === "heic-done" ? (
        <img class="image-list-item__thumbnail" src={item.status.result.objectUrl} alt="" />
      ) : isHeicPipeline ? (
        <div
          class="image-list-item__thumbnail image-list-item__thumbnail--placeholder"
          aria-hidden="true"
        />
      ) : (
        <img class="image-list-item__thumbnail" src={item.objectUrl} alt="" />
      )}
      <div class="image-list-item__details">
        <p class="image-list-item__name">{item.file.name}</p>
        <p class="image-list-item__meta">
          <span>{formatBytes(item.file.size)}</span>
          {item.status.kind === "ready" && (
            <span>
              {item.status.dimensions.width}×{item.status.dimensions.height}px
            </span>
          )}
          <span>{item.mimeType || messages.common.mimeUnknown}</span>
        </p>

        {item.status.kind === "analyzing" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.analyzing}
          </p>
        )}
        {item.status.kind === "heic-pending" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.heicQueued}
          </p>
        )}
        {item.status.kind === "heic-converting" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.heicConverting}
          </p>
        )}
        {item.status.kind === "heic-done" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.heicConverted}
          </p>
        )}
        {item.status.kind === "heic-error" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.heicConvertFailed}
          </p>
        )}
        {item.status.kind === "unsupported-format" && item.detectedFormat === null && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.unsupportedFormat}
          </p>
        )}
        {item.status.kind === "error" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.analyzeFailed}
          </p>
        )}
        {item.extensionMismatch && (
          <p class="image-list-item__warning">
            {messages.listItem.extensionMismatch(
              item.extension ?? "?",
              item.detectedFormat
                ? FORMAT_LABEL[item.detectedFormat]
                : messages.common.unknownFormatLabel,
            )}
          </p>
        )}

        {eligibility.kind === "unsupported-format" && (
          <p class="image-list-item__status">{messages.compressionWorkbench.formatMismatch}</p>
        )}

        {eligibility.kind === "unsupported-animation" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.compressionWorkbench.unsupportedAnimation}
          </p>
        )}

        {eligibility.kind === "unsafe-dimensions" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.compressionWorkbench.unsafeDimensions}
          </p>
        )}

        {eligibility.kind === "ready" && (
          <>
            {item.status.kind === "heic-done" && (
              <p class="image-list-item__status">{messages.compressionWorkbench.heicSourceNote}</p>
            )}
            {eligibility.source.kind === "webp" && (
              <p class="image-list-item__status">{messages.compressionWorkbench.webpSourceNote}</p>
            )}
            <CompressPanel
              fileName={item.file.name}
              job={job}
              defaultTargetValue={defaultTargetValue}
              defaultTargetUnit={defaultTargetUnit}
              onCompress={handleCompress}
              onCancel={handleCancel}
              messages={messages}
            />
          </>
        )}

        {isDebug && (
          <p class="image-list-item__debug">
            debug: detected={item.detectedFormat ?? "null"} / ext={item.extension ?? "null"}
            {item.status.kind === "heic-error" && ` / raw=${item.status.message}`}
            {item.status.kind === "error" && ` / raw=${item.status.message}`}
          </p>
        )}
      </div>
      <button
        type="button"
        class="image-list-item__remove"
        onClick={handleRemove}
        aria-label={messages.listItem.removeAriaLabel(item.file.name)}
      >
        {messages.common.remove}
      </button>
    </li>
  );
}

/**
 * 指定容量以下への圧縮専用のPreactアイランド。/compress-image、/compress-image-to-500kbから
 * 読み込まれる。既存のImageWorkbench(トップページ、/heic-to-jpg)は変更せず維持し、
 * 圧縮機能はこちらに独立させることで、既存のHEIC変換・保存・プレビュー機能への影響を避ける。
 * ファイル選択・解析・HEIC変換自体はuseImageIntakeをそのまま再利用する。
 */
export function CompressWorkbench({
  locale,
  defaultTargetValue,
  defaultTargetUnit,
}: CompressWorkbenchProps) {
  /**
   * 圧縮対応はJPEG本体・静止/アニメーションWebP・HEIC変換後JPEGのみ(use-image-compression.tsの
   * sourceFor参照)。PNGは既存どおりuseImageCompression側でunsupported-formatとして案内するため
   * allowedFormatsには含めない(PNGドロップ時に専用の案内メッセージを出す既存動作を維持する)。
   * AVIFはこのツールで処理できないため、ここで即座にunsupported-formatとして弾き、
   * 不要なAVIF pre-decode safety(ispe検証・実デコード)を開始しない。
   */
  const { items, addFiles, removeItem, clearAll } = useImageIntake({
    allowedFormats: ["jpeg", "webp", "heic"],
  });
  const dictionary = getDictionary(locale);
  const messages = dictionary.ui;
  const compression = useImageCompression(messages.compressionPanel.errors);

  const handleRemove = (id: string) => {
    compression.removeJob(id);
    removeItem(id);
  };

  const handleClearAll = () => {
    compression.clearJobs();
    clearAll();
  };

  return (
    <div class="image-workbench">
      <ImageDropZone
        onFiles={addFiles}
        formatsHint="JPEG・HEIC・WebP"
        messages={messages.dropZone}
      />
      <p class="compress-workbench__format-note">{messages.compressionWorkbench.formatNote}</p>
      <PrivacyNotice text={dictionary.privacyNotice} />
      {!compression.isSupported && (
        <p class="compress-workbench__unsupported">
          {messages.compressionWorkbench.unsupportedBrowser}
        </p>
      )}
      {items.length > 0 && (
        <div class="image-list">
          <div class="image-list__header">
            <p class="image-list__count">{messages.imageList.selectedCount(items.length)}</p>
            <button type="button" class="image-list__clear-all" onClick={handleClearAll}>
              {messages.common.removeAll}
            </button>
          </div>
          <ul class="image-list__items">
            {items.map((item) => (
              <CompressListItem
                key={item.id}
                item={item}
                onRemove={handleRemove}
                compression={compression}
                defaultTargetValue={defaultTargetValue}
                defaultTargetUnit={defaultTargetUnit}
                messages={messages}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
